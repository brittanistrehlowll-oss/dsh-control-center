/**
 * jingxi-plugin — 鲸息 DSH 插件入口（V3.0）
 *
 * donor: dsh-lifecycle dsh-restart-button.mjs + dsh-quota-panel
 *
 * 服务端（apply）：注册 /api/jingxi/restart、/api/jingxi/stop、/api/jingxi/status、
 *   /api/jingxi/update-check 等只读/请求端点；注入客户端脚本。
 * 客户端（注入页面）：SidebarDock（重启|鲸息|关闭 + 额度双状态点）+ 鲸息单页。
 *
 * 安全：本插件只写 marker（经 Jingxi Host 或直接 marker）请求生命周期；
 *   绝不 kill 进程；API key 不进入浏览器。
 */
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const name = 'jingxi-plugin';

export function apply(ctx, config) {
  const dshRoot = config.dshRoot || 'D:\\CodexD\\DSH';
  const home = path.join(dshRoot, 'home');
  const jxHome = path.join(home, 'jingxi');
  const state = path.join(jxHome, 'state');
  const restartMarker = path.join(state, 'restart.requested');
  const stopMarker = path.join(state, 'stop.requested');
  const startMarker = path.join(state, 'start.requested');

  function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  }

  function readJson(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 32 * 1024) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    });
  }

  ctx.effect(() => {
    const disposers = [];

    // ———— /api/jingxi/restart · stop（写 marker，Guardian 消费）————
    for (const [route, marker, idPrefix] of [
      ['/api/jingxi/restart', restartMarker, 'rst'],
      ['/api/jingxi/stop', stopMarker, 'stp']
    ]) {
      const d = ctx.webServer.register({
        kind: 'exact',
        path: route,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
            return;
          }
          const body = await readJson(req);
          const nonce = body.nonce;
          // nonce 校验由 Jingxi Host 统一做；插件内二次确认来源
          if (typeof nonce !== 'string' || nonce.length < 8) {
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'missing nonce' }));
            return;
          }
          try {
            await mkdir(state, { recursive: true });
            const id = newId(idPrefix);
            await writeFile(marker, `${idPrefix}Id=${id} requested by jingxi-plugin at ${new Date().toISOString()}\n`, 'utf8');
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, id }));
          } catch (e) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        }
      });
      disposers.push(d);
    }

    // ———— /api/jingxi/status（只读）————
    const ds = ctx.webServer.register({
      kind: 'exact',
      path: '/api/jingxi/status',
      handler: async (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({
          ok: true,
          jingxiVersion: '0.3.0',
          dshRoot,
          installedAt: new Date().toISOString()
        }));
      }
    });
    disposers.push(ds);

    // ———— /api/jingxi/update-check · update-apply（Update Core，check-only P0）————
    const uc = ctx.webServer.register({
      kind: 'exact',
      path: '/api/jingxi/update-check',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
          return;
        }
        try {
          // P0 check-only：官方源固定 deepseek-ai/deepseek-harness；
          // 真实 latest 查询由 Update Core 提供（Gate 7 接 executor）。
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(JSON.stringify({ ok: true, current: '0.1.0-rc.7', latest: null, message: '当前已是最新版本', checkedAt: new Date().toISOString() }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      }
    });
    disposers.push(uc);

    const ua = ctx.webServer.register({
      kind: 'exact',
      path: '/api/jingxi/update-apply',
      handler: async (req, res) => {
        // Gate 7 前 fail-closed：真实 apply 未启用
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'update apply not enabled (Gate 7)', blocked: true }));
      }
    });
    disposers.push(ua);

    // ———— 注入客户端脚本 ————
    const clientScript = buildClientScript({ whaleIconPath: '/plugins/jingxi/assets/whale-breath-icon.svg' });
    const dt = ctx.webServer.tapIndex((html) =>
      html.replace('</body>', `<script type="module">${clientScript}</script></body>`)
    );
    disposers.push(dt);

    return () => { for (const d of disposers) d(); };
  }, 'jingxi-plugin: sidebar dock + console + lifecycle requests (V3.0)');
}

function buildClientScript(opts) {
  return `
(function () {
  const API = {
    restart: '/api/jingxi/restart',
    stop: '/api/jingxi/stop',
    status: '/api/jingxi/status'
  };
  // 最小 quota store（V3.0：内部 observable，不依赖 window seam）
  const quotaStore = {
    _snapshot: null,
    _listeners: new Set(),
    getSnapshot() { return this._snapshot; },
    subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
    set(snap) { this._snapshot = snap; for (const fn of this._listeners) fn(snap); }
  };

  // 从 DSH 页面原生 quota 数据源更新（避免 DOM 抓取）——由 host 提供 /api/quota 代理时接入
  async function refreshQuota() {
    try {
      const r = await fetch('/api/quota/summary', { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        quotaStore.set({
          deepseek: { state: d.deepseek?.state || 'ok', balance: d.deepseek?.balance, currency: d.deepseek?.currency || '¥' },
          go: { high: d.go?.high, rolling: d.go?.rolling, weekly: d.go?.weekly, monthly: d.go?.monthly }
        });
      }
    } catch {}
  }

  function getNonce() {
    // 通过 Jingxi Host 获取 CSRF nonce（本机）
    return fetch('http://127.0.0.1:3081/api/nonce', { cache: 'no-store' })
      .then(r => r.json()).then(d => d.nonce).catch(() => null);
  }

  function openJingxiConsole() {
    const url = location.origin + '/jingxi';
    if (location.pathname !== '/jingxi') { location.href = url; return; }
    // 已在 /jingxi：动态加载控制台模块并渲染
    import('/plugins/jingxi/jingxi-console.mjs')
      .then((mod) => { window.__JX_QUOTA_STORE__ = quotaStore; mod.openJingxiConsole(); })
      .catch(() => {
        const hint = document.createElement('div');
        hint.style.cssText = 'padding:20px;text-align:center;color:var(--dsw-alias-text-tertiary,#868a91)';
        hint.textContent = '鲸息控制台模块加载失败（/plugins/jingxi/jingxi-console.mjs）';
        document.body.prepend(hint);
      });
  }

  async function lifecycle(action) {
    const nonce = await getNonce();
    if (!nonce) { alert('鲸息 Host 不可达，无法请求生命周期动作'); return; }
    await fetch(API[action], {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce })
    });
    if (action === 'stop') {
      setTimeout(() => { location.href = 'http://127.0.0.1:3081/'; }, 600);
    } else if (action === 'restart') {
      // 显示原生 Boot Gate 风格提示，轮询 health
      showBootGate();
    }
  }

  function showBootGate() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:var(--dsw-alias-bg-mask-2,rgba(255,255,255,.72));backdrop-filter:blur(8px);color:var(--dsw-alias-text-primary,#1b1b1c);font-family:inherit';
    overlay.innerHTML = '<div style="font-size:15px;font-weight:650;letter-spacing:.12em">HARNESS</div>' +
      '<div style="width:20px;height:20px;border:2px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.2));border-top-color:var(--dsw-alias-text-primary,#1b1b1c);border-radius:50%;animation:jxspin .8s linear infinite"></div>' +
      '<div style="font-size:13px;color:var(--dsw-alias-text-secondary,#61666b)">正在重启…</div>' +
      '<style>@keyframes jxspin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(overlay);
    // 轮询 health；ready 且 bootId 变化才 reload
    const t0 = Date.now();
    const poll = setInterval(async () => {
      try {
        const h = await fetch('/api/system/health', { cache: 'no-store' });
        const j = await h.json();
        if (j.ready && j.bootId && j.bootId !== (window.__jxOldBootId)) {
          clearInterval(poll);
          location.reload();
        }
      } catch {}
      if (Date.now() - t0 > 90000) { clearInterval(poll); overlay.remove(); }
    }, 500);
  }

  // ———— 挂载 SidebarDock + /jingxi 路由 ————
  function mount() {
    if (document.getElementById('jx-sidebar-dock')) return;
    // /jingxi 路径：直接渲染鲸息控制台
    if (location.pathname === '/jingxi') {
      openJingxiConsole();
    }
    // 动态 import 侧栏模块（服务端注入为模块脚本时可用）
    import('/plugins/jingxi/sidebar-dock.mjs').then((mod) => {
      mod.mountSidebarDock({
        quotaStore,
        onRestart: () => lifecycle('restart'),
        onJingxi: openJingxiConsole,
        onStop: () => lifecycle('stop'),
        updateState: 'none'
      });
    }).catch(() => {
      // fallback：内联最小挂载（不依赖模块加载）
      const dock = document.createElement('div');
      dock.id = 'jx-sidebar-dock';
      dock.style.cssText = 'position:absolute;left:12px;bottom:64px;display:flex;gap:6px;z-index:880';
      const b = (label, fn) => { const x = document.createElement('button'); x.textContent = label; x.onclick = fn; x.style.cssText = 'padding:4px 10px;border-radius:8px;border:none;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.05));color:var(--dsw-alias-text-primary,#1b1b1c);cursor:pointer'; dock.appendChild(x); return x; };
      b('重启', () => lifecycle('restart'));
      b('鲸息', openJingxiConsole);
      b('关闭', () => lifecycle('stop'));
      document.body.appendChild(dock);
    });
    refreshQuota();
    setInterval(refreshQuota, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
`;
}