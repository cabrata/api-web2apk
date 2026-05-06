const express = require('express');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const { createJob, getJob, getAllJobs, enqueue } = require('./job-manager');
const { buildApp } = require('./builder');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ==================== Swagger Docs ====================
app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: `
      .swagger-ui .topbar { display: none; }
      .swagger-ui .info .title { font-size: 2em; }
    `,
    customSiteTitle: 'Web2APK API Docs',
    customfavIcon: '',
  })
);

// Serve raw OpenAPI JSON
app.get('/docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// ==================== API Endpoints ====================

/**
 * @swagger
 * /build:
 *   post:
 *     tags: [Build]
 *     summary: Create a new build job
 *     description: |
 *       Submit a build request to convert a website into an Android APK and AAB.
 *       The build runs asynchronously — use the returned `job_id` to poll `/status/:job_id`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - app_name
 *               - target_url
 *             properties:
 *               app_name:
 *                 type: string
 *                 example: "My Cool App"
 *                 description: Display name of the app
 *               target_url:
 *                 type: string
 *                 format: uri
 *                 example: "https://google.com"
 *                 description: Website URL to wrap into the app
 *               icon_url:
 *                 type: string
 *                 format: uri
 *                 example: "https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png"
 *                 description: URL of the app icon image (PNG/JPG/WebP). If not provided, a gradient icon with the first letter is generated.
 *               version_code:
 *                 type: integer
 *                 default: 1
 *                 example: 1
 *                 description: Android versionCode (integer, increment for updates)
 *               version_name:
 *                 type: string
 *                 default: "1.0.0"
 *                 example: "1.0.0"
 *                 description: Human-readable version string
 *               primary_color:
 *                 type: string
 *                 pattern: "^#([0-9A-Fa-f]{6})$"
 *                 default: "#1976D2"
 *                 example: "#1976D2"
 *                 description: Primary theme color (status bar, progress bar, accents)
 *               accent_color:
 *                 type: string
 *                 pattern: "^#([0-9A-Fa-f]{6})$"
 *                 default: "#FF4081"
 *                 example: "#FF4081"
 *                 description: Accent color for buttons and highlights
 *               splash_color:
 *                 type: string
 *                 pattern: "^#([0-9A-Fa-f]{6})$"
 *                 default: "#FFFFFF"
 *                 example: "#FFFFFF"
 *                 description: Splash screen background color
 *               nav_bar_color:
 *                 type: string
 *                 pattern: "^#([0-9A-Fa-f]{6})$"
 *                 default: "#FFFFFF"
 *                 example: "#FFFFFF"
 *                 description: Bottom navigation bar background color
 *               show_nav_bar:
 *                 type: boolean
 *                 default: true
 *                 description: Show bottom navigation bar (back, forward, refresh, share, menu)
 *               pull_to_refresh:
 *                 type: boolean
 *                 default: true
 *                 description: Enable pull-to-refresh gesture
 *               splash_screen:
 *                 type: boolean
 *                 default: true
 *                 description: Show splash screen with app icon on launch
 *               fullscreen:
 *                 type: boolean
 *                 default: false
 *                 description: Run app in fullscreen mode (hides status bar)
 *               orientation:
 *                 type: string
 *                 enum: [portrait, landscape, both]
 *                 default: both
 *                 description: Lock screen orientation or allow both
 *     responses:
 *       202:
 *         description: Build job created and queued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 job_id:
 *                   type: string
 *                   format: uuid
 *                   example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *                 message:
 *                   type: string
 *                   example: "Build job created successfully"
 *                 status_url:
 *                   type: string
 *                   example: "/status/a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/build', (req, res) => {
  const {
    app_name,
    target_url,
    icon_url,
    version_code,
    version_name,
    primary_color,
    accent_color,
    splash_color,
    nav_bar_color,
    show_nav_bar,
    pull_to_refresh,
    splash_screen,
    fullscreen,
    orientation,
  } = req.body;

  if (!app_name || !target_url) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: app_name and target_url are required',
    });
  }

  try {
    new URL(target_url);
  } catch {
    return res.status(400).json({
      success: false,
      error: 'Invalid target_url format',
    });
  }

  if (icon_url) {
    try {
      new URL(icon_url);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Invalid icon_url format',
      });
    }
  }

  const colorRegex = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
  const colorFields = { primary_color, accent_color, splash_color, nav_bar_color };
  for (const [key, val] of Object.entries(colorFields)) {
    if (val && !colorRegex.test(val)) {
      return res.status(400).json({
        success: false,
        error: `Invalid ${key} format. Use hex color like #1976D2`,
      });
    }
  }

  const validOrientations = ['portrait', 'landscape', 'both'];
  if (orientation && !validOrientations.includes(orientation)) {
    return res.status(400).json({
      success: false,
      error: `Invalid orientation. Use: ${validOrientations.join(', ')}`,
    });
  }

  const job = createJob({
    app_name,
    target_url,
    icon_url: icon_url || null,
    version_code: parseInt(version_code) || 1,
    version_name: version_name || '1.0.0',
    primary_color: primary_color || '#1976D2',
    accent_color: accent_color || '#FF4081',
    splash_color: splash_color || '#FFFFFF',
    nav_bar_color: nav_bar_color || '#FFFFFF',
    show_nav_bar: show_nav_bar !== false,
    pull_to_refresh: pull_to_refresh !== false,
    splash_screen: splash_screen !== false,
    fullscreen: fullscreen === true,
    orientation: orientation || 'both',
  });

  enqueue(job, buildApp);

  res.status(202).json({
    success: true,
    job_id: job.id,
    message: 'Build job created successfully',
    status_url: `/status/${job.id}`,
  });
});

/**
 * @swagger
 * /status/{job_id}:
 *   get:
 *     tags: [Jobs]
 *     summary: Check build status
 *     description: Get the current status and progress of a build job
 *     parameters:
 *       - in: path
 *         name: job_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The build job ID returned from POST /build
 *         example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 *     responses:
 *       200:
 *         description: Job status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 job_id:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [queued, building, success, failed]
 *                   description: |
 *                     - `queued` — Waiting for a build slot
 *                     - `building` — Currently compiling
 *                     - `success` — Build completed, downloads available
 *                     - `failed` — Build failed, check error field
 *                 app_name:
 *                   type: string
 *                 target_url:
 *                   type: string
 *                 progress:
 *                   type: string
 *                   description: Human-readable progress message
 *                 created_at:
 *                   type: string
 *                   format: date-time
 *                 completed_at:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 error:
 *                   type: string
 *                   nullable: true
 *                   description: Error message (only when status is failed)
 *                 downloads:
 *                   type: object
 *                   nullable: true
 *                   description: Download URLs (only when status is success)
 *                   properties:
 *                     apk:
 *                       type: string
 *                       example: "/download/uuid/apk"
 *                     aab:
 *                       type: string
 *                       example: "/download/uuid/aab"
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/status/:job_id', (req, res) => {
  const job = getJob(req.params.job_id);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found',
    });
  }

  const response = {
    job_id: job.id,
    status: job.status,
    app_name: job.app_name,
    target_url: job.target_url,
    version_code: job.version_code,
    version_name: job.version_name,
    progress: job.progress,
    created_at: job.created_at,
    completed_at: job.completed_at,
  };

  if (job.status === 'failed') {
    response.error = job.error;
  }

  if (job.status === 'success') {
    response.downloads = {
      apk: `/download/${job.id}/apk`,
      aab: `/download/${job.id}/aab`,
    };
  }

  res.json(response);
});

/**
 * @swagger
 * /download/{job_id}/{type}:
 *   get:
 *     tags: [Build]
 *     summary: Download built file
 *     description: Download the compiled APK or AAB file for a completed build
 *     parameters:
 *       - in: path
 *         name: job_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The build job ID
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [apk, aab]
 *         description: |
 *           File type to download:
 *           - `apk` — Android Package (direct install)
 *           - `aab` — Android App Bundle (for Play Store)
 *     responses:
 *       200:
 *         description: The built file
 *         content:
 *           application/vnd.android.package-archive:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Build not complete or invalid type
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Job or file not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/download/:job_id/:type', (req, res) => {
  const { job_id, type } = req.params;

  if (!['apk', 'aab'].includes(type)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid type. Must be "apk" or "aab"',
    });
  }

  const job = getJob(job_id);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }

  if (job.status !== 'success') {
    return res.status(400).json({
      success: false,
      error: `Build is not complete. Current status: ${job.status}`,
    });
  }

  const outputDir = path.join(__dirname, '..', 'outputs', job_id);
  const ext = type === 'apk' ? 'apk' : 'aab';
  const filename = `${job.app_name.replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
  const filePath = path.join(outputDir, filename);

  res.download(filePath, filename, (err) => {
    if (err) {
      res.status(404).json({
        success: false,
        error: `File not found: ${filename}`,
      });
    }
  });
});

/**
 * @swagger
 * /jobs:
 *   get:
 *     tags: [Jobs]
 *     summary: List all build jobs
 *     description: Returns all build jobs sorted by newest first
 *     responses:
 *       200:
 *         description: List of all jobs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       status:
 *                         type: string
 *                         enum: [queued, building, success, failed]
 *                       app_name:
 *                         type: string
 *                       target_url:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                         format: date-time
 */
app.get('/jobs', (req, res) => {
  res.json({ jobs: getAllJobs() });
});

/**
 * @swagger
 * components:
 *   schemas:
 *     Error:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error:
 *           type: string
 *           example: "Missing required fields: app_name and target_url are required"
 */

// Health check & API info
app.get('/', (req, res) => {
  res.json({
    service: 'Web2APK Builder API',
    version: '1.0.0',
    docs: '/docs',
    docs_json: '/docs.json',
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Web2APK Builder API running on port ${PORT}`);
  console.log(`📖 Swagger docs available at http://localhost:${PORT}/docs`);
});
