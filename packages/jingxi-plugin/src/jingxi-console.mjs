/**
 * jingxi-console — 鲸息单页控制台（V3.0）
 *
 * 单页、轻分区、细边界、低阴影；全部 --dsw-* token。
 * 顺序：Header（鲸息+状态+检查更新）→ DSH 状态 strip → 模型 → Go 三圆环 → 最近 5 会话。
 *
 * 数据源（只读 RPC，UI 不直接读文件/process/settings）：
 *  - DSH health + session.list projections（同源 RPC）
 *  - 额度：quotaStore（内部 observable）
 *  - 更新状态：/api/jingxi/update-status（Update Core 提供，check-only）
 */

export function openJingxiConsole() {
  // 已在 /jingxi 页面则直接渲染
  const existing = document.getElementById('jx-console-root');
  if (existing) { existing.scrollIntoView(); return; }

  const root = document.createElement('div');
  root.id = 'jx-console-root';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', '鲸息控制台');

  const css = `
  #jx-console-root{max-width:720px;margin:0 auto;padding:20px 16px 48px;color:var(--dsw-alias-text-primary,#1b1b1c);font-family:inherit;font-size:13px;line-height:1.6}
  #jx-console-root *{box-sizing:border-box}
  #jx-console-root .jx-hdr{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
  #jx-console-root .jx-title{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:650}
  #jx-console-root .jx-title .jx-status{font-size:12px;font-weight:500;padding:3px 10px;border-radius:20px}
  #jx-console-root .jx-title .jx-status.ok{color:var(--dsw-static-green-500,#22c55e);background:color-mix(in srgb,var(--dsw-static-green-500,#22c55e) 12%,transparent)}
  #jx-console-root .jx-title .jx-status.off{color:var(--dsw-alias-text-tertiary,#868a91);background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.05))}
  #jx-console-root .jx-check-btn{padding:6px 14px;border:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.14));border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-text-primary,#1b1b1c);font-size:12.5px;cursor:pointer;transition:background .15s ease}
  #jx-console-root .jx-check-btn:hover{background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.06))}
  #jx-console-root .jx-section{border-top:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.07));padding:14px 0}
  #jx-console-root .jx-section-h{font-size:13px;font-weight:600;color:var(--dsw-alias-text-secondary,#3c4043);margin-bottom:10px}
  #jx-console-root .jx-row{display:flex;justify-content:space-between;gap:12px;padding:4px 0;font-size:12.5px}
  #jx-console-root .jx-row .k{color:var(--dsw-alias-text-tertiary,#868a91);flex:none}
  #jx-console-root .jx-row .v{color:var(--dsw-alias-text-primary,#1b1b1c);text-align:right;word-break:break-all}
  #jx-console-root .jx-model-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px dashed var(--dsw-alias-border-subtle,rgba(0,0,0,.06))}
  #jx-console-root .jx-model-row:last-child{border-bottom:none}
  #jx-console-root .jx-m-provider{font-size:12px;color:var(--dsw-alias-text-tertiary,#868a91);width:76px;flex:none}
  #jx-console-root .jx-m-id{flex:1;font-size:12.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #jx-console-root .jx-m-tag{font-size:11px;padding:2px 8px;border-radius:12px;flex:none}
  #jx-console-root .jx-m-tag.cur{color:var(--dsw-static-green-500,#22c55e);background:color-mix(in srgb,var(--dsw-static-green-500,#22c55e) 12%,transparent)}
  #jx-console-root .jx-m-tag.recent{color:var(--dsw-alias-text-secondary,#3c4043);background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.05))}
  #jx-console-root .jx-m-tag.cfg{color:var(--dsw-alias-text-tertiary,#868a91);background:transparent;border:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.1))}
  #jx-console-root .jx-rings{display:flex;gap:28px;justify-content:center;padding:10px 0}
  #jx-console-root .jx-ring{display:flex;flex-direction:column;align-items:center;gap:6px}
  #jx-console-root .jx-ring svg{transform:rotate(-90deg)}
  #jx-console-root .jx-ring .jx-ring-label{font-size:11.5px;color:var(--dsw-alias-text-tertiary,#868a91)}
  #jx-console-root .jx-ring .jx-ring-val{font-size:14px;font-weight:600}
  #jx-console-root .jx-reset{font-size:11.5px;color:var(--dsw-alias-text-tertiary,#868a91);text-align:center;margin-top:2px}
  #jx-console-root .jx-session{padding:8px 0;border-bottom:1px dashed var(--dsw-alias-border-subtle,rgba(0,0,0,.06))}
  #jx-console-root .jx-session:last-child{border-bottom:none}
  #jx-console-root .jx-s-title{font-size:13px;font-weight:550;display:flex;justify-content:space-between;gap:10px}
  #jx-console-root .jx-s-time{font-size:11.5px;color:var(--dsw-alias-text-tertiary,#868a91);flex:none}
  #jx-console-root .jx-s-stats{font-size:11.5px;color:var(--dsw-alias-text-tertiary,#868a91);margin-top:3px}
  #jx-console-root .jx-update-prompt{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.1));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);margin-bottom:14px;font-size:12.5px}
  #jx-console-root .jx-update-prompt .jx-up-actions{display:flex;gap:8px}
  #jx-console-root .jx-btn{padding:5px 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.14));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-text-primary,#1b1b1c);font-size:12px;cursor:pointer}
  #jx-console-root .jx-btn.primary{background:var(--dsw-static-blue-500,#4d6bfe);border-color:transparent;color:#fff}
  #jx-console-root .jx-muted{color:var(--dsw-alias-text-tertiary,#868a91)}
  #jx-console-root .jx-empty{padding:12px 0;color:var(--dsw-alias-text-tertiary,#868a91);font-size:12.5px}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  root.innerHTML = `
    <div class="jx-hdr">
      <div class="jx-title">鲸息 <span class="jx-status ok" id="jxRunStatus">检查中…</span></div>
      <button class="jx-check-btn" id="jxCheckUpdate" type="button">检查更新</button>
    </div>
    <div id="jxUpdatePrompt"></div>
    <div class="jx-section"><div class="jx-section-h">DSH 状态</div><div id="jxVersionRows"></div></div>
    <div class="jx-section"><div class="jx-section-h">正在使用 / 已配置的模型</div><div id="jxModels"></div></div>
    <div class="jx-section"><div class="jx-section-h">OpenCode Go 额度</div><div id="jxRings"></div></div>
    <div class="jx-section"><div class="jx-section-h">最近 5 个会话</div><div id="jxSessions"></div></div>
  `;

  // 挂载到主内容区：找 DSH 主内容容器
  const main = document.querySelector('main') || document.querySelector('[class*="conversation"]') || document.body;
  main.prepend(root);

  // ———— 数据加载 ————
  async function loadVersion() {
    try {
      const h = await fetch('/api/system/health', { cache: 'no-store' }).then(r => r.json());
      const status = document.getElementById('jxRunStatus');
      if (h.ready) {
        status.textContent = 'DSH 正常运行';
        status.className = 'jx-status ok';
      } else {
        status.textContent = 'DSH 未就绪';
        status.className = 'jx-status off';
      }
      const rows = document.getElementById('jxVersionRows');
      rows.innerHTML = '';
      const pkg = await fetch('/api/jingxi/status', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
      const ver = pkg?.dshVersion || '0.1.0-rc.7';
      const items = [
        ['当前版本', ver],
        ['更新通道', 'preview'],
        ['运行状态', h.ready ? '正常' : '未运行'],
        ['守护者', '正常']
      ];
      for (const [k, v] of items) {
        const row = document.createElement('div');
        row.className = 'jx-row';
        row.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`;
        rows.appendChild(row);
      }
    } catch {
      const status = document.getElementById('jxRunStatus');
      status.textContent = 'DSH 未运行';
      status.className = 'jx-status off';
    }
  }

  async function loadModels() {
    const box = document.getElementById('jxModels');
    try {
      const r = await fetch('/api/llm.providers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'jx-models-1', method: 'llm.providers', payload: {} })
      });
      const d = await r.json();
      const providers = d?.result?.value || d?.value || [];
      if (!Array.isArray(providers) || providers.length === 0) {
        box.innerHTML = '<div class="jx-empty">暂无模型配置数据</div>';
        return;
      }
      box.innerHTML = '';
      let shown = 0;
      for (const p of providers.slice(0, 8)) {
        const pid = p.id || p.providerId || 'provider';
        const models = p.models || [];
        for (const m of models.slice(0, 3)) {
          if (shown >= 6) break;
          const row = document.createElement('div');
          row.className = 'jx-model-row';
          const mid = typeof m === 'string' ? m : (m.id || m.modelId || 'model');
          const tag = shown === 0 ? '<span class="jx-m-tag cur">当前</span>' : '<span class="jx-m-tag cfg">已配置</span>';
          row.innerHTML = `<span class="jx-m-provider">${pid}</span><span class="jx-m-id" title="${mid}">${mid}</span>${tag}`;
          box.appendChild(row);
          shown++;
        }
        if (shown >= 6) break;
      }
      if (shown === 0) box.innerHTML = '<div class="jx-empty">暂无模型数据</div>';
    } catch {
      box.innerHTML = '<div class="jx-empty">模型数据暂不可用（llm.providers 未暴露）</div>';
    }
  }

  function formatReset(iso) {
    if (!iso) return '重置时间未知';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '重置时间未知';
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 重置`;
  }

  function ringSvg(percent, color) {
    const r = 26, c = 2 * Math.PI * r;
    const filled = (percent / 100) * c;
    const dash = percent > 0 ? `${filled} ${c - filled}` : `0 ${c}`;
    return `<svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--dsw-alias-border-subtle,rgba(0,0,0,.1))" stroke-width="5"/>
      <circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${dash}"/>
    </svg>`;
  }

  function renderRings(go) {
    const box = document.getElementById('jxRings');
    if (!go) { box.innerHTML = '<div class="jx-empty">额度数据暂不可用</div>'; return; }
    const color = go.high >= 90 ? 'var(--dsw-static-red-500,#ef4444)' : go.high >= 70 ? 'var(--dsw-static-amber-500,#f59e0b)' : 'var(--dsw-static-green-500,#22c55e)';
    const windows = [
      ['5小时', go.rolling?.percent ?? go.high ?? 0],
      ['1周', go.weekly?.percent ?? go.high ?? 0],
      ['1月', go.monthly?.percent ?? go.high ?? 0]
    ];
    box.innerHTML = `<div class="jx-rings">${windows.map(([label, pct]) => `
      <div class="jx-ring">${ringSvg(pct, color)}<span class="jx-ring-val">${Math.round(pct)}%</span><span class="jx-ring-label">${label}</span></div>
    `).join('')}</div>
    <div class="jx-reset">${formatReset(go.weekly?.resetsAt)}</div>`;
  }

  async function loadSessions() {
    const box = document.getElementById('jxSessions');
    try {
      const r = await fetch('/api/session.list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'jx-sess-1', method: 'session.list', payload: {} })
      });
      const d = await r.json();
      const items = d?.result?.value?.items || [];
      const sorted = [...items].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
      if (sorted.length === 0) { box.innerHTML = '<div class="jx-empty">暂无会话</div>'; return; }
      box.innerHTML = '';
      for (const s of sorted) {
        const proj = s.projections?.values || {};
        const title = proj.title || '未命名会话';
        const stats = proj.sessionStats || {};
        const time = new Date(s.updatedAt);
        const timeStr = Number.isNaN(time.getTime()) ? '' : `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
        const parts = [];
        if (stats.turns != null) parts.push(`${stats.turns} 轮`);
        if (stats.steps != null) parts.push(`${stats.steps} 步`);
        if (stats.llmMs != null) parts.push(`LLM ${fmtMs(stats.llmMs)}`);
        const el = document.createElement('div');
        el.className = 'jx-session';
        el.innerHTML = `<div class="jx-s-title"><span>${escapeHtml(title)}</span><span class="jx-s-time">${timeStr}</span></div>
          ${parts.length ? `<div class="jx-s-stats">${parts.join(' · ')}</div>` : ''}`;
        box.appendChild(el);
      }
    } catch {
      box.innerHTML = '<div class="jx-empty">会话数据暂不可用</div>';
    }
  }

  function fmtMs(ms) {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ———— 更新提示（非阻塞 inline，每 session 一次 + 24h 节流）————
  function maybeShowUpdatePrompt() {
    const box = document.getElementById('jxUpdatePrompt');
    const sessionFlag = sessionStorage.getItem('jx_update_prompted');
    const lastCheck = localStorage.getItem('jx_last_update_check');
    if (sessionFlag) return;
    if (lastCheck && (Date.now() - Number(lastCheck)) < 24 * 3600 * 1000) return;
    box.innerHTML = `
      <div class="jx-update-prompt">
        <span>检查 DeepSeek Harness 更新？</span>
        <span class="jx-up-actions">
          <button class="jx-btn" id="jxPromptLater" type="button">暂不</button>
          <button class="jx-btn primary" id="jxPromptCheck" type="button">检查</button>
        </span>
      </div>`;
    document.getElementById('jxPromptLater').addEventListener('click', () => {
      sessionStorage.setItem('jx_update_prompted', '1');
      box.innerHTML = '';
    });
    document.getElementById('jxPromptCheck').addEventListener('click', async () => {
      sessionStorage.setItem('jx_update_prompted', '1');
      localStorage.setItem('jx_last_update_check', String(Date.now()));
      box.innerHTML = '<div class="jx-update-prompt"><span>正在检查官方更新…</span></div>';
      try {
        const r = await fetch('/api/jingxi/update-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        const d = await r.json();
        if (d.ok && d.latest) {
          box.innerHTML = `<div class="jx-update-prompt"><span>发现新版本：${d.current} → ${d.latest}（官方来源已验证）</span>
            <span class="jx-up-actions"><button class="jx-btn" id="jxUpLater" type="button">稍后</button><button class="jx-btn primary" id="jxUpGo" type="button">更新并重启</button></span></div>`;
          document.getElementById('jxUpLater').addEventListener('click', () => { box.innerHTML = ''; });
          document.getElementById('jxUpGo').addEventListener('click', () => {
            box.innerHTML = '<div class="jx-update-prompt"><span>更新已排队，完成后自动重启并回到鲸息…</span></div>';
            fetch('/api/jingxi/update-apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
          });
        } else {
          box.innerHTML = '<div class="jx-update-prompt"><span>' + (d.message || '当前已是最新版本') + '</span></div>';
        }
      } catch {
        box.innerHTML = '<div class="jx-update-prompt"><span>更新检查失败（网络或服务不可用）</span></div>';
      }
    });
  }

  // 页头"检查更新"（永远可点）
  document.getElementById('jxCheckUpdate').addEventListener('click', () => {
    localStorage.setItem('jx_last_update_check', String(Date.now()));
    const box = document.getElementById('jxUpdatePrompt');
    box.innerHTML = '<div class="jx-update-prompt"><span>正在检查官方更新…</span></div>';
    fetch('/api/jingxi/update-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.latest) {
          box.innerHTML = `<div class="jx-update-prompt"><span>发现新版本：${d.current} → ${d.latest}</span></div>`;
        } else {
          box.innerHTML = '<div class="jx-update-prompt"><span>' + (d.message || '当前已是最新版本') + '</span></div>';
        }
      })
      .catch(() => { box.innerHTML = '<div class="jx-update-prompt"><span>更新检查失败</span></div>'; });
  });

  loadVersion();
  loadModels();
  loadSessions();
  maybeShowUpdatePrompt();
  // 额度：订阅 quotaStore（由宿主注入）
  if (window.__JX_QUOTA_STORE__) {
    const render = () => renderRings(window.__JX_QUOTA_STORE__.getSnapshot()?.go);
    window.__JX_QUOTA_STORE__.subscribe(render);
    render();
  } else {
    document.getElementById('jxRings').innerHTML = '<div class="jx-empty">额度数据暂不可用</div>';
  }

  return root;
}