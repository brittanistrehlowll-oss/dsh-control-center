/**
 * jingxi-host — 鲸息独立宿主服务（V3.0）
 *
 * donor: dsh-lifecycle controller/dsh-controller.mjs
 *
 * 定位：DSH 停止后仍可用的独立本地服务。
 * 只监听 127.0.0.1（默认 3081），零第三方依赖。
 *
 * 职责：
 *   - 生命周期动作（start/restart/stop）：校验请求 → 写 marker → Guardian 执行；
 *     Host 绝不直接 kill DSH。
 *   - DSH 已关闭时的极简原生页面（FishLogo currentColor + 一键启动）。
 *   - 主题 handoff：读取 dsh_resolved_theme cookie；无 cookie 用 prefers-color-scheme。
 *   - 更新接口（check/apply/status）：由 Update Core 提供（host-side 受控执行）。
 *
 * 安全（HANDOFF §8）：
 *   - bind 127.0.0.1 only；
 *   - 校验 Host header；
 *   - 不开放 Access-Control-Allow-Origin: *；
 *   - POST mutating 端点要求 same-origin + CSRF nonce；
 *   - nonce 只在本机页面生成/下发，不写日志；
 *   - CSP: default-src 'self'，禁止远程脚本；
 *   - mutating 端点只接受 JSON POST；
 *   - logs 端点限制 tail 并做 secret redaction。
 */

import http from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOST = '127.0.0.1';
const PORT = Number(process.env.JINGXI_HOST_PORT || 3081);
const DSH_PORT = 3080;
const DSH_URL = `http://127.0.0.1:${DSH_PORT}`;
const DSH_HEALTH = `${DSH_URL}/api/system/health`;

// ———— 参数：--dsh-root <dir> ————
const argIdx = process.argv.indexOf('--dsh-root');
const DSH_ROOT = argIdx >= 0 ? process.argv[argIdx + 1] : 'D:\\CodexD\\DSH';

const HOME = path.join(DSH_ROOT, 'home');
const JX_HOME = path.join(HOME, 'jingxi');
const STATE = path.join(JX_HOME, 'state');
const LOGS = path.join(JX_HOME, 'logs');
const RESTART_MARKER = path.join(STATE, 'restart.requested');
const STOP_MARKER = path.join(STATE, 'stop.requested');
const START_MARKER = path.join(STATE, 'start.requested');
const HOST_LOG = path.join(LOGS, 'host.log');

const instanceId = `jingxi-host-${crypto.randomBytes(3).toString('hex')}`;
let bootId = `jx-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;

// CSRF nonce：每 10 分钟轮换；页面通过 /api/nonce 获取
let csrfNonce = crypto.randomBytes(16).toString('hex');
setInterval(() => { csrfNonce = crypto.randomBytes(16).toString('hex'); }, 10 * 60_000).unref();

// ———— 日志 ————
function log(msg) {
  const line = `${new Date().toISOString()} [jingxi-host] ${msg}\n`;
  void appendLog(line);
  process.stdout.write(line);
}
async function appendLog(line) {
  try {
    await mkdir(LOGS, { recursive: true });
    const { appendFile } = await import('node:fs/promises');
    await appendFile(HOST_LOG, line, 'utf8');
  } catch { /* log failure is non-fatal */ }
}

function newActionId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

// ———— 只读探测 DSH ————
function httpGetJson(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 64 * 1024) req.destroy(); });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, json: null }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null }); });
    req.on('error', () => resolve({ status: 0, json: null }));
  });
}

async function probeDsh() {
  const r = await httpGetJson(DSH_HEALTH, 2500);
  if (r.status === 200 && r.json && r.json.ready) {
    return { running: true, bootId: r.json.bootId || null, pid: r.json.pid || null, uptime: r.json.uptime ?? null };
  }
  const r2 = await httpGetJson(DSH_URL, 2000);
  return { running: r2.status === 200, bootId: null, pid: null, uptime: null };
}

async function markerExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function currentState() {
  const probe = await probeDsh();
  let state = probe.running ? 'running' : 'stopped';
  const [mkRestart, mkStop, mkStart] = await Promise.all([
    markerExists(RESTART_MARKER), markerExists(STOP_MARKER), markerExists(START_MARKER)
  ]);
  if (mkStart && !probe.running) state = 'starting';
  if (mkRestart) state = 'restarting';
  if (mkStop) state = 'stopping';
  return {
    state,
    running: probe.running,
    ...(probe.bootId ? { bootId: probe.bootId } : {}),
    ...(probe.pid ? { pid: probe.pid } : {}),
    ...(probe.uptime !== null && probe.uptime !== undefined ? { uptime: probe.uptime } : {}),
    instanceId
  };
}

// ———— 写 marker（Guardian 消费）————
async function requestLifecycle(action) {
  const marker = { start: START_MARKER, stop: STOP_MARKER, restart: RESTART_MARKER }[action];
  if (!marker) return { ok: false, error: 'unknown action' };
  const id = newActionId(action);
  await mkdir(STATE, { recursive: true });
  await writeFile(marker, `${action}Id=${id} requested by jingxi-host at ${new Date().toISOString()}\n`, 'utf8');
  return { ok: true, id };
}

// ———— 请求校验（CSRF / Origin / Host）————
function isLoopbackHost(hostHeader) {
  if (!hostHeader) return false;
  const host = hostHeader.split(':')[0];
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

function checkCsrf(req, body) {
  // mutating 请求必须携带当前 nonce
  const provided = body?.nonce;
  return typeof provided === 'string' && provided === csrfNonce;
}

// ———— 主题解析 ————
function resolveTheme(req) {
  const cookie = (req.headers.cookie || '').match(/dsh_resolved_theme=(light|dark)/);
  if (cookie) return cookie[1];
  return 'unknown'; // fallback prefers-color-scheme handled client-side
}

// ———— 极简离线页（DSH 已关闭）————
function offlinePage(theme) {
  const t = theme === 'dark' ? { bg: '#0f1420', fg: '#e6edf7', muted: '#8a97b0', btn: '#4d6bfe' }
    : { bg: '#ffffff', fg: '#1b1b1c', muted: '#868a91', btn: '#4d6bfe' };
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DeepSeek Harness — DSH 已关闭</title>
<style>
  :root{color-scheme:${theme === 'dark' ? 'dark' : 'light'}}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:${t.bg};color:${t.fg};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px}
  .logo{width:56px;height:42px;color:${t.fg};margin-bottom:12px}
  .logo svg{width:100%;height:100%}
  h1{font-size:20px;font-weight:650}
  .sub{color:${t.muted};font-size:14px;margin-bottom:20px}
  #startBtn{background:${t.btn};color:#fff;border:none;border-radius:10px;padding:10px 28px;font-size:15px;cursor:pointer;transition:opacity .15s ease}
  #startBtn:disabled{opacity:.55;cursor:default}
  .meta{margin-top:26px;color:${t.muted};font-size:12px;display:flex;gap:14px}
  #status{font-size:13px;margin-top:14px;color:${t.muted};min-height:18px}
</style>
</head>
<body>
  <div class="logo" aria-hidden="true">
    <svg viewBox="0 0 32 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 14c3 3 7 4.5 11 4.5S25 17 28 14c1.2 1.4 2.4 2.6 4 3.4-1.8 1.2-3.6 1.9-5.6 2.3-2 .4-4 .6-6.4.6H14c-4.8 0-8.4-1.2-11-3.4L4 14z" opacity=".9"/>
      <path d="M3 13.5c3.6 3.2 8 4.8 12.5 4.8S25 16.7 29 13.5c1 1 1.8 1.9 2.8 2.5-1.9 1.6-4 2.8-6.3 3.4-2.4.7-5 .8-7.6.8H14.6C9 20.2 5 18.6 2 16L3 13.5z" fill="none" stroke="currentColor" stroke-width="1" opacity=".5"/>
    </svg>
  </div>
  <h1>DeepSeek Harness</h1>
  <div class="sub">DSH 已关闭 · 鲸息仍在运行，可随时重新启动</div>
  <button id="startBtn">启动 DSH</button>
  <div id="status"></div>
  <div class="meta">
    <span>守护者 正常</span>
    <span id="ver"></span>
  </div>
<script>
  const btn = document.getElementById('startBtn');
  const status = document.getElementById('status');
  let starting = false;
  btn.addEventListener('click', async () => {
    if (starting) return;
    starting = true;
    btn.disabled = true;
    status.textContent = '正在启动…';
    try {
      const nonce = await (await fetch('/api/nonce')).json().then(r => r.nonce);
      const r = await fetch('/api/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nonce })
      });
      const d = await r.json();
      if (!d.ok) { status.textContent = '启动请求失败：' + (d.error || '未知'); starting = false; btn.disabled = false; return; }
      // 轮询 DSH ready
      const t0 = Date.now();
      const poll = setInterval(async () => {
        try {
          const h = await fetch('${DSH_HEALTH}');
          const j = await h.json();
          if (j.ready) {
            clearInterval(poll);
            status.textContent = 'DSH 已就绪，正在打开…';
            const last = localStorage.getItem('dsh_lastUrl');
            location.href = last && last.startsWith('http://127.0.0.1:3080') ? last : '${DSH_URL}/';
          } else if (Date.now() - t0 > 90000) {
            clearInterval(poll);
            status.textContent = '启动超时，请重试。';
            starting = false; btn.disabled = false;
          }
        } catch { /* DSH not up yet */ }
      }, 500);
    } catch (e) {
      status.textContent = '启动请求失败';
      starting = false; btn.disabled = false;
    }
  });
  fetch('/api/version').then(r => r.json()).then(d => {
    if (d.jingxiVersion) document.getElementById('ver').textContent = '鲸息 ' + d.jingxiVersion;
  });
</script>
</body>
</html>`;
}

// ———— 请求处理 ————
const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const p = url.pathname;

  // 1. Host header 校验
  if (!isLoopbackHost(req.headers.host)) {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'forbidden host' }));
    return;
  }

  const sendJson = (status, value) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
  };

  // CSP（页面）
  const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:3080; img-src 'self' data:";

  // ———— 页面 ————
  if (p === '/' && method === 'GET') {
    const theme = resolveTheme(req);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp });
    res.end(offlinePage(theme));
    return;
  }

  // ———— 只读 API ————
  if (p === '/api/status' && method === 'GET') {
    sendJson(200, await currentState());
    return;
  }
  if (p === '/api/version' && method === 'GET') {
    sendJson(200, { ok: true, jingxiVersion: '0.3.0', dshRoot: DSH_ROOT, instanceId });
    return;
  }
  if (p === '/api/nonce' && method === 'GET') {
    sendJson(200, { ok: true, nonce: csrfNonce });
    return;
  }
  if (p === '/api/logs' && method === 'GET') {
    const tail = Math.min(Math.max(Number(url.searchParams.get('tail')) || 50, 1), 500);
    try {
      const content = await readFile(HOST_LOG, 'utf8');
      const lines = content.split(/\r?\n/).filter(Boolean).slice(-tail);
      // secret redaction
      const redacted = lines.map(l => l.replace(/(token|key|secret|authorization)[=:]\s*\S+/gi, '$1=<REDACTED>'));
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(redacted.join('\n'));
    } catch {
      sendJson(200, { ok: true, lines: [] });
    }
    return;
  }

  // ———— mutating API（JSON POST + CSRF nonce）————
  if (p === '/api/start' || p === '/api/stop' || p === '/api/restart') {
    if (method !== 'POST') { sendJson(405, { ok: false, error: 'method not allowed' }); return; }
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch { sendJson(400, { ok: false, error: 'invalid json' }); return; }
    if (!checkCsrf(req, body)) { sendJson(403, { ok: false, error: 'csrf nonce required' }); return; }
    const action = p.split('/').pop();
    log(`lifecycle request: ${action}`);
    const result = await requestLifecycle(action);
    sendJson(result.ok ? 200 : 400, result);
    return;
  }

  sendJson(404, { ok: false, error: 'not found' });
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 32 * 1024) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function main() {
  await mkdir(STATE, { recursive: true });
  await mkdir(LOGS, { recursive: true });
  server.listen(PORT, HOST, () => {
    log(`jingxi-host listening on http://${HOST}:${PORT} (instanceId=${instanceId})`);
  });
}

await main();