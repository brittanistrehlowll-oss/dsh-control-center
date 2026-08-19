/**
 * sidebar-dock — 鲸息 SidebarDock（V3.0）
 *
 * 真实挂入 DSH sidebar（非 viewport fixed）：full / mid / rail 三态。
 * 按钮：[重启] [鲸息] [关闭]（full 三等分；rail 只图标）。
 * rail 保留：DeepSeek 独立状态点+金额、OpenCode 独立状态点+百分比（禁止隐藏）。
 *
 * 数据：订阅 quota store（内部 observable），不读 DOM、不依赖全局 seam。
 */

export function mountSidebarDock(opts) {
  const {
    quotaStore,        // { getSnapshot(), subscribe(listener) }
    onRestart,         // () => void
    onJingxi,          // () => void
    onStop,            // () => void
    updateState        // 'available' | 'none'  (badge)
  } = opts;

  if (document.getElementById('jx-sidebar-dock')) return; // 幂等

  const dock = document.createElement('div');
  dock.id = 'jx-sidebar-dock';

  const css = `
  #jx-sidebar-dock{position:absolute;left:12px;right:12px;width:auto;display:flex;flex-direction:column;gap:6px;z-index:880;font-family:inherit;font-size:12px;transition:opacity .2s ease,transform .2s ease}
  #jx-sidebar-dock .jx-quota-row{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.03));border:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,.06))}
  #jx-sidebar-dock .jx-q-item{display:flex;align-items:center;gap:5px;min-width:0;flex:1}
  #jx-sidebar-dock .jx-dot{width:7px;height:7px;border-radius:50%;flex:none}
  #jx-sidebar-dock .jx-dot.ds{background:var(--dsw-static-green-500,#22c55e)}
  #jx-sidebar-dock .jx-dot.ds.warn{background:var(--dsw-static-amber-500,#f59e0b)}
  #jx-sidebar-dock .jx-dot.ds.crit{background:var(--dsw-static-red-500,#ef4444)}
  #jx-sidebar-dock .jx-dot.go{background:var(--dsw-static-blue-500,#4a9eff)}
  #jx-sidebar-dock .jx-dot.go.warn{background:var(--dsw-static-amber-500,#f59e0b)}
  #jx-sidebar-dock .jx-dot.go.crit{background:var(--dsw-static-red-500,#ef4444)}
  #jx-sidebar-dock .jx-q-amount{font-size:12px;font-weight:550;color:var(--dsw-alias-text-primary,#1b1b1c);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #jx-sidebar-dock .jx-q-percent{font-size:12px;font-weight:550;color:var(--dsw-alias-text-primary,#1b1b1c);white-space:nowrap}
  #jx-sidebar-dock .jx-actions{display:flex;gap:4px}
  #jx-sidebar-dock .jx-btn{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 6px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-text-secondary,#3c4043);font-size:12px;cursor:pointer;transition:background .15s ease,transform .15s ease;min-width:0}
  #jx-sidebar-dock .jx-btn:hover{background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.06))}
  #jx-sidebar-dock .jx-btn:active{transform:translateY(1px)}
  #jx-sidebar-dock .jx-btn .jx-ico{font-size:14px;line-height:1;flex:none}
  #jx-sidebar-dock .jx-btn .jx-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #jx-sidebar-dock .jx-btn-jingxi{position:relative}
  #jx-sidebar-dock .jx-badge{position:absolute;top:3px;right:4px;width:5px;height:5px;border-radius:50%;background:var(--dsw-static-amber-500,#f59e0b)}
  /* mid：按钮只留图标 */
  #jx-sidebar-dock.jx-mid .jx-btn .jx-label{display:none}
  #jx-sidebar-dock.jx-mid .jx-btn{padding:0 4px}
  /* rail：竖排，金额/% 保留（禁止隐藏） */
  #jx-sidebar-dock.jx-rail{left:auto;right:auto;width:100%;flex-direction:column;gap:5px;align-items:stretch;padding:0 4px}
  #jx-sidebar-dock.jx-rail .jx-quota-row{flex-direction:column;align-items:flex-start;gap:3px;padding:4px 6px}
  #jx-sidebar-dock.jx-rail .jx-q-item{width:100%}
  #jx-sidebar-dock.jx-rail .jx-actions{flex-direction:column}
  #jx-sidebar-dock.jx-rail .jx-btn{width:100%;height:26px}
  #jx-sidebar-dock.jx-rail .jx-btn .jx-label{display:none}
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ———— quota row（双 provider 独立状态点 + 金额/%）————
  const quotaRow = document.createElement('div');
  quotaRow.className = 'jx-quota-row';
  quotaRow.innerHTML = `
    <div class="jx-q-item"><span class="jx-dot ds"></span><span class="jx-q-amount jx-ds-amount">—</span></div>
    <div class="jx-q-item"><span class="jx-dot go"></span><span class="jx-q-percent jx-go-percent">—</span></div>
  `;

  // ———— actions：重启 | 鲸息 | 关闭 ————
  const actions = document.createElement('div');
  actions.className = 'jx-actions';

  const btnRestart = document.createElement('button');
  btnRestart.className = 'jx-btn';
  btnRestart.setAttribute('aria-label', '重启 DSH');
  btnRestart.innerHTML = '<span class="jx-ico">&#x21bb;</span><span class="jx-label">重启</span>';
  btnRestart.addEventListener('click', onRestart);

  const btnJingxi = document.createElement('button');
  btnJingxi.className = 'jx-btn jx-btn-jingxi';
  btnJingxi.setAttribute('aria-label', '鲸息');
  btnJingxi.innerHTML = '<span class="jx-ico jx-whale"></span><span class="jx-label">鲸息</span>';
  btnJingxi.addEventListener('click', onJingxi);

  const btnStop = document.createElement('button');
  btnStop.className = 'jx-btn';
  btnStop.setAttribute('aria-label', '关闭 DSH');
  btnStop.innerHTML = '<span class="jx-ico">&#x23fb;</span><span class="jx-label">关闭</span>';
  btnStop.addEventListener('click', onStop);

  actions.appendChild(btnRestart);
  actions.appendChild(btnJingxi);
  actions.appendChild(btnStop);

  dock.appendChild(quotaRow);
  dock.appendChild(actions);
  document.body.appendChild(dock);

  // ———— 挂载：真实 sidebar（检测结构，非 viewport fixed）————
  let sidebar = null;
  function findSidebar() {
    const all = document.querySelectorAll('body div');
    for (const n of all) {
      if (n.tagName !== 'DIV') continue;
      const cs = getComputedStyle(n);
      if (cs.display !== 'flex' || cs.flexDirection !== 'column') continue;
      const r = n.getBoundingClientRect();
      if (r.left > 2 || r.width < 40 || r.width > 560 || r.height < window.innerHeight * 0.7) continue;
      // 侧边栏内应有"新建会话"按钮
      for (const k of n.children) {
        if (k.tagName === 'BUTTON' && /新建会话|New session/i.test(k.getAttribute('aria-label') || '')) return n;
      }
    }
    return null;
  }

  function layoutDock() {
    if (!sidebar || !sidebar.isConnected) {
      sidebar = findSidebar();
      if (!sidebar) {
        // fallback：安全默认位置（不遮挡设置）
        dock.style.left = '12px';
        dock.style.bottom = '60px';
        dock.classList.remove('jx-rail', 'jx-mid');
        return;
      }
    }
    const s = sidebar.getBoundingClientRect();
    const rail = s.width < 120;
    const mid = !rail && s.width < 210;
    dock.classList.toggle('jx-rail', rail);
    dock.classList.toggle('jx-mid', mid);
    // 挂到 sidebar 底部（设置上方）
    dock.style.position = 'absolute';
    dock.style.left = '12px';
    dock.style.right = '12px';
    dock.style.bottom = '64px';
    dock.style.width = 'auto';
    sidebar.appendChild(dock);
  }

  // ———— 数据订阅 ————
  function renderQuota() {
    const snap = quotaStore.getSnapshot();
    const ds = snap?.deepseek;
    const go = snap?.go;
    const dsAmount = document.querySelector('.jx-ds-amount');
    const goPercent = document.querySelector('.jx-go-percent');
    const dsDot = document.querySelector('.jx-dot.ds');
    const goDot = document.querySelector('.jx-dot.go');
    if (ds) {
      dsAmount.textContent = (ds.currency || '¥') + (ds.balance ?? '—');
      dsDot.classList.toggle('warn', ds.state === 'warn');
      dsDot.classList.toggle('crit', ds.state === 'critical' || ds.state === 'error');
    }
    if (go) {
      goPercent.textContent = (go.high ?? '—') + '%';
      const pct = go.high ?? 0;
      goDot.classList.toggle('warn', pct >= 70 && pct < 90);
      goDot.classList.toggle('crit', pct >= 90);
    }
  }

  // ———— update badge ————
  function renderBadge() {
    const existing = btnJingxi.querySelector('.jx-badge');
    if (updateState === 'available') {
      if (!existing) {
        const b = document.createElement('span');
        b.className = 'jx-badge';
        btnJingxi.appendChild(b);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  quotaStore.subscribe(renderQuota);
  renderQuota();
  renderBadge();

  // ResizeObserver + window resize
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(layoutDock);
    if (sidebar) ro.observe(sidebar);
    window.__jxSidebarObserver = ro;
  }
  window.addEventListener('resize', layoutDock);
  setTimeout(layoutDock, 300);
  setTimeout(layoutDock, 1500);

  return {
    element: dock,
    layout: layoutDock,
    renderQuota,
    renderBadge,
    setUpdateState(state) { updateState = state; renderBadge(); }
  };
}