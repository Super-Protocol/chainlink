const http = require('http');
const https = require('https');
const { URL } = require('url');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = parseInt(process.env.PROCESS_METRICS_PORT || '3003', 10);
const INTERVAL_MS = Math.max(1000, parseInt(process.env.PROCESS_METRICS_INTERVAL_MS || '5000', 10));
const SERVICES_REFRESH_MS = Math.max(10000, parseInt(process.env.PROCESS_METRICS_SERVICES_REFRESH_MS || '60000', 10));

// Optional Pushgateway config (disabled by default)
let PUSH_ENABLED = String(process.env.PROCESS_METRICS_PUSH_ENABLED || 'false').toLowerCase() === 'true';
let PUSH_URL_RAW = process.env.PROCESS_METRICS_PUSH_URL || '';
let PUSH_INTERVAL_MS = Math.max(1000, parseInt(process.env.PROCESS_METRICS_PUSH_INTERVAL_MS || String(INTERVAL_MS), 10));
let PUSH_JOB = process.env.PROCESS_METRICS_PUSH_JOB || 'process-metrics';
let PUSH_BASIC_AUTH = process.env.PROCESS_METRICS_PUSH_BASIC_AUTH || '';
let PUSH_BASIC_AUTH_USER = process.env.PROCESS_METRICS_PUSH_BASIC_AUTH_USER || '';
let PUSH_BASIC_AUTH_PASS = process.env.PROCESS_METRICS_PUSH_BASIC_AUTH_PASS || '';
let PUSH_TIMEOUT_MS = Math.max(100, parseInt(process.env.PROCESS_METRICS_PUSH_TIMEOUT_MS || '5000', 10));
let PUSH_HEADERS = {};
try {
  PUSH_HEADERS = process.env.PROCESS_METRICS_PUSH_HEADERS ? JSON.parse(process.env.PROCESS_METRICS_PUSH_HEADERS) : {};
} catch {
  PUSH_HEADERS = {};
}

// Static labels added to every metric line (to distinguish exporter/env)
// Supports JSON via PROCESS_METRICS_STATIC_LABELS, and a shorthand PROCESS_METRICS_ENV
let STATIC_LABELS = { exporter: 'chainlink-process-metrics' };
try {
  const parsed = process.env.PROCESS_METRICS_STATIC_LABELS ? JSON.parse(process.env.PROCESS_METRICS_STATIC_LABELS) : {};
  if (parsed && typeof parsed === 'object') STATIC_LABELS = { ...STATIC_LABELS, ...parsed };
} catch {}
if (process.env.PROCESS_METRICS_ENV) {
  STATIC_LABELS.env = process.env.PROCESS_METRICS_ENV;
}

// Grouping labels for Pushgateway path
let PUSH_GROUPING_LABELS = {};
function sanitizeGroupingLabels(obj) {
  try {
    if (!obj || typeof obj !== 'object') return {};
    const copy = { ...obj };
    // Do not allow static 'service' in grouping to avoid overwriting dynamic label
    if ('service' in copy) delete copy.service;
    return copy;
  } catch {
    return {};
  }
}

// Optional TTL for metrics (seconds). If supported by receiver, appended as query param; always added as label.
let TTL_SECONDS = Math.max(60, parseInt(process.env.PROCESS_METRICS_TTL_SECONDS || '3600', 10));
try {
  const parsed = process.env.PROCESS_METRICS_PUSH_GROUPING_LABELS ? JSON.parse(process.env.PROCESS_METRICS_PUSH_GROUPING_LABELS) : {};
  if (parsed && typeof parsed === 'object') PUSH_GROUPING_LABELS = sanitizeGroupingLabels(parsed);
} catch {}

let latestSnapshot = {
  timestamp: Date.now(),
  processes: [], // {service, pid, name, cpu, rssKb}
};

// Track spawned child processes to terminate them on shutdown
const CHILD_PROCS = new Set();
function execFileTracked(cmd, args, options, cb) {
  const opts = {
    timeout: 5000,
    killSignal: 'SIGKILL',
    maxBuffer: 512 * 1024,
    ...options,
  };
  const child = execFile(cmd, args, opts, cb);
  try {
    CHILD_PROCS.add(child);
    const cleanup = () => CHILD_PROCS.delete(child);
    child.on('exit', cleanup).on('error', cleanup).on('close', cleanup);
  } catch {}
  return child;
}

function readFileInt(p, defaultValue = 0) {
  try {
    const data = fs.readFileSync(p, 'utf8').trim();
    const num = parseInt(data, 10);
    return Number.isFinite(num) ? num : defaultValue;
  } catch {
    return defaultValue;
  }
}

let cachedServices = [];
let lastServicesRefresh = 0;

function refreshServicesNow() {
  const rcDir = '/etc/s6-overlay/s6-rc.d/user/contents.d';
  const runDir = '/run/service';
  const discovered = new Set();

  // Discover declared longruns (s6-rc)
  try {
    const files = fs.readdirSync(rcDir);
    for (const file of files) {
      const service = file;
      const typeFile = `/etc/s6-overlay/s6-rc.d/${service}/type`;
      try {
        const type = fs.readFileSync(typeFile, 'utf8').trim();
        if (type === 'longrun') discovered.add(service);
      } catch {}
    }
  } catch {}

  // Discover runtime services created dynamically under /etc/services.d (visible via /run/service)
  try {
    const live = fs.readdirSync(runDir);
    for (const name of live) {
      // Only include entries that look like service directories/symlinks
      if (!name || name.startsWith('.')) continue;
      discovered.add(name);
    }
  } catch {}

  const list = Array.from(discovered.values()).sort();
  if (list.length > 0) {
    cachedServices = list;
    lastServicesRefresh = Date.now();
  }
}

function getCachedServices() {
  const now = Date.now();
  if (now - lastServicesRefresh > SERVICES_REFRESH_MS || cachedServices.length === 0) {
    refreshServicesNow();
  }
  return cachedServices;
}

function getPidForService(service, callback) {
  const svcPath = path.join('/run/service', service);
  execFileTracked('/command/s6-svstat', ['-o', 'pid', svcPath], undefined, (err, stdout) => {
    if (err) return callback(null, null);
    const txt = String(stdout || '').trim();
    const pid = parseInt(txt, 10);
    if (!Number.isFinite(pid) || pid <= 0) return callback(null, null);
    return callback(null, pid);
  });
}

function getProcessesForServices(services, callback) {
  const results = [];
  let remaining = services.length;
  if (remaining === 0) return callback(null, results);
  const serviceToPid = new Map();

  for (const service of services) {
    getPidForService(service, (_e, pid) => {
      if (pid) serviceToPid.set(service, pid);
      if (--remaining === 0) {
        const pids = Array.from(serviceToPid.values());
        if (pids.length === 0) return callback(null, results);
        const pidList = pids.join(',');
        execFileTracked('ps', ['-p', pidList, '-o', 'pid,comm,pcpu,rss', '--no-headers'], undefined, (err, stdout) => {
          if (!err) {
            const lines = String(stdout || '').trim().split(/\n+/);
            const pidInfo = new Map();
            for (const line of lines) {
              const parts = line.trim().split(/\s+/);
              if (parts.length >= 4) {
                const pid = parseInt(parts[0], 10);
                const name = parts[1];
                const cpu = parseFloat(parts[2]);
                const rssKb = parseInt(parts[3], 10);
                pidInfo.set(pid, {
                  name,
                  cpu: Number.isFinite(cpu) ? cpu : 0,
                  rssKb: Number.isFinite(rssKb) ? rssKb : 0,
                });
              }
            }
            for (const [service, pid] of serviceToPid.entries()) {
              const info = pidInfo.get(pid);
              if (info) {
                results.push({ service, pid, name: info.name, cpu: info.cpu, rssKb: info.rssKb });
              }
            }
          }
          return callback(null, results);
        });
      }
    });
  }
}

function buildMetrics() {
  const lines = [];

  lines.push('# HELP chainlink_process_list List of tracked processes with pid');
  lines.push('# TYPE chainlink_process_list gauge');
  for (const p of latestSnapshot.processes) {
    const labels = formatLabels({ service: normalizeService(p.service), process: p.name, pid: String(p.pid) });
    lines.push(`chainlink_process_list${labels} 1`);
  }

  lines.push('# HELP chainlink_process_cpu_percent CPU usage percent per process');
  lines.push('# TYPE chainlink_process_cpu_percent gauge');
  for (const p of latestSnapshot.processes) {
    const labels = formatLabels({ service: normalizeService(p.service), process: p.name, pid: String(p.pid) });
    lines.push(`chainlink_process_cpu_percent${labels} ${p.cpu}`);
  }

  lines.push('# HELP chainlink_process_memory_rss_kb Resident set size in KB per process');
  lines.push('# TYPE chainlink_process_memory_rss_kb gauge');
  for (const p of latestSnapshot.processes) {
    const labels = formatLabels({ service: normalizeService(p.service), process: p.name, pid: String(p.pid) });
    lines.push(`chainlink_process_memory_rss_kb${labels} ${p.rssKb}`);
  }

  lines.push('# HELP chainlink_s6_service_restart_count Number of restarts detected by s6 finish script');
  lines.push('# TYPE chainlink_s6_service_restart_count counter');
  for (const service of getCachedServices()) {
    const dir = `/run/service/${service}`;
    const count = readFileInt(`${dir}/restart-count`, 0);
    const labels = formatLabels({ service: normalizeService(service) });
    lines.push(`chainlink_s6_service_restart_count${labels} ${count}`);
  }

  lines.push('# HELP chainlink_s6_service_last_restart_ts Last restart unix timestamp (seconds)');
  lines.push('# TYPE chainlink_s6_service_last_restart_ts gauge');
  for (const service of getCachedServices()) {
    const dir = `/run/service/${service}`;
    const ts = readFileInt(`${dir}/last-restart`, 0);
    const labels = formatLabels({ service: normalizeService(service) });
    lines.push(`chainlink_s6_service_last_restart_ts${labels} ${ts}`);
  }

  return lines.join('\n') + '\n';
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '').replace(/"/g, '\\"');
}

function formatLabels(dynamicLabels) {
  const merged = { ttl: String(TTL_SECONDS), ...STATIC_LABELS, ...dynamicLabels };
  const parts = [];
  for (const [k, v] of Object.entries(merged)) {
    parts.push(`${k}="${escapeLabel(v)}"`);
  }
  return parts.length ? `{${parts.join(',')}}` : '';
}

function normalizeService(serviceName) {
  const needsPrefix = new Set([
    'postgres',
    'price-aggregator',
    'process-metrics',
    's6-linux-init-shutdownd',
    's6rc-fdholder',
    's6rc-oneshot-runner',
  ]);
  if (needsPrefix.has(serviceName)) return `chainlink-${serviceName}`;
  return serviceName;
}

let samplingInProgress = false;
let consecutiveSampleFailures = 0;
const MAX_SAMPLE_FAILURES = Math.max(1, parseInt(process.env.PROCESS_METRICS_MAX_SAMPLE_FAILURES || '12', 10));
function sampleNow() {
  if (samplingInProgress) return;
  samplingInProgress = true;
  const services = getCachedServices();
  getProcessesForServices(services, (err, processes) => {
    if (!err && Array.isArray(processes)) {
      latestSnapshot = { timestamp: Date.now(), processes };
      if (processes.length > 0) {
        consecutiveSampleFailures = 0;
      } else {
        consecutiveSampleFailures += 1;
      }
    } else {
      consecutiveSampleFailures += 1;
    }
    samplingInProgress = false;

    if (consecutiveSampleFailures >= MAX_SAMPLE_FAILURES) {
      try { console.error(`[process-metrics] sampling failed ${consecutiveSampleFailures} times in a row; exiting`); } catch {}
      // Let s6 restart the service; finish script will terminate the tree after repeated failures
      process.exit(1);
    }
  });
}

setInterval(sampleNow, INTERVAL_MS).unref();
sampleNow();

const server = http.createServer((req, res) => {
  if (req.url === '/metrics') {
    const body = buildMetrics();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.end(body);
    return;
  }
  if (req.url === '/healthz') {
    res.statusCode = 200;
    res.end('ok');
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[process-metrics] listening on :${PORT}, interval ${INTERVAL_MS}ms, services refresh ${SERVICES_REFRESH_MS}ms`);
});

// Optional file-based configuration (similar to price-aggregator metricsPush)
const CONFIG_FILE_PATH = process.env.PROCESS_METRICS_CONFIG_FILE || '/etc/process-metrics/config.json';
function loadConfigFile() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg && typeof cfg === 'object') {
      if (cfg.enabled === true) PUSH_ENABLED = true;
      if (typeof cfg.url === 'string') PUSH_URL_RAW = cfg.url;
      if (typeof cfg.intervalMs === 'number' && Number.isFinite(cfg.intervalMs)) {
        PUSH_INTERVAL_MS = Math.max(1000, cfg.intervalMs | 0);
      }
      if (typeof cfg.jobName === 'string') PUSH_JOB = cfg.jobName;
      if (cfg.groupingLabels && typeof cfg.groupingLabels === 'object') {
        PUSH_GROUPING_LABELS = { ...PUSH_GROUPING_LABELS, ...sanitizeGroupingLabels(cfg.groupingLabels) };
        if (typeof cfg.groupingLabels.instance === 'string') {
          // Override static label instance from config file, not os.hostname
          STATIC_LABELS.instance = cfg.groupingLabels.instance;
        }
      }
      if (cfg.basicAuth && typeof cfg.basicAuth === 'object') {
        if (typeof cfg.basicAuth.username === 'string') PUSH_BASIC_AUTH_USER = cfg.basicAuth.username;
        if (typeof cfg.basicAuth.password === 'string') PUSH_BASIC_AUTH_PASS = cfg.basicAuth.password;
      }
      if (cfg.headers && typeof cfg.headers === 'object') {
        PUSH_HEADERS = { ...PUSH_HEADERS, ...cfg.headers };
      }
      if (typeof cfg.timeoutMs === 'number' && Number.isFinite(cfg.timeoutMs)) {
        PUSH_TIMEOUT_MS = Math.max(100, cfg.timeoutMs | 0);
      }
      console.log('[process-metrics] loaded push config from file');
    }
  } catch {
    // no file or invalid — ignore
  }
}

// Load file config before scheduling push
loadConfigFile();

// Optional push to Pushgateway
function resolvePushUrl() {
  if (!PUSH_URL_RAW) return null;
  try {
    const base = new URL(PUSH_URL_RAW);
    // If path already contains /metrics/job/, use as-is; otherwise append /metrics/job/<job>
    const grouping = { ...PUSH_GROUPING_LABELS };
    // If instance not provided, fall back to STATIC_LABELS.instance or hostname
    if (!grouping.instance) grouping.instance = STATIC_LABELS.instance || os.hostname();
    // Avoid label collision with dynamic metric label 'service'
    if ('service' in grouping) delete grouping.service;
    if (!base.pathname.includes('/metrics/job/')) {
      let pathname = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname;
      pathname = `${pathname}/metrics/job/${encodeURIComponent(PUSH_JOB)}`;
      // Append grouping labels to path: /label/value
      for (const [k, v] of Object.entries(grouping)) {
        pathname += `/${encodeURIComponent(k)}/${encodeURIComponent(String(v))}`;
      }
      base.pathname = pathname;
    }
    // Append TTL as query param if receiver supports it; harmless otherwise
    const params = base.searchParams;
    if (!params.get('ttl')) params.set('ttl', String(TTL_SECONDS));
    return base;
  } catch {
    return null;
  }
}

function pushOnce() {
  const urlObj = resolvePushUrl();
  if (!urlObj) return;
  const body = buildMetrics();
  const isHttps = urlObj.protocol === 'https:';
  const agent = isHttps ? https : http;
  const headers = {
    'Content-Type': 'text/plain; version=0.0.4',
    'Content-Length': Buffer.byteLength(body),
  };
  // Merge user headers
  for (const [hk, hv] of Object.entries(PUSH_HEADERS)) {
    headers[hk] = String(hv);
  }
  const authPlain = PUSH_BASIC_AUTH || (PUSH_BASIC_AUTH_USER && PUSH_BASIC_AUTH_PASS ? `${PUSH_BASIC_AUTH_USER}:${PUSH_BASIC_AUTH_PASS}` : '');
  if (authPlain) {
    const token = Buffer.from(authPlain, 'utf8').toString('base64');
    headers['Authorization'] = `Basic ${token}`;
  }
  const options = {
    method: 'PUT',
    hostname: urlObj.hostname,
    port: urlObj.port || (isHttps ? 443 : 80),
    path: `${urlObj.pathname}${urlObj.search || ''}`,
    headers,
    timeout: PUSH_TIMEOUT_MS,
  };
  const req = agent.request(options, (res) => {
    // Drain response silently
    res.resume();
  });
  req.on('error', () => {});
  req.write(body);
  req.end();
}

let pushTimer;
if (PUSH_ENABLED) {
  pushTimer = setInterval(() => {
    // Push the latest cached snapshot to keep parity with /metrics
    pushOnce();
  }, PUSH_INTERVAL_MS);
  pushTimer.unref();
  // Initial push after first sample
  setTimeout(() => {
    pushOnce();
  }, Math.min(PUSH_INTERVAL_MS, 2000)).unref();
}

// Graceful shutdown: stop timers, close server, kill children, then exit
function shutdown(code = 0) {
  try { server.close(); } catch {}
  try { clearInterval(pushTimer); } catch {}
  try { /* sample interval */ } catch {}
  try {
    for (const child of Array.from(CHILD_PROCS)) {
      try { child.kill('SIGKILL'); } catch {}
    }
  } catch {}
  process.exit(code);
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('SIGQUIT', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));
process.on('uncaughtException', (err) => {
  try { console.error('[process-metrics] uncaughtException', err && err.stack || String(err)); } catch {}
  shutdown(1);
});
process.on('unhandledRejection', (reason) => {
  try { console.error('[process-metrics] unhandledRejection', reason); } catch {}
  shutdown(1);
});
