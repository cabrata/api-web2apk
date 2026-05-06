const { v4: uuidv4 } = require('uuid');

const jobs = new Map();
const MAX_CONCURRENT = 2;
let activeBuilds = 0;
const queue = [];

function createJob(params) {
  const id = uuidv4();
  const job = {
    id,
    status: 'queued',
    // Core params
    app_name: params.app_name,
    target_url: params.target_url,
    icon_url: params.icon_url || null,
    version_code: params.version_code || 1,
    version_name: params.version_name || '1.0.0',
    // Customization params
    primary_color: params.primary_color || '#1976D2',
    accent_color: params.accent_color || '#FF4081',
    splash_color: params.splash_color || '#FFFFFF',
    nav_bar_color: params.nav_bar_color || '#FFFFFF',
    show_nav_bar: params.show_nav_bar !== false,
    pull_to_refresh: params.pull_to_refresh !== false,
    splash_screen: params.splash_screen !== false,
    fullscreen: params.fullscreen === true,
    orientation: params.orientation || 'both',
    // Status tracking
    progress: 'Queued, waiting for available build slot...',
    error: null,
    created_at: new Date().toISOString(),
    completed_at: null,
    downloads: null,
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function updateJob(id, updates) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, updates);
  jobs.set(id, job);
  return job;
}

function getAllJobs() {
  return Array.from(jobs.values()).sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
}

function enqueue(job, buildFn) {
  const task = { job, buildFn };

  if (activeBuilds < MAX_CONCURRENT) {
    runTask(task);
  } else {
    queue.push(task);
  }
}

async function runTask(task) {
  activeBuilds++;
  try {
    await task.buildFn(task.job);
  } catch (err) {
    updateJob(task.job.id, {
      status: 'failed',
      progress: `Build failed: ${err.message}`,
      error: err.message,
      completed_at: new Date().toISOString(),
    });
  } finally {
    activeBuilds--;
    if (queue.length > 0) {
      const next = queue.shift();
      runTask(next);
    }
  }
}

module.exports = { createJob, getJob, updateJob, getAllJobs, enqueue };
