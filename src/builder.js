const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const axios = require('axios');
const sharp = require('sharp');
const { updateJob } = require('./job-manager');

const TEMPLATE_DIR = path.join(__dirname, '..', 'template');
const BUILDS_DIR = path.join(__dirname, '..', 'builds');
const OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');

// Icon sizes for each density bucket
const ICON_SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

// Orientation mapping
const ORIENTATION_MAP = {
  portrait: 'portrait',
  landscape: 'landscape',
  both: 'unspecified',
};

function sanitizePackageName(appName) {
  const sanitized = appName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 30);
  return `com.webapk.${sanitized || 'app'}`;
}

function darkenColor(hex, amount = 20) {
  // Darken a hex color for primaryDark
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0x00ff) - amount);
  const b = Math.max(0, (num & 0x0000ff) - amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function replaceInFile(filePath, replacements) {
  let content = await fs.readFile(filePath, 'utf-8');
  for (const [placeholder, value] of Object.entries(replacements)) {
    content = content.split(placeholder).join(String(value));
  }
  await fs.writeFile(filePath, content, 'utf-8');
}

async function downloadAndProcessIcon(buildDir, iconUrl) {
  const response = await axios.get(iconUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Web2APK/1.0)',
    },
  });

  const iconBuffer = Buffer.from(response.data);

  for (const [folder, size] of Object.entries(ICON_SIZES)) {
    const resDir = path.join(buildDir, 'app', 'src', 'main', 'res', folder);
    await fs.mkdir(resDir, { recursive: true });

    await sharp(iconBuffer)
      .resize(size, size, { fit: 'cover', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(path.join(resDir, 'ic_launcher.png'));
  }
}

async function createDefaultIcon(buildDir, appName, primaryColor) {
  const letter = (appName[0] || 'A').toUpperCase();
  const color = primaryColor || '#1976D2';

  for (const [folder, size] of Object.entries(ICON_SIZES)) {
    const resDir = path.join(buildDir, 'app', 'src', 'main', 'res', folder);
    await fs.mkdir(resDir, { recursive: true });

    const svg = `
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${color};stop-opacity:1" />
            <stop offset="100%" style="stop-color:${darkenColor(color, 40)};stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="url(#bg)"/>
        <text x="50%" y="54%" font-family="Arial,Helvetica,sans-serif" font-size="${size * 0.48}"
              fill="white" text-anchor="middle" dominant-baseline="middle" font-weight="bold">
          ${letter}
        </text>
      </svg>`;

    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(path.join(resDir, 'ic_launcher.png'));
  }
}

function runGradleBuild(buildDir) {
  return new Promise((resolve, reject) => {
    const gradlew = path.join(buildDir, 'gradlew');

    // Make gradlew executable
    try {
      execSync(`chmod +x "${gradlew}"`);
    } catch (e) {
      // ignore
    }

    // Create local.properties with SDK path
    const localProps = `sdk.dir=${process.env.ANDROID_HOME || '/opt/android-sdk'}\n`;
    fsSync.writeFileSync(path.join(buildDir, 'local.properties'), localProps);

    const buildCmd = `cd "${buildDir}" && ./gradlew assembleRelease bundleRelease --no-daemon --stacktrace 2>&1`;

    exec(buildCmd, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 600000, // 10 minutes
      env: {
        ...process.env,
        JAVA_HOME: process.env.JAVA_HOME || '/opt/java/openjdk',
        ANDROID_HOME: process.env.ANDROID_HOME || '/opt/android-sdk',
        GRADLE_USER_HOME: process.env.GRADLE_USER_HOME || '/root/.gradle',
      },
    }, (error, stdout, stderr) => {
      if (error) {
        console.error('Gradle build failed:', stdout.slice(-3000));
        reject(new Error(`Gradle build failed: ${stdout.slice(-2000)}`));
      } else {
        console.log('Gradle build succeeded');
        resolve(stdout);
      }
    });
  });
}

async function collectOutputs(buildDir, outputDir, job) {
  await fs.mkdir(outputDir, { recursive: true });

  const safeName = job.app_name.replace(/[^a-zA-Z0-9]/g, '_');

  // Find and copy APK
  const apkDir = path.join(buildDir, 'app', 'build', 'outputs', 'apk', 'release');
  if (fsSync.existsSync(apkDir)) {
    const apkFiles = (await fs.readdir(apkDir)).filter(f => f.endsWith('.apk'));
    if (apkFiles.length > 0) {
      await fs.copyFile(
        path.join(apkDir, apkFiles[0]),
        path.join(outputDir, `${safeName}.apk`)
      );
    }
  }

  // Find and copy AAB
  const aabDir = path.join(buildDir, 'app', 'build', 'outputs', 'bundle', 'release');
  if (fsSync.existsSync(aabDir)) {
    const aabFiles = (await fs.readdir(aabDir)).filter(f => f.endsWith('.aab'));
    if (aabFiles.length > 0) {
      await fs.copyFile(
        path.join(aabDir, aabFiles[0]),
        path.join(outputDir, `${safeName}.aab`)
      );
    }
  }
}

async function buildApp(job) {
  const buildDir = path.join(BUILDS_DIR, job.id);
  const outputDir = path.join(OUTPUTS_DIR, job.id);

  try {
    // Step 1: Prepare
    updateJob(job.id, { status: 'building', progress: 'Preparing build environment...' });
    await fs.mkdir(BUILDS_DIR, { recursive: true });
    await fs.mkdir(OUTPUTS_DIR, { recursive: true });

    // Step 2: Copy template
    updateJob(job.id, { progress: 'Copying project template...' });
    await copyDir(TEMPLATE_DIR, buildDir);

    // Step 3: Configure app - replace all placeholders
    updateJob(job.id, { progress: 'Configuring app parameters...' });
    const packageName = sanitizePackageName(job.app_name);
    const primaryDark = darkenColor(job.primary_color || '#1976D2');
    const screenOrientation = ORIENTATION_MAP[job.orientation] || 'unspecified';

    const coreReplacements = {
      '{{APP_NAME}}': job.app_name,
      '{{TARGET_URL}}': job.target_url,
      '{{PACKAGE_NAME}}': packageName,
      '{{VERSION_CODE}}': job.version_code,
      '{{VERSION_NAME}}': job.version_name,
    };

    const configReplacements = {
      '{{TARGET_URL}}': job.target_url,
      '{{SHOW_NAV_BAR}}': job.show_nav_bar ? 'true' : 'false',
      '{{ENABLE_PULL_TO_REFRESH}}': job.pull_to_refresh ? 'true' : 'false',
      '{{ENABLE_SPLASH}}': job.splash_screen ? 'true' : 'false',
      '{{FULLSCREEN}}': job.fullscreen ? 'true' : 'false',
      '{{ORIENTATION}}': job.orientation || 'both',
    };

    const colorReplacements = {
      '{{PRIMARY_COLOR}}': job.primary_color || '#1976D2',
      '{{PRIMARY_DARK_COLOR}}': primaryDark,
      '{{ACCENT_COLOR}}': job.accent_color || '#FF4081',
      '{{SPLASH_COLOR}}': job.splash_color || '#FFFFFF',
      '{{NAV_BAR_COLOR}}': job.nav_bar_color || '#FFFFFF',
    };

    const manifestReplacements = {
      '{{SCREEN_ORIENTATION}}': screenOrientation,
    };

    // Replace in all template files
    await replaceInFile(path.join(buildDir, 'app', 'build.gradle'), coreReplacements);
    await replaceInFile(
      path.join(buildDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
      { '{{APP_NAME}}': job.app_name }
    );
    await replaceInFile(
      path.join(buildDir, 'app', 'src', 'main', 'res', 'values', 'colors.xml'),
      colorReplacements
    );
    await replaceInFile(
      path.join(buildDir, 'app', 'src', 'main', 'java', 'com', 'webapk', 'app', 'AppConfig.java'),
      configReplacements
    );
    await replaceInFile(
      path.join(buildDir, 'app', 'src', 'main', 'AndroidManifest.xml'),
      manifestReplacements
    );

    // Step 4: Process icon
    updateJob(job.id, { progress: 'Processing app icon...' });
    if (job.icon_url) {
      try {
        await downloadAndProcessIcon(buildDir, job.icon_url);
      } catch (iconErr) {
        console.warn('Icon download failed, using default:', iconErr.message);
        await createDefaultIcon(buildDir, job.app_name, job.primary_color);
      }
    } else {
      await createDefaultIcon(buildDir, job.app_name, job.primary_color);
    }

    // Step 5: Gradle build
    updateJob(job.id, { progress: 'Building APK and AAB (this may take a few minutes)...' });
    await runGradleBuild(buildDir);

    // Step 6: Collect outputs
    updateJob(job.id, { progress: 'Collecting build outputs...' });
    await collectOutputs(buildDir, outputDir, job);

    // Step 7: Cleanup build directory (keep outputs)
    await fs.rm(buildDir, { recursive: true, force: true });

    // Step 8: Done
    updateJob(job.id, {
      status: 'success',
      progress: 'Build completed successfully!',
      completed_at: new Date().toISOString(),
      downloads: {
        apk: `/download/${job.id}/apk`,
        aab: `/download/${job.id}/aab`,
      },
    });

    console.log(`✅ Build ${job.id} completed successfully`);
  } catch (error) {
    console.error(`❌ Build ${job.id} failed:`, error.message);
    updateJob(job.id, {
      status: 'failed',
      progress: `Build failed: ${error.message}`,
      error: error.message,
      completed_at: new Date().toISOString(),
    });
    // Cleanup
    await fs.rm(buildDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { buildApp };
