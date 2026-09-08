// ============================================================================
// dsh-jingxi ◊ V1.0.1 browser half — DSH Native Breath（Pure Breath 直达）
//   sidebar.footer.action（collapsed FishLogo / expanded breath status）→ shell.overlay（呼吸轨迹）
//   → settings.section
// ----------------------------------------------------------------------------
// rc.8 third-party client-plugin contract（同 dsh-vision-router/lib/client.js）：
//   window.__ModuleLoader__.load({ id, factory(require){ ... } })
// React 经冻结平台模块表解析 → 无第二份 React。全部元素用 React.createElement。
// 样式：单份 plugin-owned <style data-plugin="dsh-jingxi">，卸载即移除 → 无残留。
//
// V1.0.1 Pure Breath：剥离计费/额度模块——只保留基础调用事实与呼吸轨迹；
// 侧栏入口点击直达呼吸轨迹（无中间面板、无快捷操作行、无版本行）；
// Cache First / BreathCurve 等核心阅读模块保持不变。
// 通用外壳、按钮、遮罩遵循 DSH Native tokens；DSH 更新检查仅经 Settings
// Doctor 只读呈现，host /api/jingxi/{update,lifecycle} 端点保留。
// Runtime 的轨迹和阶段只在有真实 projection 数据时绘制，缺失数据保持空轨道/未知状态。
// ============================================================================
window.__ModuleLoader__.load({
  id: 'dsh-jingxi',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const {
      Button,
      FishLogo,
      IconRefreshOutline14,
      IconRefreshOutline16,
      IconLoadingOutline16,
      IconSettingsOutline16,
      IconCheckOutline16,
      IconPauseOutline16,
      IconPlayOutline16,
      IconRightUpOutline16,
      IconWarningOutline16,
      IconCloseOutline16,
      Modal,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    // Jingxi owns only the supplemental raster asset layer. Runtime whale
    // bodies must come from DSH's official FishLogo seam; Jingxi adds the
    // action-specific water, spout and status language around that host mark.
    const ASSET_BASE = '/plugins/dsh-jingxi/assets/icons'
    const assetUrl = (path) => `${ASSET_BASE}/${path}`
    const AssetIcon = ({ path, className = '', size = 18, alt = '' }) =>
      h('img', {
        className: `jx-asset-icon${className ? ` ${className}` : ''}`,
        src: assetUrl(path),
        width: size,
        height: size,
        alt,
        'aria-hidden': alt ? undefined : 'true',
        draggable: 'false',
      })

    // ── Breath 数据：宿主 fold（telemetry-fold.js）→ fetch → uSES 渲染。
    //    已完成快照不轮询；只有运行中的 live session 才由界面维持 5s 刷新。
    const breathService = {
      current: null,
      listeners: new Set(),
      _at: 0,
      // request epoch：每次 load() 递增；fetch 返回后若 _epoch 已变化（期间有更晚的
      // load），该响应一律丢弃（迟到保护）。并发不再被 _inflight 串行挡掉——去重由
      // 5s 冷却承担，_inflight 仅保留为「最近一次请求」引用。
      _epoch: 0,
      // 最近一次已提交 view 的 sessionId；响应若带 sessionId 且与它不一致 → 丢弃
      //（fail-closed：会话漂移宁可留空态）。真正的「当前会话」来源依赖 P1 宿主事件
      //（telemetry-fold 活跃会话 id）；本阶段无宿主事件，仅靠 epoch + 自洽校验。
      _sessionId: undefined,
      _inflight: null,
      getSnapshot() { return this.current },
      subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) },
      set(v) { this.current = v; for (const fn of this.listeners) { try { fn(v) } catch {} } },
      load({ force = false } = {}) {
        // ① request epoch：任何一次 load 都会让先前在途响应的提交作废（迟到保护）。
        const epoch = ++this._epoch
        // ② 冷却：非 force 且 5s 内已有请求/结果 → 直接返回（loading 期间同样复用，
        //    不重复发起请求；在途请求的响应会按 epoch 提交）。
        if (!force && this.current && this.current.ok !== false && Date.now() - this._at < 5000) {
          this._epoch = epoch - 1
          return Promise.resolve(this.current)
        }
        this._at = Date.now()
        // ③ 清旧（fail-closed）：新 load 进入 loading 空态——上一会话视图不再呈现
        //    （空态/等待文案见 BreathSurface 与 JingxiWideStatus）；新结果到达且
        //    epoch 未变时才提交。source/demo 不保留，避免空态误标快照或实时来源。
        this.set({ ok: true, loading: true, view: undefined, recent: [], error: null, stale: this.current?.stale === true })
        const request = fetch('/api/jingxi/breath/current', { cache: 'no-store' })
          .then(async (response) => {
            if (response?.ok === false) throw new Error(`breath-http-${response.status || 'error'}`)
            return typeof response?.json === 'function' ? response.json() : undefined
          })
          .then(d => {
            // ④ epoch 校验：期间有更晚的 load → 丢弃迟到响应（含迟到错误）。
            if (epoch !== this._epoch) return d
            if (d && d.ok === true && d.view && typeof d.view === 'object') {
              // ⑤ sessionId 自洽校验：带 sessionId 的 view 必须与最近已提交会话一致；
              //    不一致视为错会话（丢弃，UI 留在空态）。无 sessionId 仅靠 epoch。
              const sessionId = d.view && d.view.sessionId
              if (sessionId !== undefined && this._sessionId !== undefined && sessionId !== this._sessionId) return d
              if (sessionId !== undefined) this._sessionId = sessionId
              this._at = Date.now()
              this.set({ ...d, error: null, loading: false })
            } else {
              this.set({ ok: false, loading: false, view: undefined, recent: [], error: '呼吸节奏数据格式不可用', stale: false })
            }
            return d
          })
          .catch(() => {
            // ⑥ 失败同样 fail-closed：绝不保留上一会话视图。
            if (epoch !== this._epoch) return undefined
            this.set({ ok: false, loading: false, view: undefined, recent: [], error: '暂时无法刷新呼吸节奏，请稍后重试', stale: false })
            return undefined
          })
          .finally(() => { if (this._inflight === request) this._inflight = null })
        this._inflight = request
        return request
      },
    }
    const useBreath = () => React.useSyncExternalStore(
      (cb) => breathService.subscribe(cb),
      () => breathService.getSnapshot(),
    )

    // V5.8 P2.1：自动刷新开关（暂停/继续）。默认开启；只有 live 会话有实际轮询效果。
    // 暂停=停止 5s 轮询（保留手动刷新 force），继续=恢复轮询并立即补一帧。
    // 模块级状态 + uSES；切换时 notify breathListeners 让 BreathOverlay 重渲染并重读快照。
    let breathAutoRefreshOn = true
    // V5.8 设计稿 ①：自动刷新可见倒计时「5秒自动刷新 · N s后刷新」。
    // 模块级 countdown：仅 live 且 on 时递减；到 0 重置 5（轮询触发）。暂停时冻结。
    let breathCountdown = 5
    const breathCountdownListeners = new Set()
    const setBreathCountdown = (value) => {
      if (breathCountdown === value) return
      breathCountdown = value
      for (const fn of breathCountdownListeners) { try { fn(value) } catch { /* keep rail */ } }
    }
    const useBreathCountdown = () => React.useSyncExternalStore(
      (cb) => { breathCountdownListeners.add(cb); return () => breathCountdownListeners.delete(cb) },
      () => breathCountdown,
    )
    // 倒计时驱动器：由 BreathSurface 的轮询 effect 同步（每 tick 递减，轮询后重置 5）
    const breathAutoRefreshListeners = new Set()
    const setBreathAutoRefresh = (on) => {
      if (breathAutoRefreshOn === on) return
      breathAutoRefreshOn = on
      for (const fn of breathAutoRefreshListeners) { try { fn(on) } catch { /* keep rail */ } }
      notify(breathListeners)
    }
    const useBreathAutoRefresh = () => React.useSyncExternalStore(
      (cb) => { breathAutoRefreshListeners.add(cb); return () => breathAutoRefreshListeners.delete(cb) },
      () => breathAutoRefreshOn,
    )

    // ── module-level 状态：Breath surface + 更新检查（Settings Doctor 只读） ──
    let breathOpen = false
    const breathListeners = new Set()
    const updateListeners = new Set()
    const notify = (set) => { for (const fn of set) { try { fn() } catch { /* keep rail */ } } }
    const focusTriggerSelector = (surface) => `[data-jx-surface-trigger="${surface}"]`
    const captureFocusTarget = (candidate) => {
      const element = candidate && typeof candidate.focus === 'function'
        ? candidate
        : typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.focus === 'function'
          ? document.activeElement
          : null
      const surface = element?.getAttribute?.('data-jx-surface-trigger') || element?.dataset?.jxSurfaceTrigger
      return { element, selector: surface ? focusTriggerSelector(surface) : null }
    }
    const restoreFocusTarget = (target) => {
      if (!target) return
      const restore = () => {
        const element = target.element && target.element.isConnected !== false ? target.element : null
        const fallback = target.selector && typeof document !== 'undefined' ? document.querySelector?.(target.selector) : null
        const candidate = element || fallback
        if (candidate && typeof candidate.focus === 'function') {
          candidate.focus()
          return true
        }
        return false
      }
      restore()
      // React/host Footer may commit its rerender after the close handler. A
      // second attempt resolves the stable data selector if the original
      // invoker was replaced during that commit.
      if (typeof queueMicrotask === 'function') queueMicrotask(restore)
      else if (typeof setTimeout === 'function') setTimeout(restore, 0)
    }
    let breathFocusReturn = null
    const openBreath = (invoker) => {
      breathFocusReturn = captureFocusTarget(invoker)
      breathFocusReturn.selector = focusTriggerSelector('breath')
      breathOpen = true
      notify(breathListeners)
      // V5.7 用户反馈「呼吸轨迹没有随会话切换」：每次打开弹窗都强制重拉，
      // 绕过 5s 冷却（避免切会话后打开仍显示旧会话缓存）；服务端 fold 已
      // 切到新会话则返回新视图（若宿主有会话标识，P1 事件将提供精确切换）。
      breathService.load({ force: true })
    }
    const closeBreath = () => {
      breathOpen = false
      notify(breathListeners)
      restoreFocusTarget(breathFocusReturn)
      breathFocusReturn = null
    }
    const EMPTY_UPDATE = () => ({
      status: 'idle',
      currentVersion: null,
      latestVersion: null,
      updateAvailable: false,
      mutationAllowed: false,
      compatibility: undefined,
      complete: false,
      verified: false,
      restartId: null,
      verificationChecking: false,
      error: null,
    })
    let updateState = EMPTY_UPDATE()
    let updateCheckInflight = null
    const setUpdateState = (next) => {
      updateState = { ...updateState, ...next }
      notify(updateListeners)
    }
    const useModalEscapeGuard = (open, onClose) => {
      React.useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined
        const onKeyDown = (event) => {
          if (event?.key !== 'Escape') return
          event.preventDefault?.()
          event.stopImmediatePropagation?.()
          event.stopPropagation?.()
          onClose()
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [open, onClose])
    }
    const useModalFocusGuard = (open, selector) => {
      React.useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined
        const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        const focusEntry = () => {
          const dialog = document.querySelector?.(selector)
          if (!dialog) return false
          const active = document.activeElement
          if (active && dialog.contains?.(active)) return true
          const candidate = dialog.querySelector('button[aria-label^="关闭"]') || dialog.querySelector(focusableSelector)
          if (candidate && typeof candidate.focus === 'function') {
            candidate.focus()
            return true
          }
          return false
        }
        const focusAfterCommit = () => {
          if (focusEntry()) return
          if (typeof queueMicrotask === 'function') queueMicrotask(focusEntry)
          else if (typeof setTimeout === 'function') setTimeout(focusEntry, 0)
        }
        focusAfterCommit()
        const onKeyDown = (event) => {
          if (event?.key !== 'Tab') return
          const dialog = document.querySelector?.(selector)
          if (!dialog) return
          const focusables = Array.from(dialog.querySelectorAll(focusableSelector) || [])
            .filter((element) => element && typeof element.focus === 'function')
          if (focusables.length === 0) {
            event.preventDefault?.()
            return
          }
          const activeIndex = focusables.indexOf(document.activeElement)
          if (activeIndex === -1) {
            event.preventDefault?.()
            focusables[0].focus()
          } else if (!event.shiftKey && activeIndex === focusables.length - 1) {
            event.preventDefault?.()
            focusables[0].focus()
          } else if (event.shiftKey && activeIndex === 0) {
            event.preventDefault?.()
            focusables[focusables.length - 1].focus()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [open, selector])
    }
    const useBreathOpen = () => {
      const [, force] = React.useReducer((value) => value + 1, 0)
      React.useEffect(() => { breathListeners.add(force); return () => breathListeners.delete(force) }, [])
      return breathOpen
    }
    const useRuntimeState = () => {
      const [, force] = React.useReducer((value) => value + 1, 0)
      React.useEffect(() => { updateListeners.add(force); return () => updateListeners.delete(force) }, [])
      return { update: updateState }
    }

    async function readClientResponse(response) {
      const status = Number(response?.status)
      const httpOk = response?.ok !== false && (!Number.isFinite(status) || status === 0 || (status >= 200 && status < 300))
      let payload
      let rawText = ''
      if (typeof response?.text === 'function') {
        rawText = await response.text()
        if (rawText.trim()) {
          try { payload = JSON.parse(rawText) } catch { /* keep raw text only for safe error classification */ }
        }
      } else if (typeof response?.json === 'function') {
        try { payload = await response.json() } catch { payload = undefined }
      }
      return { httpOk, payload, rawText, status }
    }

    const updateErrorText = ({ payload, rawText, status }, fallback) => {
      const code = String(payload?.errorCode ?? '').toLowerCase()
      const raw = `${code} ${payload?.error ?? ''} ${rawText ?? ''}`.toLowerCase()
      if (code === 'rollback-failed') return '更新失败，旧版本恢复也未完成，请立即检查 DSH 安装。'
      if (code === 'restart-failed') return 'DSH 重启失败，请稍后重试。'
      if (code === 'verification-failed') return 'DSH 重启后未通过运行态验证，请稍后检查。'
      if (code === 'runtime-baseline-unavailable') return 'DSH 重启前运行态基线不可验证，更新未执行。'
      if (code === 'install-root-unverified') return '未找到可验证的 DSH 安装位置，更新已阻止。'
      if (code === 'verification-not-found') return '找不到对应的 DSH 更新验证记录，请重新检查。'
      if (code === 'package-manager-invocation-invalid' || /\bspawn(?:\s+[^\s]+)?\s+e(?:inval|nival)\b/u.test(raw)) {
        return 'Windows 包管理器调用失败，更新未执行。请稍后重试。'
      }
      if (code === 'package-manager-unavailable' || /spawn\s+[^\s]+\s+enoent\b/u.test(raw) || /pnpm[^\s]*.*(?:not found|找不到)/u.test(raw)) {
        return '找不到 pnpm，更新未执行。请先确认 DSH 的包管理器可用。'
      }
      if (code === 'registry-timeout' || /\b(?:timeout|timed out|aborted)\b/u.test(raw)) return '连接更新源超时，请稍后重试。'
      if (code === 'registry-denied' || /registry\s+http\s+(?:401|403)\b/u.test(raw)) return '更新源拒绝了请求，请检查网络或更新源配置。'
      if (code === 'registry-unavailable' || status === 502 || status === 503 || /\b(?:fetch failed|econn|enotfound|network|registry)\b/u.test(raw)) return '暂时无法连接更新源，请稍后重试。'
      if (payload?.error && typeof payload.error === 'string' && payload.error.length < 240) return payload.error
      return fallback
    }

    function checkDshUpdate() {
      if (updateCheckInflight) return updateCheckInflight
      setUpdateState({ status: 'checking', error: null })
      updateCheckInflight = fetch('/api/jingxi/update', { cache: 'no-store' })
        .then(readClientResponse)
        .then((response) => {
          const d = response.payload
          if (!response.httpOk || !d || !d.ok) {
            setUpdateState({ status: 'failed', error: updateErrorText(response, '检查 DSH 更新失败，请稍后重试。') })
            return d
          }
           setUpdateState({
             status: d.updateAvailable
               ? d.mutationAllowed === true && d.compatibility?.state !== 'unknown'
                 ? 'available'
                 : 'compatibility-blocked'
               : (d.state === 'up-to-date' || d.state === 'current-newer' ? 'latest' : 'failed'),
             currentVersion: d.currentVersion ?? null,
             latestVersion: d.latestVersion ?? null,
             updateAvailable: d.updateAvailable === true,
             mutationAllowed: d.mutationAllowed === true,
             compatibility: d.compatibility,
             complete: false,
             verified: false,
             error: d.updateAvailable && d.mutationAllowed !== true
               ? '该 DSH 版本尚未完成鲸息兼容性验证，更新已阻止。'
               : d.state === 'unknown' ? '无法读取当前 DSH 版本' : null,
           })
          return d
        })
        .catch((error) => {
          setUpdateState({ status: 'failed', error: updateErrorText({ payload: undefined, rawText: String(error), status: 0 }, '暂时无法检查 DSH 更新。') })
          return undefined
        })
        .finally(() => { updateCheckInflight = null })
      return updateCheckInflight
    }

    // ── styles ──
    const CSS = [
      // Footer Companion：宽栏沿用 DSH 的侧栏行节奏；收起态保持 36px
      // rail footprint。动作图标只表达各自语义，
      // 不再把多个 action 压进一个 framed dashboard。
      '.jx-fc{position:relative;z-index:50;display:flex;align-items:center;justify-content:center;min-width:0;max-width:100%;box-sizing:border-box;color:var(--dsw-alias-label-primary,currentColor);font:inherit;}',
      '.jx-fc[data-sidebar-mode="rail"]{width:100%;padding:0;}',
      '.jx-fc[data-sidebar-mode="wide"]{width:100%;flex-direction:column;align-items:stretch;padding:6px 12px 4px;}',
      '.jx-fc-btn{width:36px;height:36px;min-width:36px;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--dsw-alias-label-primary,currentColor);cursor:pointer;padding:8px;border-radius:12px;font:inherit;}',
      '.jx-fc-btn:hover{background:var(--dsw-alias-interactive-bg-hover,transparent);color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-fc[data-sidebar-mode="wide"] .jx-fc-entry{margin-left:-4px;padding-left:0;gap:6px;}',
      // 入口通过 -4px 与宿主设置行共享 X=26px 光学轴；20px 官方鲸鱼
      // 保持原生尺寸，不再套入 52px 假槽或额外水平位移。
      '.jx-fc[data-sidebar-mode="wide"] .jx-fc-entry__icon{position:relative;justify-content:center;width:20px;height:20px;flex:0 0 20px;}',
      '.jx-fc[data-sidebar-mode="wide"] .jx-fc-entry__icon .jx-runtime-mark{position:relative;left:auto;top:auto;transform:none;margin:0;}',



      '.jx-fc-entry{width:auto;min-width:0;height:36px;justify-content:flex-start;gap:12px;padding:4px 8px;border-radius:8px;}',
       '.jx-fc-entry__rate{display:inline-flex;align-items:baseline;gap:4px;margin-left:auto;flex:0 0 auto;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,currentColor);}',
       '.jx-fc-entry__rate-label{flex:0 0 auto;white-space:nowrap;color:var(--dsw-alias-label-tertiary,currentColor);}',
       '.jx-fc-entry__rate-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,currentColor);}',
       '.jx-fc-entry__rate[data-state="live"] .jx-fc-entry__rate-value{color:var(--dsw-alias-label-primary,currentColor);}',

      '.jx-fc-entry__icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 20px;}',
      '.jx-fc-entry__label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:22px;font-weight:500;}',
      '.jx-fc-entry__status{min-width:0;max-width:116px;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,currentColor);font-size:12px;line-height:20px;font-weight:400;}',
      '.jx-fc-entry__status[data-thread-status="active"]{color:var(--dsw-alias-brand-primary,var(--dsw-alias-label-primary));}',
      '.jx-fc-entry__status[data-thread-status="stable"]{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-primary));}',
      '.jx-fc-entry__status[data-thread-status="failed"]{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary));}',
      '.jx-fc[data-sidebar-mode="rail"] .jx-fc-entry{width:40px;min-width:40px;height:40px;padding:0;justify-content:center;gap:0;border-radius:12px;box-sizing:border-box;}',
      '.jx-fc[data-sidebar-mode="rail"] .jx-fc-entry__label{display:none;}',
      '.jx-fc[data-sidebar-mode="rail"] .jx-fc-entry__status{display:none;}',
      // Rail 折叠态选中块：面板打开 → data-jx-selected → 宿主选中 token；
      // 宿主无该 token 时用参考图浅蓝兜底；圆角 12px 包住 20px 官方鲸鱼，
      // 与顶部导航/设置图标共用同一垂直中心线（参考图 main_icon_center_x=82 语义）。
      '.jx-fc[data-sidebar-mode="rail"] .jx-fc-btn[data-jx-selected="true"]{background:var(--dsw-alias-interactive-bg-selected,rgba(64,128,255,0.12));border-radius:12px;}',

      '.jx-fc-divider{height:1px;min-height:1px;margin:6px 8px 4px;background:var(--dsw-alias-border-l2,transparent);}',
      // wide 顺序（MSG#64）：分隔线位于状态区与鲸息入口之间（原 --before 语义已随位移改名）
      '.jx-fc-divider--breath{width:calc(100% - 16px);margin:6px 8px;}',



      '.jx-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}',
      '.jx-runtime-mark{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;line-height:0;overflow:visible;color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-runtime-mark__fish{position:absolute;inset:3px 0 auto;width:100%;height:calc(100% - 3px);display:block;color:currentColor;}',
      '.jx-runtime-mark__fish-svg{display:block;width:100%;height:auto;color:currentColor;}',
      '.jx-runtime-mark__decoration{position:absolute;pointer-events:none;z-index:1;}',
      // Keep the restart wave below the official FishLogo silhouette. The
      // reference board uses the wave as a supporting waterline, not a slash
      // across the host mark; the negative offset preserves the compact 20px
      // action footprint while avoiding body overlap.
      '.jx-runtime-mark__wave{left:0;bottom:-3px;overflow:visible;}',
      '.jx-runtime-mark__spout{left:50%;top:-3px;transform:translateX(-50%);}',
      '.jx-runtime-mark__spout .jx-asset-icon{width:100%;height:100%;}',
      '.jx-runtime-mark__signal{left:0;top:-3px;overflow:visible;}',
      '.jx-runtime-mark__status{position:absolute;right:-3px;bottom:-2px;width:10px;height:10px;object-fit:contain;z-index:2;}',
      '.jx-runtime-mark[data-state="loading"] .jx-runtime-mark__decoration{animation:jx-runtime-flow 900ms ease-in-out infinite alternate;transform-origin:50% 50%;}',
      '@keyframes jx-runtime-flow{from{translate:0 0;}to{translate:0 -0.5px;}}',
      '@media (prefers-reduced-motion:reduce){.jx-runtime-mark[data-state="loading"] .jx-runtime-mark__decoration{animation:none;}}',
      '.jx-fc[data-sidebar-mode="rail"] .jx-fc-btn{width:40px;min-width:40px;height:40px;}',
      // mark / spout
      '.jx-mark{position:relative;display:inline-flex;align-items:center;justify-content:center;line-height:0;vertical-align:middle;flex:0 0 auto;}',
      '.jx-asset-icon{display:block;object-fit:contain;flex:0 0 auto;}',
      '.jx-mark__fish{display:block;width:100%;height:auto;color:currentColor;}',
      '.jx-mark__spout{position:absolute;right:-1px;top:-3px;display:block;width:38%;height:34%;pointer-events:none;}',
      '.jx-mark__spout .jx-asset-icon{width:100%;height:100%;}',
      '.jx-mark[data-breath-state="active"] .jx-mark__spout{animation:jx-breath-pulse 1800ms ease-in-out infinite;transform-origin:50% 100%;}',
      '@keyframes jx-breath-pulse{0%,100%{opacity:.55;transform:translateY(1px) scale(.88);}45%{opacity:1;transform:translateY(-1px) scale(1.05);}70%{opacity:.76;transform:translateY(0) scale(.94);}}',
      '.jx-runtime-mark[data-action="jingxi"][data-state="active"] .jx-runtime-mark__spout{animation:jx-runtime-breath-pulse 1800ms ease-in-out infinite;}',
      '@keyframes jx-runtime-breath-pulse{0%,100%{opacity:.55;transform:translateX(-50%) translateY(1px) scale(.88);}45%{opacity:1;transform:translateX(-50%) translateY(-1px) scale(1.05);}70%{opacity:.76;transform:translateX(-50%) translateY(0) scale(.94);}}',
      '@media (prefers-reduced-motion:reduce){.jx-mark[data-breath-state="active"] .jx-mark__spout{animation:none;opacity:.85;transform:none;}.jx-runtime-mark[data-action="jingxi"][data-state="active"] .jx-runtime-mark__spout{animation:none;opacity:.85;transform:translateX(-50%);}}',
      '.jx-spouts{position:absolute;right:3%;top:5%;pointer-events:none;transition:opacity 150ms ease,transform 150ms ease;}',
      '.jx-fc-btn:hover .jx-spouts{opacity:.85;transform:translateY(-0.5px);}',
      // Modal geometry, mask, portal and close behavior belong to DSH. Jingxi
      // only supplies the surface content and an intentional width per job.
      '.jx-modal--breath{width:min(920px,calc(100vw - 96px));max-height:min(574px,calc(100dvh - 146px));}',


      '.jx-breath-surface{container-type:inline-size;container-name:jingxi-surface;box-sizing:border-box;display:flex;flex-direction:column;width:100%;max-height:min(574px,calc(100dvh - 146px));overflow:hidden;padding:0;color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-header{display:flex;justify-content:space-between;align-items:center;gap:12px;}',
      '.jx-title-lockup{display:inline-flex;align-items:center;gap:8px;min-width:0;}',
      '.jx-dialog-title-copy{min-width:0;display:flex;align-items:baseline;gap:6px;}',
      '.jx-title{margin:0;font-size:16px;line-height:24px;font-weight:500;}',
      '.jx-dialog-actions{display:flex;align-items:center;gap:4px;flex:0 0 auto;}',
        '.jx-dialog-auto-refresh__note{flex:0 0 auto;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,currentColor);white-space:nowrap;font-variant-numeric:tabular-nums;}',
      '.jx-dialog-close{width:28px;height:28px;min-height:28px;flex:0 0 28px;border-radius:8px;padding:0;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-dialog-close__glyph{display:block;width:16px;height:16px;color:currentColor;}',
      '.jx-header-facts{display:flex;align-items:stretch;gap:8px;min-width:0;}',
      '.jx-header-fact{display:flex;align-items:center;gap:8px;min-width:0;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:8px;}',
      '.jx-header-fact__icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 20px;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-header-fact__copy{display:flex;flex-direction:row;align-items:baseline;gap:4px;min-width:0;}',
      '.jx-header-fact__label{font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,currentColor);white-space:nowrap;}',
      '.jx-header-fact__value{font-size:13px;line-height:18px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,currentColor);white-space:nowrap;}',
      '.jx-dialog-auto-refresh{display:inline-flex;align-items:center;gap:6px;width:auto;height:28px;min-height:28px;padding:0 8px;border-radius:8px;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-dialog-auto-refresh[data-state="on"]{color:var(--dsw-alias-state-success-primary,currentColor);}',
      '.jx-dialog-auto-refresh:disabled{color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-auto-refresh-note{font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,currentColor);white-space:nowrap;font-variant-numeric:tabular-nums;}',


      '.jx-dialog-refresh{width:28px;height:28px;min-height:28px;padding:0;border-radius:8px;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-primary{display:flex;align-items:baseline;gap:7px;margin-top:26px;line-height:1;font-variant-numeric:tabular-nums;}',
      '.jx-primary strong{font-size:30px;line-height:1;font-weight:600;letter-spacing:-.035em;}',
      '.jx-primary__unit{font-size:13px;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-primary__label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}',
      '.jx-cache-primary{gap:9px;}',
      '.jx-cache-primary[data-quality="unknown"] strong{color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-cache-quality{display:inline-flex;align-items:center;margin-top:7px;font-size:11px;line-height:16px;font-weight:600;letter-spacing:.06em;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-cache-primary .jx-cache-quality{margin-top:0;}',
      '.jx-cache-quality[data-quality="high"]{color:var(--dsw-alias-state-success-primary,currentColor);}',
      '.jx-cache-quality[data-quality="medium"]{color:var(--dsw-alias-brand-primary,currentColor);}',
      '.jx-curve{min-height:120px;margin-top:24px;padding:13px 0 10px;border-top:1px solid var(--dsw-alias-border-l2,transparent);border-bottom:1px solid var(--dsw-alias-border-l2,transparent);}',
      '.jx-curve-svg{display:block;width:100%;height:auto;color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-curve-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;font-size:11px;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-curve-label{font-weight:600;}',
      '.jx-curve-empty{display:grid;align-content:center;min-height:82px;gap:5px;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-curve-empty strong{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-curve-empty p{margin:0;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-demo-badge{font-size:10px;color:var(--dsw-alias-label-tertiary,currentColor);border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:4px;padding:1px 6px;margin-left:8px;}',
      '.jx-demo-badge[data-state="stale"]{color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-event-rail{display:flex;align-items:center;gap:8px;min-height:24px;margin-top:1px;padding:11px 0;border-bottom:1px solid var(--dsw-alias-border-l2,transparent);font-size:11px;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-event-rail__marker{width:6px;height:6px;flex:0 0 6px;border:1px solid currentColor;border-radius:50%;}',
      '.jx-event-rail[data-state="working"] .jx-event-rail__marker,.jx-event-rail[data-state="complete"] .jx-event-rail__marker{background:currentColor;}',
      '.jx-event-rail[data-state="complete"]{color:var(--dsw-alias-state-success-primary,currentColor);}',
      '.jx-event-rail[data-state="error"]{color:var(--dsw-alias-state-error-primary,currentColor);}',
      '.jx-event-rail__label{font-weight:600;color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-event-rail__detail{color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-recent{padding-top:16px;font-size:12px;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-recent__label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-recent-rows{display:flex;flex-direction:column;gap:0;margin-top:6px;border-top:1px solid var(--dsw-alias-border-l2,transparent);}',
      '.jx-recent-row{display:grid;grid-template-columns:42px 18px 64px 72px minmax(0,1fr) 48px;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--dsw-alias-border-l2,transparent);font-size:11px;line-height:1.3;color:var(--dsw-alias-label-secondary,currentColor);font-variant-numeric:tabular-nums;}',
      '.jx-recent-row__turn{color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-recent-row__status{color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-recent-row__spark{letter-spacing:-.05em;color:var(--dsw-alias-label-primary,currentColor);white-space:nowrap;}',
      '.jx-recent-row__metric{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.jx-recent-row__metric--muted{color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-recent-empty{font-size:11px;color:var(--dsw-alias-label-tertiary,currentColor);}',
      // Runtime/Breath is deliberately a single reading surface. The chart
      // is the only strong visual object; all other facts stay in metadata or
      // quiet semantic rows so the panel does not become a second dashboard.
      '.jx-breath-surface .jx-header{padding-bottom:2px;border-bottom:0;}',
      '.jx-breath-surface .jx-title{font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-breath-surface .jx-dialog-close{color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-breath-primary{margin-top:24px;}',
      '.jx-breath-primary__label{font-size:11px;line-height:1.3;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-breath-primary .jx-primary{margin-top:6px;}',

      '.jx-session-readout{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 0;margin-top:10px;min-width:0;max-width:100%;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,currentColor);font-variant-numeric:tabular-nums;}',
      '.jx-session-readout__metric{display:inline-flex;align-items:baseline;min-width:0;white-space:nowrap;}',
      '.jx-session-readout__item{white-space:nowrap;}',
      '.jx-session-readout__separator{margin-inline:6px;color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-session-readout[data-curve-quality="estimated-final"]{color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-session-lanes{display:grid;gap:4px;margin-top:8px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-session-lane{display:grid;grid-template-columns:26px minmax(0,1fr);align-items:center;gap:7px;min-width:0;}',
      '.jx-session-lane__label{white-space:nowrap;}',
      '.jx-session-lane__track{position:relative;display:block;height:8px;border-radius:1px;background:transparent;overflow:visible;}',
      '.jx-session-lane__track::before{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(to right,transparent 0,transparent calc(20% - .5px),var(--dsw-alias-border-l2,transparent) calc(20% - .5px),var(--dsw-alias-border-l2,transparent) calc(20% + .5px),transparent calc(20% + .5px),transparent 20%);opacity:.72;}',
      '.jx-session-lane__marker{position:absolute;top:0;z-index:1;width:8px;height:8px;border-radius:1px;background:var(--dsw-alias-label-secondary,currentColor);transform:translateX(-50%);}',
      '.jx-session-lane__marker[data-kind="input"]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,currentColor) 68%,var(--dsw-alias-label-secondary,currentColor));}',
      '.jx-session-lane__marker[data-kind="model"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-brand-primary,currentColor)) 60%,var(--dsw-alias-state-error-secondary,var(--dsw-alias-label-secondary,currentColor)));}',
      '.jx-session-lane__marker[data-kind="tool"]{background:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary,currentColor));}',
      '.jx-breath-surface .jx-curve{min-height:210px;margin-top:14px;padding:13px 0 10px;border-top:1px solid var(--dsw-alias-border-l2,transparent);border-bottom:1px solid var(--dsw-alias-border-l2,transparent);}',
      '.jx-breath-surface .jx-curve[data-curve-state="empty"]{min-height:0;}',
      '.jx-breath-surface .jx-curve-head{margin-bottom:7px;font-size:12px;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-breath-surface .jx-curve-label{font-size:13px;font-weight:620;color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-curve-source{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,currentColor);font-variant-numeric:tabular-nums;}',
      '.jx-curve-title-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;}',
      '.jx-curve-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-phase-narrative{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-curve-grid{min-height:128px;display:flex;align-items:center;border-top:1px solid var(--dsw-alias-border-l2,transparent);border-bottom:1px solid var(--dsw-alias-border-l2,transparent);background:transparent;}',
      '.jx-curve-grid:has(.jx-curve-empty){min-height:88px;background:none;border-top:0;border-bottom:0;}',
      '.jx-curve-grid .jx-curve-svg{height:128px;color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-curve-event-ticks{position:absolute;inset:0;pointer-events:none;}',
       '.jx-curve-event-tick{position:absolute;top:4px;bottom:4px;width:1px;background:color-mix(in srgb,var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-business-primary,currentColor)) 28%,transparent);opacity:.75;}',
       '.jx-curve-event-tick::before{content:"";position:absolute;top:0;left:-2px;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-business-primary,currentColor));}',
       '.jx-curve-event-tick__dot{position:absolute;left:50%;z-index:2;width:10px;height:10px;border:2px solid var(--dsw-alias-bg-layer-1,currentColor);border-radius:50%;background:var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-business-primary,currentColor));box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-label-primary,currentColor) 8%,transparent);transform:translate(-50%,-50%);}',
       '.jx-curve-event-tick[data-event-kind="tool"]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary-new-colorprimary-new-color,currentColor)) 32%,transparent);}',
       '.jx-curve-event-tick[data-event-kind="tool"] .jx-curve-event-tick__dot{background:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary-new-colorprimary-new-color,currentColor));}',
       '.jx-curve-event-tick[data-event-kind="tool"]::before{background:var(--dsw-alias-state-warn-primary,var(--dsw-alias-brand-primary-new-colorprimary-new-color,currentColor));}',
       '.jx-curve-event-tick[data-event-kind="retry"]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,var(--dsw-alias-brand-primary-new-colorprimary-new-color,currentColor)) 32%,transparent);}',
       '.jx-curve-event-tick[data-event-kind="retry"]::before{background:var(--dsw-alias-state-error-primary,var(--dsw-alias-brand-primary-new-colorprimary-new-color,currentColor));}',
       '.jx-curve-event-tick[data-event-kind="compaction"]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,var(--dsw-alias-brand-primary-new-colorprimary-new-color,currentColor)) 32%,transparent);}',
       '.jx-curve-event-tick[data-event-kind="compaction"]::before{background:var(--dsw-alias-state-error-primary,var(--dsw-alias-brand-primary-new-colorprimary-new-color,currentColor));}',
       '.jx-curve-event-tick[data-event-kind="retry"] .jx-curve-event-tick__dot{background:var(--dsw-alias-state-error-primary,currentColor);}',
       '.jx-curve-event-tick[data-event-kind="compaction"] .jx-curve-event-tick__dot{background:var(--dsw-alias-state-error-primary,currentColor);}',
      '.jx-breath-surface .jx-event-rail{margin-top:0;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l2,transparent);color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-breath-surface .jx-event-rail__label{color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-breath-surface .jx-curve-grid{position:relative;}',
      '.jx-curve-legend{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:6px 14px;margin:-1px 0 8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-curve-legend__item{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;}',
      '.jx-curve-legend__swatch{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-business-primary,currentColor));}',
      '.jx-curve-legend__item[data-kind="tool"] .jx-curve-legend__swatch{background:var(--dsw-alias-state-warn-primary,currentColor);}',
      '.jx-curve-legend__item[data-kind="issue"] .jx-curve-legend__swatch{background:var(--dsw-alias-state-error-primary,currentColor);}',
      '.jx-curve-peak{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:16px;color:var(--dsw-alias-state-warn-primary,currentColor);font-variant-numeric:tabular-nums;}',
      '.jx-breath-surface .jx-curve-grid{display:grid;grid-template-columns:32px minmax(0,1fr);align-items:stretch;min-width:0;min-height:166px;}',
      '.jx-curve-yaxis{display:flex;flex-direction:column;justify-content:space-between;min-width:0;height:128px;padding-right:8px;font-size:10px;line-height:14px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-curve-yaxis__tick{white-space:nowrap;}',
      '.jx-curve-plot{position:relative;min-width:0;height:166px;padding-bottom:38px;box-sizing:border-box;}',
      '.jx-curve-guides{position:absolute;z-index:0;inset:0 0 38px;pointer-events:none;}',
      '.jx-curve-guides i{position:absolute;left:0;right:0;height:1px;border-top:1px dashed var(--dsw-alias-border-l2,transparent);opacity:.75;}',
      '.jx-breath-surface .jx-curve-plot .jx-curve-svg{position:absolute;z-index:1;inset:0 0 auto;width:100%;height:128px;color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-business-primary,currentColor));}',
      '.jx-curve-area{opacity:.12;}',
      '.jx-curve-line{color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-business-primary,currentColor));}',
      '.jx-curve-event-tick{background:var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-business-primary,currentColor));}',
      '.jx-curve-plot .jx-curve-event-ticks{z-index:2;left:0;right:0;top:0;bottom:38px;}',
      '.jx-curve-cursor{position:absolute;z-index:3;top:-18px;bottom:38px;width:1px;border-left:1px dashed var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-business-primary,currentColor));font-size:10px;line-height:14px;white-space:nowrap;color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-business-primary,currentColor));transform:translateX(-50%);}',
      '.jx-curve-cursor[data-state="complete"]{border-left-color:var(--dsw-alias-label-tertiary,currentColor);color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-curve-cursor[data-state="live"],.jx-curve-cursor[data-state="complete"]{top:0;transform:translateX(-100%);padding-right:4px;text-align:right;}',
      '.jx-curve-xaxis{position:absolute;z-index:3;left:0;right:0;bottom:0;height:28px;font-size:10px;line-height:16px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-curve-xaxis__tick{position:absolute;top:5px;transform:translateX(-50%);white-space:nowrap;}',
      '.jx-curve-xaxis__tick[data-edge="start"]{transform:none;}',
      '.jx-curve-xaxis__tick[data-edge="end"]{transform:translateX(-100%);}',
      '.jx-breath-surface .jx-recent{padding-top:10px;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-breath-surface .jx-recent__label{font-size:13px;color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-breath-surface .jx-recent-rows{border-top-color:var(--dsw-alias-border-l2,transparent);}',
      '.jx-breath-surface .jx-recent-row{border-bottom-color:var(--dsw-alias-border-l2,transparent);color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-breath-surface .jx-recent-row__turn{color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-breath-surface .jx-recent-row__spark{color:var(--dsw-alias-label-primary,currentColor);}',
      // The reference design keeps the chart frame visible while the data
      // layer honestly reports an insufficient sample state.
      '.jx-breath-surface .jx-curve[data-curve-state="empty"]{min-height:210px;}',
      '.jx-breath-surface .jx-curve[data-curve-state="empty"] .jx-curve-grid{min-height:128px;background:none;border-top:1px solid var(--dsw-alias-border-l2,transparent);border-bottom:1px solid var(--dsw-alias-border-l2,transparent);}',
      '.jx-quota-title__note{margin:0;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,currentColor);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.jx-settings{color:var(--dsw-alias-label-primary,currentColor);}',
      '.jx-settings-row{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 8px;border-top:1px solid var(--dsw-alias-border-l2,transparent);font-size:14px;line-height:22px;}',
      '.jx-settings-row__icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:0 0 28px;color:currentColor;}',
      '.jx-settings-row__glyph{display:block;width:24px;height:24px;}',
      '.jx-settings-row__label{font-weight:500;}',
      '.jx-settings-body{display:flex;flex-direction:column;gap:16px;padding:4px 8px 20px;}',
      '.jx-settings-open{display:flex;flex-direction:column;gap:6px;}',
      '.jx-settings-open__btn{align-self:flex-start;}',
      '.jx-settings-open__hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-settings-section{display:flex;flex-direction:column;gap:6px;}',
      '.jx-settings-section__title{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,currentColor);font-weight:600;}',
      '.jx-settings-state{display:flex;align-items:baseline;gap:8px;font-size:14px;line-height:22px;min-height:28px;}',
      '.jx-settings-state__label{flex:0 0 88px;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-settings-state__value{flex:1;font-weight:500;}',
      '.jx-settings-state__hint{font-size:12px;color:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-settings-state[data-state="ok"] .jx-settings-state__value{color:var(--dsw-alias-state-success-primary,currentColor);}',
      '.jx-settings-state[data-state="error"] .jx-settings-state__value{color:var(--dsw-alias-state-error-primary,currentColor);}',
      '.jx-settings-state[data-state="warn"] .jx-settings-state__value{color:var(--dsw-alias-state-warning-primary,currentColor);}',
      '.jx-settings-doctor{border-top:1px solid var(--dsw-alias-border-l2,transparent);padding-top:8px;}',
      '.jx-settings-doctor__summary{cursor:pointer;font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-secondary,currentColor);}',
      '.jx-settings-doctor__body{display:flex;flex-direction:column;gap:4px;padding:8px 0 0 12px;}',
      '.jx-settings-doctor__actions{padding-top:8px;display:flex;gap:8px;}',
      '.jx-dialog-close:focus-visible,.jx-fc-btn:focus-visible{outline:1px solid var(--dsw-alias-focus-ring,currentColor);outline-offset:2px;}',

      '@container jingxi-surface (max-width:520px){.jx-recent-row{grid-template-columns:36px 16px 50px 60px minmax(0,1fr) 38px;gap:4px;font-size:10px;}.jx-session-readout{font-size:12px;line-height:18px;}.jx-session-readout__separator{margin-inline:4px;}}',
      '@container jingxi-surface (max-width:520px){.jx-breath-surface .jx-curve-grid{grid-template-columns:26px minmax(0,1fr);}.jx-curve-yaxis{padding-right:5px;font-size:9px;}.jx-curve-legend{justify-content:flex-start;gap:5px 10px;font-size:10px;}.jx-curve-xaxis__tick:nth-child(2),.jx-curve-xaxis__tick:nth-child(4){display:none;}}',

      '@media (max-width:520px){.jx-modal--breath{width:calc(100vw - 24px);max-height:calc(100dvh - 32px);}.jx-primary strong{font-size:28px;}.jx-recent-row{grid-template-columns:36px 16px 50px 60px minmax(0,1fr) 38px;gap:4px;font-size:10px;}.jx-fc-btn{padding-inline:8px;}}',
      '@media (max-width:520px){.jx-phase-narrative{white-space:normal;}}',
       // Native Convergence：保留一条主读数和一条共享轨迹，避免把 Breath 变成第二套 Dashboard。
       '.jx-breath-native{padding-bottom:20px;}',
      '.jx-breath-native .jx-header{align-items:flex-start;flex:0 0 auto;padding:14px 18px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,transparent);}',
       '.jx-breath-native .jx-title-lockup{align-items:flex-start;gap:10px;}',

       '.jx-breath-native .jx-title{font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.015em;}',
       '.jx-breath-native .jx-quota-title__note{display:flex;align-items:center;gap:6px;margin-top:1px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,currentColor);}',
       '.jx-breath-subtitle__description{display:inline;}',
       '.jx-breath-subtitle__status{display:inline;}',
      '.jx-breath-native .jx-quota-title__note::before{content:"";display:inline-block;width:6px;height:6px;flex:0 0 6px;border-radius:50%;background:var(--dsw-alias-label-tertiary,currentColor);}',
      '.jx-breath-native .jx-quota-title__note[data-thread-status="active"]::before{background:var(--dsw-alias-brand-primary,var(--dsw-alias-state-business-primary,currentColor));box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,var(--dsw-alias-state-business-primary,currentColor)) 14%,transparent);}',
      '.jx-breath-native .jx-quota-title__note[data-thread-status="stable"]::before{background:var(--dsw-alias-state-success-primary,currentColor);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary,currentColor) 14%,transparent);}',
      '.jx-breath-native .jx-quota-title__note[data-thread-status="failed"]::before{background:var(--dsw-alias-state-error-primary,currentColor);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-error-primary,currentColor) 14%,transparent);}',
      '.jx-breath-native .jx-quota-title__note[data-freshness="stale"]{color:var(--dsw-alias-label-tertiary,currentColor);}',
       '.jx-breath-native .jx-breath-primary{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:12px;margin-top:20px;}',
       '.jx-breath-native .jx-breath-primary__speed{min-width:0;}',
       '.jx-breath-native .jx-breath-primary__label{display:block;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,currentColor);}',
       '.jx-breath-native .jx-primary{margin-top:4px;}',
       '.jx-breath-native .jx-primary strong{font-size:32px;line-height:34px;color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary,currentColor)));}',
       '.jx-breath-native .jx-primary__unit{margin-left:2px;font-size:13px;color:var(--dsw-alias-label-secondary,currentColor);}',
       '.jx-breath-primary__freshness{margin-left:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,currentColor);}',
       '.jx-breath-primary__freshness[data-state="stale"]{color:var(--dsw-alias-state-warn-primary,currentColor);}',
       '.jx-breath-primary__cache{display:flex;align-items:baseline;justify-content:flex-end;gap:6px;min-width:0;padding-bottom:3px;font-variant-numeric:tabular-nums;}',
       '.jx-breath-primary__cache-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,currentColor);}',
       '.jx-breath-primary__cache-value{font-size:18px;line-height:24px;font-weight:600;color:var(--dsw-alias-label-primary,currentColor);}',
       '.jx-breath-primary__cache[data-quality="unknown"] .jx-breath-primary__cache-value{color:var(--dsw-alias-label-tertiary,currentColor);}',
       '.jx-breath-primary__cache .jx-cache-quality{margin-top:0;}',

       '.jx-breath-native .jx-session-readout{margin-top:12px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l2,transparent);border-bottom:1px solid var(--dsw-alias-border-l2,transparent);font-size:12px;line-height:18px;}',
       '.jx-trajectory-strip{margin-top:16px;padding:0 0 10px;border-bottom:1px solid var(--dsw-alias-border-l2,transparent);}',
       '.jx-trajectory-strip__heading{display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-width:0;margin-bottom:9px;}',
       '.jx-trajectory-strip__title{font-size:13px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary,currentColor);}',
       '.jx-trajectory-strip__meta{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,currentColor);font-variant-numeric:tabular-nums;}',
       '.jx-trajectory-strip .jx-session-lanes{margin-top:0;}',
        '.jx-trajectory-strip .jx-session-lane__track{height:9px;border-radius:999px;background:var(--dsw-alias-fill-tertiary,var(--dsw-alias-border-l2,transparent));}',
       '.jx-trajectory-strip .jx-session-lane__track::before{opacity:.6;}',
        '.jx-trajectory-strip .jx-session-lane__marker{top:.5px;height:8px;border-radius:999px;}',
       '.jx-trajectory-strip .jx-session-lane__marker[data-role="segment"]{width:var(--jx-segment-width,8px);min-width:3px;transform:none;}',
       '.jx-trajectory-axis{display:grid;grid-template-columns:26px minmax(0,1fr);align-items:start;margin-top:2px;font-size:10px;line-height:16px;}',
       '.jx-trajectory-axis__track{position:relative;display:block;min-width:0;height:16px;}',
       '.jx-trajectory-axis__tick{position:absolute;transform:translateX(-50%);white-space:nowrap;}',
       '.jx-trajectory-axis__tick[data-edge="start"]{transform:none;}',
       '.jx-trajectory-axis__tick[data-edge="end"]{transform:translateX(-100%);}',
       '.jx-breath-reading{padding:0;}',
       '.jx-breath-native .jx-curve{margin-top:8px;}',
       '.jx-breath-native .jx-trajectory-strip{padding:14px 16px 12px;border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:12px;background:var(--dsw-alias-bg-layer-1,transparent);}',
       '.jx-breath-native .jx-curve{border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:12px;padding:10px 12px 10px;background:var(--dsw-alias-bg-layer-1,transparent);}',
       '@media (max-width:520px){.jx-breath-native .jx-trajectory-strip{padding:12px;}.jx-breath-native .jx-curve{padding:12px 12px 10px;}}',
       '.jx-breath-native .jx-event-rail{margin-top:0;}',
       '@media (max-width:520px){.jx-breath-native{padding-bottom:12px;}.jx-breath-native .jx-header{padding-top:2px;flex-wrap:wrap;row-gap:6px;}.jx-breath-native .jx-title-lockup{order:1;min-width:0;}.jx-breath-native .jx-header-facts{order:2;flex:1 1 100%;}.jx-breath-native .jx-dialog-actions{order:3;margin-left:auto;}.jx-breath-native .jx-title{font-size:17px;line-height:24px;}.jx-breath-native .jx-quota-title__note{display:block;}.jx-breath-subtitle__description{display:none;}.jx-breath-subtitle__status{display:inline;}.jx-breath-native .jx-breath-primary{grid-template-columns:minmax(0,1fr);align-items:start;gap:4px;margin-top:16px;}.jx-breath-primary__cache{justify-content:flex-start;padding-bottom:0;}.jx-breath-native .jx-primary strong{font-size:28px;line-height:30px;}.jx-trajectory-strip{margin-top:14px;}.jx-trajectory-strip__heading{align-items:flex-start;flex-direction:column;gap:1px;}.jx-breath-reading{padding-inline:0;}}',



       '.jx-phase-story{min-width:0;padding:15px;border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:12px;background:var(--dsw-alias-bg-layer-1,transparent);}',
       '.jx-phase-story__heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px;}',
       '.jx-phase-story__heading strong{font-size:14px;line-height:20px;font-weight:620;color:var(--dsw-alias-label-primary,currentColor);}',
       '.jx-phase-story__hint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary,currentColor);}',
       '.jx-phase-story__rail{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;}',
       '.jx-phase-story__card{position:relative;min-width:0;min-height:96px;padding:10px;border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:9px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,transparent));}',
       '.jx-phase-story__card-head{display:flex;align-items:center;gap:6px;min-width:0;font-size:11px;line-height:16px;font-weight:600;color:var(--dsw-alias-label-primary,currentColor);}',
       '.jx-phase-story__dot{display:block;width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:var(--dsw-alias-label-tertiary,currentColor);}',
       '.jx-phase-story__card[data-tone="blue"] .jx-phase-story__dot{background:var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-business-primary,currentColor));}',
       '.jx-phase-story__card[data-tone="purple"] .jx-phase-story__dot{background:var(--jx-trajectory-input,currentColor);}',
       '.jx-phase-story__card[data-tone="green"] .jx-phase-story__dot{background:var(--dsw-alias-state-success-primary,currentColor);}',
       '.jx-phase-story__card[data-tone="orange"] .jx-phase-story__dot{background:var(--jx-trajectory-model,currentColor);}',
       '.jx-phase-story__card[data-tone="red"] .jx-phase-story__dot{background:var(--dsw-alias-state-error-primary,currentColor);}',
       '.jx-phase-story__card[data-state="complete"]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,currentColor) 35%,var(--dsw-alias-border-l2,transparent));}',
       '.jx-phase-story__card[data-state="active"]{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,var(--dsw-alias-state-business-primary,currentColor)) 42%,var(--dsw-alias-border-l2,transparent));box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,var(--dsw-alias-state-business-primary,currentColor)) 12%,transparent);}',
       '.jx-phase-story__card[data-state="error"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,currentColor) 42%,var(--dsw-alias-border-l2,transparent));box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-error-primary,currentColor) 10%,transparent);}',
       '.jx-phase-story__card p{margin:8px 0 0;font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary,currentColor);}',
       '.jx-phase-story__connector{position:absolute;z-index:1;top:18px;right:-9px;width:9px;border-top:1px dashed var(--dsw-alias-border-l2,transparent);}',
        '@container jingxi-surface (max-width:820px){.jx-phase-story__rail{grid-template-columns:repeat(3,minmax(0,1fr));}.jx-phase-story__connector{display:none;}}',
        '@container jingxi-surface (max-width:520px){.jx-phase-story{padding:12px;}.jx-phase-story__rail{grid-template-columns:repeat(2,minmax(0,1fr));}.jx-phase-story__heading{align-items:flex-start;flex-direction:column;gap:2px;}.jx-phase-story__hint{white-space:normal;}}',
       // Effect-image alignment pass: keep the main column intentionally quiet
       // and let the real timeline/curve carry the visual weight.
       '.jx-title-lockup--plain{gap:0;}',
       '.jx-info-hint{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;margin-left:5px;border:1px solid currentColor;border-radius:50%;font-size:10px;line-height:12px;font-weight:600;font-family:Georgia,serif;color:var(--dsw-alias-label-tertiary,currentColor);vertical-align:1px;}',

       '.jx-breath-native{--jx-trajectory-input:#b9a1f1;--jx-trajectory-model:#f2b17f;--jx-trajectory-tool:#9bbff5;}',
        '@media (prefers-color-scheme:dark){.jx-breath-native{--jx-trajectory-input:var(--dsw-alias-brand-primary,currentColor);--jx-trajectory-model:#f2b17f;--jx-trajectory-tool:#9bbff5;}}',

       '.jx-phase-story__hint{display:none;}',
       '.jx-trajectory-strip{position:relative;}',
       '.jx-trajectory-strip .jx-session-lane__marker[data-kind="input"]{width:var(--jx-segment-width,8px);min-width:5px;transform:none;background:var(--jx-trajectory-input);border-radius:999px;}',
       '.jx-trajectory-strip .jx-session-lane__marker[data-kind="model"]{background:var(--jx-trajectory-model);border-radius:999px;}',
       '.jx-trajectory-strip .jx-session-lane__marker[data-kind="tool"]{background:var(--jx-trajectory-tool);border-radius:999px;}',
       '.jx-trajectory-now{position:absolute;z-index:4;top:-3px;bottom:-3px;width:1px;border-left:1px dashed var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-business-primary,currentColor));color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,var(--dsw-alias-state-business-primary,currentColor));font-style:normal;pointer-events:none;}',
       '.jx-session-lane__track>.jx-trajectory-now{top:-7px;bottom:-7px;}',
       '.jx-trajectory-axis__track>.jx-trajectory-now{top:-9px;bottom:0;padding-top:0;font-size:10px;line-height:16px;white-space:nowrap;transform:translateX(-50%);}',
      '.jx-trajectory-axis__track>.jx-trajectory-now[data-state="complete"]{top:-20px;color:var(--dsw-alias-label-tertiary,currentColor);border-left-color:var(--dsw-alias-label-tertiary,currentColor);transform:translateX(-100%);padding-right:4px;text-align:right;}',
       '.jx-curve-legend__item[data-kind="cache"] .jx-curve-legend__swatch{background:var(--dsw-alias-state-success-primary,currentColor);}',




       // ── P0 Breath-core：aside 已删除，曲线成为唯一视觉中心 ──
       '.jx-curve-title-row{gap:8px;}',

       '.jx-breath-native .jx-trajectory-strip.jx-trajectory-strip--compact{display:flex;align-items:center;gap:10px;min-width:0;margin-top:16px;padding:7px 12px;}',
       '.jx-breath-native .jx-trajectory-strip--compact .jx-trajectory-strip__meta{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,currentColor);font-variant-numeric:tabular-nums;}',
       '.jx-breath-native .jx-trajectory-strip--compact .jx-trajectory-strip__track{position:relative;flex:1 1 auto;min-width:0;height:8px;border-radius:999px;background:var(--dsw-alias-fill-tertiary,var(--dsw-alias-border-l2,transparent));}',
       '.jx-breath-native .jx-trajectory-strip--compact .jx-trajectory-strip__marker{position:absolute;top:0;height:8px;border-radius:999px;}',
       '.jx-breath-native .jx-trajectory-strip--compact .jx-trajectory-strip__marker[data-kind="input"]{width:var(--jx-segment-width,5px);min-width:3px;background:var(--jx-trajectory-input);}',
       '.jx-breath-native .jx-trajectory-strip--compact .jx-trajectory-strip__marker[data-kind="model"]{background:var(--jx-trajectory-model);}',
       '.jx-breath-native .jx-trajectory-strip--compact .jx-trajectory-strip__marker[data-kind="tool"]{background:var(--jx-trajectory-tool);}',
       '.jx-breath-native .jx-trajectory-strip--compact .jx-trajectory-now{top:-3px;bottom:-3px;}',
       '.jx-breath-native .jx-trajectory-strip--compact .jx-trajectory-strip__ticks{position:relative;flex:0 0 104px;height:14px;}',
       '.jx-breath-native .jx-trajectory-strip--compact .jx-trajectory-strip__tick{position:absolute;transform:translateX(-50%);font-size:9px;line-height:14px;color:var(--dsw-alias-label-tertiary,currentColor);white-space:nowrap;font-variant-numeric:tabular-nums;}',
       '.jx-breath-native .jx-trajectory-strip--compact .jx-trajectory-strip__tick[data-edge="start"]{transform:none;}',
       '.jx-breath-native .jx-trajectory-strip--compact .jx-trajectory-strip__tick[data-edge="end"]{transform:translateX(-100%);}',
        '.jx-breath-native .jx-curve-grid{min-height:340px;}',
        '.jx-breath-native .jx-curve-plot{height:340px;padding-bottom:32px;}',
        '.jx-breath-native .jx-curve-guides{inset:0 0 32px;}',
        '.jx-breath-native .jx-curve-yaxis{height:308px;}',
        '.jx-breath-native .jx-curve-plot .jx-curve-svg{height:308px;}',
        '.jx-breath-native .jx-curve-xaxis{height:32px;}',
        '.jx-breath-native .jx-curve-plot .jx-curve-event-ticks{bottom:32px;}',
        '.jx-breath-native .jx-curve-cursor{bottom:32px;}',



       '.jx-phase-story--compact{padding:10px 14px;}',
       '.jx-phase-story__fold{min-width:0;}',
       '.jx-phase-story__summary{display:flex;align-items:baseline;gap:10px;min-width:0;margin:0;cursor:pointer;list-style:none;}',
       '.jx-phase-story__summary::-webkit-details-marker{display:none;}',
       '.jx-phase-story__title{flex:0 0 auto;font-size:13px;line-height:18px;font-weight:620;color:var(--dsw-alias-label-primary,currentColor);white-space:nowrap;}',
       '.jx-phase-story__narrative{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary,currentColor);}',
        '.jx-phase-story--compact .jx-phase-story__rail{grid-template-columns:repeat(6,minmax(0,1fr));margin-top:10px;}',
        // ── 视觉收敛（权威审查 P0）：展开侧栏鲸息分区 + 中央弹窗 body 布局 ──
        // 全部使用现有 --dsw-alias-* token；细线统一复用 divider token
        //（--dsw-alias-border-l2，同 .jx-fc-divider--breath 语义）。

        '.jx-fc-breath{display:flex;flex-direction:column;gap:0;width:100%;min-width:0;box-sizing:border-box;}',
        '.jx-fc-status-block{display:flex;flex-direction:column;gap:0;min-width:0;padding:0 8px 2px;}',
        '.jx-fc-status{display:flex;align-items:center;gap:7px;min-width:0;height:20px;font-size:12px;line-height:20px;}',
        '.jx-fc-status-scope{display:block;min-width:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,currentColor);font-variant-numeric:tabular-nums;}',
        '.jx-fc-status__dot{display:block;width:8px;height:8px;flex:0 0 8px;border-radius:50%;background:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-fc-status__dot[data-state="active"],.jx-fc-status__dot[data-state="stable"]{background:var(--dsw-alias-state-success-primary,currentColor);}',
        '.jx-fc-status__dot[data-state="failed"]{background:var(--dsw-alias-state-error-primary,currentColor);}',
        '.jx-fc-status__dot[data-state="active"]{animation:jx-dot-breathe 1600ms ease-in-out infinite;}',
        '.jx-fc-status__label{font-weight:600;color:var(--dsw-alias-label-primary,currentColor);white-space:nowrap;}',
        '.jx-fc-status__turn{min-width:0;overflow:hidden;text-overflow:clip;white-space:nowrap;color:var(--dsw-alias-label-tertiary,currentColor);font-variant-numeric:tabular-nums;}',
        '.jx-fc-status__spacer{flex:1 1 auto;min-width:8px;}',
        '.jx-fc-status__rate{display:inline-flex;align-items:baseline;gap:4px;flex:0 0 auto;min-width:0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-fc-status__rate-label{flex:0 0 auto;white-space:nowrap;color:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-fc-status__rate-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-fc-status__rate[data-state="live"] .jx-fc-status__rate-value{color:var(--dsw-alias-label-primary,currentColor);}',
        '.jx-fc-steps{display:flex;flex-direction:column;margin:0;padding:0;list-style:none;}',
        '.jx-fc-step{display:flex;align-items:center;gap:6px;min-width:0;height:21px;font-size:12px;line-height:21px;color:var(--dsw-alias-label-secondary,currentColor);}',
        '.jx-fc-step__mark{flex:0 0 20px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-fc-step[data-step-state="done"] .jx-fc-step__mark{color:var(--dsw-alias-label-secondary,currentColor);}',
        '.jx-fc-step[data-step-state="done"] .jx-fc-step__label{color:var(--dsw-alias-label-primary,currentColor);}',
        '.jx-fc-step__count{margin-left:auto;flex:0 0 auto;min-width:3.5ch;text-align:right;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,currentColor);font-variant-numeric:tabular-nums;}',
        
        '.jx-progress-card{display:flex;flex-direction:column;gap:6px;min-width:0;margin-top:8px;padding:6px 0;border:0;background:transparent;}',
        '.jx-progress-card__summary{display:flex;align-items:center;gap:10px;min-width:0;}',
        '.jx-progress-card__text{flex:0 0 auto;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,currentColor);font-variant-numeric:tabular-nums;}',
        '.jx-progress-card__bar{position:relative;flex:1 1 auto;min-width:40px;height:6px;border-radius:999px;background:var(--dsw-alias-fill-tertiary,var(--dsw-alias-border-l2,transparent));overflow:hidden;}',
        '.jx-progress-card__fill{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:var(--dsw-alias-brand-primary,currentColor);transition:width 240ms ease;}',
        '.jx-progress-card__pct{flex:0 0 auto;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,currentColor);font-variant-numeric:tabular-nums;}',
        '.jx-progress-card__stages{display:flex;align-items:flex-start;gap:4px;min-width:0;margin:0;padding:0;list-style:none;}',
        '.jx-progress-card__stage{display:flex;flex-direction:column;align-items:center;gap:4px;flex:1 1 0;min-width:0;text-align:center;}',
        '.jx-progress-card__dot{width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-progress-card__stage[data-state="done"] .jx-progress-card__dot{background:var(--dsw-alias-state-success-primary,currentColor);}',
        '.jx-progress-card__stage[data-state="running"] .jx-progress-card__dot{background:var(--dsw-alias-brand-primary,currentColor);}',
        '.jx-progress-card__stage-label{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary,currentColor);white-space:nowrap;}',
        '.jx-progress-card__stage-state{font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-progress-card__subagents{display:flex;align-items:baseline;gap:8px;min-width:0;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l2,transparent);}',
        '.jx-progress-card__subagents-label{flex:0 0 auto;font-weight:600;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,currentColor);}',
        '.jx-progress-card__subagents-summary{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,currentColor);}',
'.jx-subagent-dock{display:flex;align-items:baseline;gap:8px;min-width:0;margin-top:4px;padding:6px 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-subagent-dock__label{flex:0 0 auto;font-weight:600;color:var(--dsw-alias-label-secondary,currentColor);}',
        '.jx-subagent-dock__empty{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-subagent-dock__list{flex:1 1 auto;min-width:0;margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;}',
        '.jx-subagent-dock__item{display:flex;flex-direction:column;gap:1px;min-width:0;padding:2px 0;}',
        '.jx-subagent-dock__item[data-depth="2"]{padding-left:12px;}',
        '.jx-subagent-dock__item[data-depth="2"] .jx-subagent-dock__name::before{content:"↳";margin-right:4px;color:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-subagent-dock__item[data-depth="3"]{padding-left:24px;padding-top:0;}',
        '.jx-subagent-dock__row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0;}',
        '.jx-subagent-dock__name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,currentColor);}',
        '.jx-subagent-dock__status{flex:0 0 auto;color:var(--dsw-alias-label-tertiary,currentColor);font-variant-numeric:tabular-nums;}',
        '.jx-subagent-dock__meta{display:flex;flex-wrap:wrap;gap:0 8px;min-width:0;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-subagent-dock__meta-item{flex:0 0 auto;}',
        '.jx-subagent-dock__merged{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-subagent-dock__item[data-status="queued"] .jx-subagent-dock__status{color:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-subagent-dock__item[data-status="running"] .jx-subagent-dock__status{color:var(--dsw-alias-state-info-primary,var(--dsw-alias-brand-primary,currentColor));}',
        '.jx-subagent-dock__item[data-status="completed"] .jx-subagent-dock__status,.jx-subagent-dock__item[data-status="ok"] .jx-subagent-dock__status,.jx-subagent-dock__item[data-status="done"] .jx-subagent-dock__status{color:var(--dsw-alias-state-success-primary,currentColor);}',
        '.jx-subagent-dock__item[data-status="failed"] .jx-subagent-dock__status,.jx-subagent-dock__item[data-status="error"] .jx-subagent-dock__status{color:var(--dsw-alias-state-error-primary,currentColor);}',
        '.jx-subagent-dock__item[data-status="cancelled"] .jx-subagent-dock__status{color:var(--dsw-alias-state-warning-primary,currentColor);}',

        '.jx-breath-body{min-height:0;flex:1 1 auto;overflow:auto;padding:8px 18px 8px;box-sizing:border-box;}',
        '.jx-breath-facts{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px 12px;min-width:0;padding:4px 0 4px;border-bottom:1px solid var(--dsw-alias-border-l2,transparent);}',
        '.jx-fact{display:flex;flex-direction:column;gap:2px;min-width:0;}',
        '.jx-fact__lockup{display:flex;align-items:flex-start;gap:10px;min-width:0;}',
        '.jx-fact__icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:0 0 20px;color:var(--dsw-alias-label-secondary,currentColor);}',
        '.jx-fact__copy{display:flex;flex-direction:column;gap:2px;min-width:0;}',
        '.jx-fact__label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,currentColor);}',
        '.jx-fact__value-lockup{display:flex;align-items:baseline;gap:5px;min-width:0;font-variant-numeric:tabular-nums;}',
        '.jx-fact__value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:18px;font-weight:600;letter-spacing:-.02em;color:var(--dsw-alias-label-primary,currentColor);}',
        '.jx-fact__unit{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,currentColor);}',
        '.jx-fact__meta{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-fact[data-metric="status"][data-state="complete"] .jx-fact__value{color:var(--dsw-alias-state-success-primary,currentColor);}',
        '.jx-fact[data-metric="status"][data-state="working"] .jx-fact__value{color:var(--dsw-alias-brand-primary,currentColor);}',
        '.jx-fact[data-metric="status"][data-state="error"] .jx-fact__value{color:var(--dsw-alias-state-error-primary,currentColor);}',
        '.jx-fact[data-metric="rate"] .jx-fact__icon{color:var(--dsw-alias-brand-primary,currentColor);}',
        '.jx-fact[data-metric="cache"] .jx-fact__icon{color:var(--dsw-alias-state-success-primary,currentColor);}',
        '.jx-fact[data-metric="status"][data-state="complete"] .jx-fact__icon{color:var(--dsw-alias-state-success-primary,currentColor);}',
        '.jx-fact[data-metric="status"][data-state="working"] .jx-fact__icon{color:var(--dsw-alias-brand-primary,currentColor);}',
        '.jx-fact[data-metric="status"][data-state="error"] .jx-fact__icon{color:var(--dsw-alias-state-error-primary,currentColor);}',
        '.jx-fact[data-metric="cache"][data-quality="high"] .jx-fact__value,.jx-fact[data-metric="cache"][data-quality="medium"] .jx-fact__value{color:var(--dsw-alias-state-success-primary,currentColor);}',
        '.jx-breath-detail{min-width:0;margin-top:8px;border-top:1px solid var(--dsw-alias-border-l2,transparent);padding-top:6px;}',
        '.jx-breath-detail__summary{list-style:none;cursor:pointer;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,currentColor);user-select:none;}',
        '.jx-breath-detail__summary::-webkit-details-marker{display:none;}',
        '.jx-breath-detail[open] .jx-breath-detail__summary{margin-bottom:8px;}',
'.jx-breath-folds{display:grid;gap:10px;margin-top:16px;min-width:0;}',
        '.jx-fold{min-width:0;padding:10px 14px;border:1px solid var(--dsw-alias-border-l2,transparent);border-radius:12px;}',
        '.jx-fold__summary{display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-width:0;margin:0;cursor:pointer;list-style:none;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary,currentColor);}',
        '.jx-fold__summary::-webkit-details-marker{display:none;}',
        '.jx-fold__title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '.jx-fold__hint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;font-weight:400;color:var(--dsw-alias-label-tertiary,currentColor);font-variant-numeric:tabular-nums;}',
        '.jx-fold__body{min-width:0;padding-top:8px;}',
        '.jx-summary-grid{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 14px;margin:0;font-size:12px;line-height:20px;font-variant-numeric:tabular-nums;}',
        '.jx-summary-grid dt{color:var(--dsw-alias-label-tertiary,currentColor);}',
        '.jx-summary-grid dd{margin:0;color:var(--dsw-alias-label-primary,currentColor);text-align:right;}',
        '@container jingxi-surface (max-width:640px){.jx-breath-native .jx-header{flex-wrap:wrap;gap:8px 12px;}.jx-breath-native .jx-header-facts{order:3;flex:1 1 100%;margin-top:2px;}.jx-header-fact{padding:3px 8px;}.jx-auto-refresh-note{display:none;}}',
'@container jingxi-surface (max-width:560px){.jx-summary-grid{gap:2px 8px;}}',
        '@container jingxi-surface (max-width:720px){.jx-breath-native .jx-header{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"title actions" "facts facts";align-items:start;column-gap:8px;row-gap:6px;}.jx-breath-native .jx-title-lockup{grid-area:title;min-width:0;}.jx-breath-native .jx-dialog-title-copy{display:block;min-width:0;}.jx-breath-native .jx-quota-title__note{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.jx-breath-native .jx-dialog-actions{grid-area:actions;min-width:0;}.jx-breath-native .jx-header-facts{grid-area:facts;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%;min-width:0;gap:6px 8px;}.jx-breath-native .jx-header-fact{min-width:0;}}',
        '@container jingxi-surface (max-width:360px){.jx-breath-facts{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 10px;}.jx-fact[data-metric="duration"]{grid-column:1/-1;}.jx-fact__value{font-size:16px;line-height:22px;overflow:visible;white-space:normal;}.jx-fact__meta{white-space:normal;line-height:13px;}.jx-fact[data-metric="rate"]{grid-column:1/-1;}.jx-fact[data-metric="rate"] .jx-fact__value{font-size:15px;}}',
        '@container jingxi-surface (max-width:360px){.jx-breath-native .jx-header{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"title actions" "facts facts";align-items:start;column-gap:8px;row-gap:6px;}.jx-breath-native .jx-title-lockup{grid-area:title;min-width:0;}.jx-breath-native .jx-dialog-actions{grid-area:actions;min-width:0;}.jx-breath-native .jx-header-facts{grid-area:facts;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%;min-width:0;gap:6px 8px;}.jx-breath-native .jx-header-fact{align-items:flex-start;min-width:0;padding:3px 8px;}.jx-breath-native .jx-header-fact__copy{flex-direction:column;align-items:flex-start;gap:0;min-width:0;}.jx-breath-native .jx-header-fact__value{overflow-wrap:anywhere;white-space:normal;}}',
        '@container jingxi-surface (max-width:360px){.jx-breath-native .jx-dialog-auto-refresh{width:28px;min-width:28px;padding-inline:0;justify-content:center;}.jx-breath-native .jx-dialog-auto-refresh__label{display:none;}}',
        '@container jingxi-surface (max-width:720px){.jx-breath-body{padding-bottom:0;}.jx-breath-facts{padding-top:0;padding-bottom:0;}.jx-breath-native .jx-event-rail{padding:6px 0;}.jx-breath-native .jx-breath-detail{margin-top:4px;padding-top:2px;}}',
        '@media (max-width:520px){.jx-breath-body{padding:12px 12px 16px;}}',
        '@media (max-height:720px) and (min-width:521px){.jx-breath-native .jx-curve-grid{min-height:210px;}.jx-breath-native .jx-curve-plot{height:210px;padding-bottom:30px;}.jx-breath-native .jx-curve-guides{inset:0 0 30px;}.jx-breath-native .jx-curve-yaxis{height:180px;}.jx-breath-native .jx-curve-plot .jx-curve-svg{height:180px;}.jx-breath-native .jx-curve-xaxis{height:30px;}.jx-breath-native .jx-curve-plot .jx-curve-event-ticks{bottom:30px;}.jx-breath-native .jx-curve-cursor{bottom:30px;}}',
        // Responsive convergence: phone surfaces share the modal's near-full
        // height, while tall Desktop surfaces make room for the 340px curve.
        '@media (max-width:520px){.jx-breath-surface{max-height:calc(100dvh - 32px);}}',
        '@media (min-width:521px) and (min-height:721px){.jx-modal--breath{max-height:min(704px,calc(100dvh - 96px));}}',
        '@media (min-width:521px) and (min-height:721px){.jx-breath-surface{max-height:min(704px,calc(100dvh - 96px));}}',
        '@media (min-width:521px) and (min-height:721px) and (max-height:820px){.jx-breath-native .jx-curve-grid{min-height:210px;}.jx-breath-native .jx-curve-plot{height:210px;padding-bottom:30px;}.jx-breath-native .jx-curve-guides{inset:0 0 30px;}.jx-breath-native .jx-curve-yaxis{height:180px;}.jx-breath-native .jx-curve-plot .jx-curve-svg{height:180px;}.jx-breath-native .jx-curve-xaxis{height:30px;}.jx-breath-native .jx-curve-plot .jx-curve-event-ticks{bottom:30px;}.jx-breath-native .jx-curve-cursor{bottom:30px;}}',
        // At 320px, compact metadata and a single-line phase summary keep the
        // primary facts and the beginning-to-end curve in the first reading.
        '@container jingxi-surface (max-width:360px){.jx-breath-native .jx-title{font-size:15px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.jx-breath-native .jx-breath-facts{gap:4px 8px;}.jx-breath-native .jx-fact{gap:0;}.jx-breath-native .jx-fact__lockup{gap:6px;}.jx-breath-native .jx-fact__icon{width:16px;height:16px;flex-basis:16px;}.jx-breath-native .jx-fact__label{font-size:9px;line-height:12px;}.jx-breath-native .jx-fact__value{font-size:14px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.jx-breath-native .jx-fact__meta{font-size:9px;line-height:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}}',
        '@container jingxi-surface (max-width:360px){.jx-breath-native .jx-curve-head{gap:6px;flex-wrap:nowrap;margin-bottom:4px;font-size:10px;line-height:14px;}.jx-breath-native .jx-curve-label{white-space:nowrap;}.jx-breath-native .jx-curve-source{font-size:9px;line-height:14px;}.jx-breath-native .jx-curve-title-row{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:baseline;gap:2px 8px;margin-bottom:4px;}.jx-breath-native .jx-phase-narrative{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.jx-breath-native .jx-curve-peak{grid-column:1/-1;}.jx-breath-native .jx-curve-legend{gap:2px 8px;margin-bottom:4px;font-size:9px;line-height:13px;}.jx-breath-native .jx-curve-grid{min-height:210px;}.jx-breath-native .jx-curve-plot{height:210px;padding-bottom:30px;}.jx-breath-native .jx-curve-guides{inset:0 0 30px;}.jx-breath-native .jx-curve-yaxis{height:180px;}.jx-breath-native .jx-curve-plot .jx-curve-svg{height:180px;}.jx-breath-native .jx-curve-xaxis{height:30px;}.jx-breath-native .jx-curve-plot .jx-curve-event-ticks{bottom:30px;}.jx-breath-native .jx-curve-cursor{bottom:30px;}}',
        '@media (prefers-reduced-motion: reduce){.jx-breath-surface{scroll-behavior:auto;}.jx-spouts{transition:none;transform:none;}.jx-fc-status__dot[data-state="active"]{animation:none;}}',


    ].join('\n')
    if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="dsh-jingxi/styles"]')) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-jingxi'
      tag.dataset.pluginCss = 'dsh-jingxi/styles'
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ── JingxiMark：标题只复用宿主官方 FishLogo，不复制或裁切鲸鱼主体 ──
    const JingxiMark = ({ size = 18, decorative = true, showSpout = false, state = 'idle' }) =>
      h('span', { className: 'jx-mark', style: { width: size, height: size }, 'data-breath-state': state, 'aria-hidden': decorative ? 'true' : undefined },
        h(FishLogo, { size, className: 'jx-mark__fish', 'data-dsh-official-fish-logo': 'true' }),
        showSpout
          ? h('span', { className: 'jx-mark__spout', 'data-water-language': 'breath', 'aria-hidden': 'true' },
              h(AssetIcon, { path: 'v15/spout/idle.png', size: Math.max(10, Math.round(size * 0.62)) }),
            )
          : null,
      )

    const JingxiDialogHeader = ({ title, titleId, subtitle, subtitleProps, onClose, closeLabel, actions, stats, autoRefresh, showSpout = false, markState = 'idle', showMark = true }) =>
      h('header', { className: 'jx-header' },
        h('div', { className: `jx-title-lockup${showMark ? '' : ' jx-title-lockup--plain'}` },
          showMark ? h(JingxiMark, { size: 20, decorative: true, showSpout, state: markState }) : null,
          h('div', { className: 'jx-dialog-title-copy' },
            h('h2', { id: titleId, className: 'jx-title' }, title),
            subtitle ? h('p', { className: 'jx-quota-title__note', ...(subtitleProps || {}) }, subtitle) : null,
          ),
        ),
        stats && stats.length > 0
          ? h('div', { className: 'jx-header-facts', 'aria-label': '头部实时指标' },
              stats.map((stat) => h('div', { key: stat.key, className: 'jx-header-fact', 'data-header-fact': stat.key, ...(stat.quality ? { 'data-quality': stat.quality } : {}) },
                stat.icon ? h('span', { className: 'jx-header-fact__icon', 'aria-hidden': 'true' }, stat.icon) : null,
                h('span', { className: 'jx-header-fact__copy' },
                  h('span', { className: 'jx-header-fact__label' }, stat.label),
                  h('strong', { className: 'jx-header-fact__value' }, stat.value),
                  stat.meta ? h('span', { className: 'jx-fact__meta' }, stat.meta) : null,
                ),
              )),
            )
          : null,
        h('div', { className: 'jx-dialog-actions' },
          autoRefresh ? h(Button, {
            variant: 'ghost',
            size: 'sm',
            type: 'button',
            className: 'jx-dialog-auto-refresh',
            'data-jx-auto-refresh': 'true',
            'data-state': autoRefresh.on ? 'on' : 'off',
            'aria-label': autoRefresh.disabled ? '自动刷新（仅运行中可用）' : autoRefresh.on ? '暂停自动刷新' : '继续自动刷新',
            title: autoRefresh.disabled ? '会话已结束，自动刷新不可用' : '5秒自动刷新',
            disabled: autoRefresh.disabled,
            onClick: autoRefresh.onToggle,
          }, autoRefresh.on ? h(IconPauseOutline16, { size: 16 }) : h(IconPlayOutline16, { size: 16 }), h('span', { className: 'jx-dialog-auto-refresh__label' }, autoRefresh.on ? '暂停' : '继续')) : null,
          autoRefresh && autoRefresh.on && !autoRefresh.disabled
            ? h('span', { className: 'jx-dialog-auto-refresh__note', 'aria-hidden': 'true' }, `5秒自动刷新 · ${Math.max(1, autoRefresh.countdown ?? 5)} s后刷新`)
            : null,
          actions,
          h(Button, { variant: 'ghost', size: 'sm', className: 'jx-dialog-close', type: 'button', 'data-jx-close': 'true', 'aria-label': closeLabel, onClick: onClose }, h(IconCloseOutline16, { size: 16, className: 'jx-dialog-close__glyph' })),
           ),
        )

    // V1.5 Runtime Mark：侧边栏鲸息入口与面板生命周期状态共享 DSH 官方
    // FishLogo，分别用喷水、单道水波和三线信号区分语义。普通设置等 DSH
    // action 仍可使用上面的 DshActionIcon；这里不改变 lifecycle API，只替换表现层。
    const runtimeStatusPath = (state) => state === 'success'
      ? 'v15/status/success.png'
      : state === 'failed' ? 'v15/status/error.png' : undefined
    const runtimeAccent = (action, state) => {
      if (state === 'failed') {
        return 'var(--dsw-alias-state-error-primary,currentColor)'
      }
      if (state === 'success' || (action === 'update' && state === 'loading')) {
        return 'var(--dsw-alias-state-success-primary,currentColor)'
      }
      return 'var(--dsw-alias-brand-primary,currentColor)'
    }
    const RuntimeFishLogo = ({ size }) =>
      h('span', { className: 'jx-runtime-mark__fish', 'data-dsh-official-fish-logo': 'true' },
        h(FishLogo, { size, className: 'jx-runtime-mark__fish-svg' }),
      )
    const RuntimeWave = ({ action, state, size }) =>
      h('svg', {
        className: 'jx-runtime-mark__decoration jx-runtime-mark__wave',
        width: size,
        height: Math.max(6, Math.round(size * 0.32)),
        viewBox: '0 0 32 10',
        fill: 'none',
        stroke: runtimeAccent(action, state),
        strokeWidth: 2.1,
        strokeLinecap: 'round',
        'data-water-language': 'restart',
        'data-action': action,
        'data-state': state,
        'aria-hidden': 'true',
      }, h('path', { d: 'M1.5 5.5C6.5 2.4 10.5 8 16 5.5C21.5 3 25.5 8.2 30.5 5.5' }))
    const RuntimeSpout = ({ state, size }) => {
      const spout = state === 'active' ? 'light' : state === 'stable' || state === 'high' ? 'stable' : 'idle'
      return h('span', {
        className: 'jx-runtime-mark__decoration jx-runtime-mark__spout',
        'data-water-language': 'breath',
        'data-state': state,
        'aria-hidden': 'true',
      }, h(AssetIcon, { path: `v15/spout/${spout}.png`, size: Math.max(10, Math.round(size * 0.62)) }))
    }
    const RuntimeSignal = ({ action, state, size }) =>
      h('svg', {
        className: 'jx-runtime-mark__decoration jx-runtime-mark__signal',
        width: size,
        height: Math.max(7, Math.round(size * 0.42)),
        viewBox: '0 0 32 14',
        fill: 'none',
        stroke: runtimeAccent(action, state),
        strokeWidth: 2,
        strokeLinecap: 'round',
        'data-water-language': 'signal',
        'data-action': action,
        'data-state': state,
        'aria-hidden': 'true',
      },
      h('path', { d: 'M2 8C9 1 23 1 30 8' }),
      h('path', { d: 'M7 12C12 7 20 7 25 12' }),
      )
    const JingxiRuntimeMark = ({ action, state = 'idle', size = 20, decorative = true }) =>
      h('span', {
        className: 'jx-runtime-mark',
        style: { width: size, height: size },
        'data-jx-runtime-mark': 'true',
        'data-action': action,
        'data-state': state,
        'aria-hidden': decorative ? 'true' : undefined,
      },
      h(RuntimeFishLogo, { size }),
      action === 'restart' ? h(RuntimeWave, { action, state, size }) : null,
      action === 'jingxi' && state === 'active' ? h(RuntimeSpout, { state, size }) : null,
      action === 'update' ? h(RuntimeSignal, { action, state, size }) : null,
      runtimeStatusPath(state)
        ? h(AssetIcon, { path: runtimeStatusPath(state), size: Math.max(10, Math.round(size * 0.42)), className: 'jx-runtime-mark__status' })
        : null,
      )

    // A settled Turn can end in several host-reported failure states. Keep
    // the visual contract centralized so the panel, rail and footer whale do
    // not disagree about whether the thread needs attention.
    const FAILED_TURN_STATUSES = Object.freeze(['interrupted', 'aborted', 'error', 'max-tokens'])
    const isFailedTurnStatus = (status) => FAILED_TURN_STATUSES.includes(status)
    const turnStatusLabel = (status) => {
      if (status === 'completed') return '已完成'
      if (status === 'interrupted') return '已中断'
      if (status === 'aborted') return '已终止'
      if (status === 'error') return '异常'
      if (status === 'max-tokens') return 'Token 上限'
      return '等待下一轮'
    }

    // ── 共享数据模型（sol 终版）：面板与展开侧栏共用同一 fail-closed 计数 ──
    // 业务计数优先来自 fold 的脱敏 activitySummary.generic；旧版没有该
    // 摘要时才回退到真实活动段。sparkline 采样点与 inputTicks 流一律不
    // 作为工具/模型业务计数（可能截断/去过重）。
    // scope 三态显式标注，禁止把会话累计冒充最近 Turn：
    //   turn        最近 Turn #N｜计数：本轮（无 turnId 时仅「计数：本轮」）
    //   session     计数：本会话累计
    //   unavailable 计数：暂不可用（三项显示 —，不是 0）
    const deriveSegmentCounts = (source) => {
      if (!source || typeof source !== 'object') return null
      const segments = Array.isArray(source.segments) ? source.segments : []
      return {
        tool: segments.filter((segment) => segment && segment.kind === 'tool').length,
        model: segments.filter((segment) => segment && segment.kind === 'model').length,
      }
    }
    const nonNegativeCount = (value) => Number.isSafeInteger(value) && value >= 0
    const genericActivityCounts = (summary) => {
      const generic = summary && typeof summary === 'object' && summary.generic && typeof summary.generic === 'object'
        ? summary.generic
        : undefined
      if (!generic) return undefined
      const counts = {
        read: generic.inputSteps,
        tool: generic.toolCalls,
        model: generic.modelGenerations,
      }
      return Object.values(counts).every(nonNegativeCount) ? counts : undefined
    }
    // 脱敏 activitySummary（P1 fold 契约）quality="exact" 时才启用自然语言标签；
    // estimated/缺失一律用可证明的通用标签，绝不把估算伪装成精确事实。
    const activityStepFacts = (turn) => {
      const summary = turn && turn.activitySummary
      const generic = genericActivityCounts(summary)
      if (generic) {
        return {
          source: 'generic',
          labels: { read: '输入步骤', tool: '工具调用', model: '模型生成' },
          counts: generic,
        }
      }
      const exact = summary && summary.quality === 'exact'
        && Number.isSafeInteger(summary.readProject) && Number.isSafeInteger(summary.webSearch) && Number.isSafeInteger(summary.answer)
      if (!exact) return undefined
      return {
        source: 'activity',
        labels: { read: '读取资料', tool: '全网检索', model: '生成回答' },
        counts: { read: summary.readProject, tool: summary.webSearch, model: summary.answer },
      }
    }
    const panelTurnSteps = (view) => {
      const last = view && view.last && typeof view.last === 'object' ? view.last : undefined
      // live.last 是上一份已结算 Turn；当前 Turn 的计数只能从 live 分支
      // 读取，缺少 live.activitySummary 时宁可显示不可用，也不回填旧 Turn。
      const turn = view?.live && typeof view.live === 'object' ? view.live : last
      const activity = activityStepFacts(turn)
      const hasTurnEvidence = Boolean(turn && Array.isArray(turn.inputTicks) && Array.isArray(turn.segments))
      const scope = activity || hasTurnEvidence ? 'turn' : 'unavailable'
      const scopeLabel = scope === 'turn' ? '计数：本轮' : '计数：暂不可用'
      // turnLabel：live 会话显示「当前 Turn #N」（V5.7 确认稿），已结算显示「最近 Turn #N」
      const turnLabel = view?.live && view.live.turn !== undefined
        ? `当前 Turn #${view.live.turn}`
        : last && last.turn !== undefined ? `最近 Turn #${last.turn}` : undefined
      const turnCounts = hasTurnEvidence ? deriveSegmentCounts(turn) : null
      const inputCount = hasTurnEvidence
        ? turn.inputTicks.filter((tick) => tick && tick.kind === 'input').length
        : null
      const steps = [
        { key: 'read', label: '输入步骤', kind: 'input' },
        { key: 'tool', label: '工具调用', kind: 'tool' },
        { key: 'model', label: '模型生成', kind: 'model' },
      ].map((step) => {
        if (activity) return { ...step, label: activity.labels[step.key], count: activity.counts[step.key] }
        if (scope === 'unavailable') return { ...step, count: null }
        if (step.kind === 'input') return { ...step, count: inputCount }
        return { ...step, count: turnCounts ? turnCounts[step.kind] : null }
      })
      const firstOpen = steps.findIndex((step) => step.count === null || step.count === 0)
      return { live: Boolean(view && view.live), steps, firstOpen, scope, scopeLabel, turnLabel }
    }





    // ── Breath formatting helpers（首屏只表达一轮 Turn 的核心事实）──
    const fmtDur = (ms) => {
      if (ms === undefined || ms === null || !Number.isFinite(ms)) return '—'
      const totalSeconds = Math.max(0, Math.round(ms / 1000))
      if (totalSeconds < 60) return `${totalSeconds}s`
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      return `${minutes}m ${String(seconds).padStart(2, '0')}s`
    }
    const fmtSessionDuration = (ms) => {
      if (ms === undefined || ms === null || !Number.isFinite(ms)) return '—'
      const totalSeconds = Math.max(0, Math.round(ms / 1000))
      if (totalSeconds < 60) return `${totalSeconds}s`
      const minutes = Math.floor(totalSeconds / 60)
      if (minutes < 60) {
        const seconds = totalSeconds % 60
        return `${minutes}m${seconds}s`
      }
      const hours = minutes / 60
      if (hours < 24) {
        const h = Math.floor(hours)
        const m = Math.round((hours - h) * 60)
        return m > 0 ? `${h}h${m}m` : `${h}h`
      }
      // ≥24h：显示为小时（一位小数，去尾 0）
      return `${hours.toFixed(1).replace(/\.0$/, '')}h`
    }
    const fmtTokCompact = (n) => {
      if (n === undefined || n === null || !Number.isFinite(n)) return '—'
      const abs = Math.abs(n)
      if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 1 : 2).replace(/\.0+$/, '')}M`
      if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e5 ? 0 : 1).replace(/\.0+$/, '')}k`
      return String(n)
    }
    const fmtSessionTok = (n) => {
      if (n === undefined || n === null || !Number.isFinite(n)) return '—'
      const abs = Math.abs(n)
      const trim = (value) => value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
      if (abs >= 1e6) return `${trim((n / 1e6).toFixed(1))}M`
      if (abs >= 1e3) return `${trim((n / 1e3).toFixed(abs >= 1e5 ? 0 : 1))}K`
      return String(n)
    }
    const fmtSessionLatency = (ms) => {
      if (ms === undefined || ms === null || !Number.isFinite(ms)) return '—'
      const seconds = Math.max(0, ms / 1000)
      if (seconds < 10) return `${seconds.toFixed(1).replace(/\.0$/, '')}s`
      return fmtDur(ms)
    }
    const fmtSessionCount = (value) => Number.isSafeInteger(value) && value >= 0 ? String(value) : '—'
    const sparklineGlyph = (spark) => {
      if (!Array.isArray(spark) || spark.length === 0) return '—'
      const rates = spark.slice(-8).map((p) => Number(p.rateTokS)).filter(Number.isFinite)
      if (rates.length === 0) return '—'
      const max = Math.max(1, ...rates)
      const levels = '▁▂▃▄▅▆▇█'
      return rates.map((rate) => levels[Math.min(levels.length - 1, Math.round((rate / max) * (levels.length - 1)))]) .join('')
    }
    const validCachePct = (p) => p !== undefined && p !== null && Number.isFinite(p) && p >= 0 && p <= 1
    // V5.8 P2.1：删除非数据状态词（评价词），颜色档位保留为内部 data-quality
    // （high/medium），只驱动 CSS 颜色，绝不作为用户可见文案。
    const cacheTier = (p) => {
      if (!validCachePct(p)) return undefined
      if (p >= 0.99) return 'high'
      if (p >= 0.9) return 'medium'
      return undefined
    }
    const fmtCache = (p) => {
      if (!validCachePct(p)) return '—'
      if (p === 1) return '100%'
      const percent = p * 100
      const precision = percent >= 99 ? 4 : 2
      const value = percent.toFixed(precision).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
      return `${value === '100' ? '99.9999' : value}%`
    }
    const eventTickLabel = (kind) => ({ tool: '工具', retry: '重试', compaction: '压缩' })[kind] || '事件'
    const TOOL_EVENT_BUCKETS = 24
    const curveTimeline = (spark) => {
      const times = Array.isArray(spark) ? spark.map((point) => Number(point.tMs)).filter(Number.isFinite) : []
      if (times.length === 0) return undefined
      const min = Math.min(...times)
      const max = Math.max(...times)
      return { min, max, span: Math.max(1, max - min) }
    }
    const curveEventTickPosition = (tick, spark, plotTimeline) => {
      const timeline = plotTimeline || curveTimeline(spark)
      const time = Number(tick?.tMs)
      if (!timeline || !Number.isFinite(time)) return 0
      const mappedTime = typeof timeline.mapTime === 'function' ? timeline.mapTime(time) : time
      const plotMin = timeline.plotMin ?? timeline.min
      const plotSpan = timeline.plotSpan ?? timeline.span
      if (!Number.isFinite(mappedTime) || !Number.isFinite(plotMin) || !Number.isFinite(plotSpan)) return 0
      return Math.max(0, Math.min(100, ((mappedTime - plotMin) / Math.max(1, plotSpan)) * 100))
    }
    const curveEventPointTop = (tick, spark, plotTimeline, axisMax) => {
      const safeSpark = Array.isArray(spark)
        ? spark
          .map((point) => ({ time: Number(point?.tMs), rate: Number(point?.rateTokS) }))
          .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.rate))
        : []
      if (safeSpark.length === 0) return '50%'
      const tickTime = Number(tick?.tMs)
      const nearest = safeSpark.reduce((current, point) => {
        if (!current) return point
        const currentDistance = Math.abs(curveEventTickPosition({ tMs: current.time }, safeSpark, plotTimeline) - curveEventTickPosition({ tMs: tickTime }, safeSpark, plotTimeline))
        const nextDistance = Math.abs(curveEventTickPosition({ tMs: point.time }, safeSpark, plotTimeline) - curveEventTickPosition({ tMs: tickTime }, safeSpark, plotTimeline))
        return nextDistance < currentDistance ? point : current
      }, undefined)
      const maxRate = Number.isFinite(Number(axisMax)) && Number(axisMax) > 0
        ? Number(axisMax)
        : Math.max(1, ...safeSpark.map((point) => point.rate))
      const normalized = Math.max(0, Math.min(1, nearest.rate / maxRate))
      return `${Math.max(0, Math.min(100, (1 - normalized) * 100))}%`
    }
    const trajectoryPlotEventTicks = (trajectory, eventTicks) => {
      const safeTicks = Array.isArray(eventTicks)
        ? eventTicks.filter((tick) => ['tool', 'retry', 'compaction'].includes(tick?.kind) && Number.isFinite(Number(tick?.tMs)))
        : []
      const toolSegmentTicks = Array.isArray(trajectory?.segments)
        ? trajectory.segments
          .filter((segment) => segment?.kind === 'tool' && Number.isFinite(Number(segment?.startMs)))
          .map((segment) => ({ tMs: Number(segment.startMs), kind: 'tool' }))
        : []
      const seen = new Set()
      return [...safeTicks, ...toolSegmentTicks]
        .filter((tick) => {
          const key = `${tick.kind}:${Number(tick.tMs)}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .sort((a, b) => Number(a.tMs) - Number(b.tMs))
    }
    const visibleEventTicks = (eventTicks, spark, plotTimeline) => {
      const safeTicks = Array.isArray(eventTicks)
        ? eventTicks.filter((tick) => ['tool', 'retry', 'compaction'].includes(tick?.kind) && Number.isFinite(Number(tick?.tMs)))
        : []
      const toolTicks = safeTicks.filter((tick) => tick.kind === 'tool')
      if (toolTicks.length <= TOOL_EVENT_BUCKETS) return safeTicks.map((tick) => ({ ...tick, count: 1 }))

      // The complete tool intervals remain in the Tools lane below. Only the
      // decorative overlay is bucketed so a long real session does not turn
      // the BreathCurve into a forest of vertical lines.
      const buckets = new Map()
      for (const tick of toolTicks) {
        const position = curveEventTickPosition(tick, spark, plotTimeline)
        const bucket = Math.min(TOOL_EVENT_BUCKETS - 1, Math.floor((position / 100) * TOOL_EVENT_BUCKETS))
        const current = buckets.get(bucket)
        if (current) {
          current.count += 1
          current.tMs = Math.min(current.tMs, Number(tick.tMs))
        } else {
          buckets.set(bucket, { ...tick, tMs: Number(tick.tMs), count: 1 })
        }
      }
      const clusteredTools = [...buckets.values()]
      return [...safeTicks.filter((tick) => tick.kind !== 'tool').map((tick) => ({ ...tick, count: 1 })), ...clusteredTools]
        .sort((a, b) => Number(a.tMs) - Number(b.tMs))
    }
    const derivePhaseNarrative = (spark, eventTicks, status, live) => {
      const rates = Array.isArray(spark) ? spark.map((point) => Number(point.rateTokS)).filter(Number.isFinite) : []
      const safeTicks = Array.isArray(eventTicks) ? eventTicks.filter((tick) => ['tool', 'retry', 'compaction'].includes(tick?.kind)) : []
      if (!live && rates.length === 0 && safeTicks.length === 0 && !status) return '等待下一轮 Turn'
      const stages = ['启动']
      if (rates.length >= 2 && Math.max(...rates) > Math.max(1, rates[0]) * 1.15) stages.push('加速')
      if (rates.length >= 3) stages.push('巡航')
      if (safeTicks.some((tick) => tick.kind === 'tool')) stages.push('工具停顿')
      if (safeTicks.some((tick) => tick.kind === 'retry' || tick.kind === 'compaction')) stages.push('扰动')
      if (safeTicks.length > 0 && rates.length >= 2) stages.push('恢复')
      if (live) stages.push('生成中')
      else if (status === 'completed' || status === 'aborted' || status === 'interrupted' || status === 'error' || status === 'max-tokens') stages.push('收束')
      return [...new Set(stages)].join(' → ')
    }
    const breathCurveAriaLabel = (spark) => {
      const rates = Array.isArray(spark) ? spark.map((point) => Number(point.rateTokS)).filter(Number.isFinite) : []
      if (rates.length < 2) return 'BreathCurve，暂无足够的速度采样'
      const min = Math.round(Math.min(...rates))
      const max = Math.round(Math.max(...rates))
      return `BreathCurve，${rates.length} 个速度采样，范围 ${min}–${max} tok/s`
    }
    const RuntimeEventTicks = ({ spark, eventTicks, plotTimeline, axisMax }) => {
      const safeTicks = visibleEventTicks(eventTicks, spark, plotTimeline)
      if (safeTicks.length === 0) return null
      return h('div', { className: 'jx-curve-event-ticks', 'aria-hidden': 'true' },
        safeTicks.map((tick, index) => h('span', {
          key: `${tick.kind}-${tick.tMs}-${index}`,
          className: 'jx-curve-event-tick',
          'data-event-kind': tick.kind,
          'data-event-count': tick.count ?? 1,
          title: tick.count > 1 ? `${eventTickLabel(tick.kind)}事件 · ${tick.count} 次` : eventTickLabel(tick.kind),
          style: { left: `${curveEventTickPosition(tick, spark, plotTimeline)}%` },
        }, h('i', {
          className: 'jx-curve-event-tick__dot',
          style: { top: curveEventPointTop(tick, spark, plotTimeline, axisMax) },
          'aria-hidden': 'true',
        }))),
      )
    }
    // Dense real sessions can contain a short burst of samples for every
    // stream chunk. Keep the payload and its peak facts intact, but give the
    // SVG a quieter display path so the visual rhythm stays close to the
    // Native Breath reference instead of becoming a barcode of raw jitter.
    const CURVE_DISPLAY_SAMPLE_LIMIT = 72
    const curveDisplaySamples = (samples) => {
      if (samples.length <= CURVE_DISPLAY_SAMPLE_LIMIT) {
        return { samples, displayMode: 'raw' }
      }
      const alpha = 0.22
      let ema = samples[0].rate
      const smoothed = samples.map((sample, index) => {
        if (index > 0) ema = alpha * sample.rate + (1 - alpha) * ema
        return { ...sample, rate: ema }
      })
      const stride = Math.max(1, Math.ceil((smoothed.length - 1) / (CURVE_DISPLAY_SAMPLE_LIMIT - 1)))
      const display = smoothed.filter((_sample, index) => index === 0 || index === smoothed.length - 1 || index % stride === 0)
      return { samples: display, displayMode: 'smoothed' }
    }

    const buildBreathCurvePath = (spark, plotTimeline) => {
      const w = 560, hh = 160, pad = 4
      const rawSamples = spark
        .map((point) => ({ time: Number(point.tMs), rate: Number(point.rateTokS) }))
        .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.rate))
        .sort((a, b) => a.time - b.time)
      const samples = []
      for (const sample of rawSamples) {
        const previous = samples[samples.length - 1]
        if (previous && previous.time === sample.time) previous.rate = sample.rate
        else samples.push({ ...sample })
      }
      if (samples.length === 0) {
        return { line: '', w, hh, rawSampleCount: 0, renderSampleCount: 0, displayMode: 'raw' }
      }

      const rates = samples.map((sample) => sample.rate)
      const minR = Math.min(...rates)
      const maxR = Math.max(...rates)
      const display = curveDisplaySamples(samples)
      const sortedRates = [...rates].sort((a, b) => a - b)
      const displayRate = sortedRates.length > 8
        ? sortedRates[Math.max(0, Math.ceil(sortedRates.length * 0.95) - 1)]
        : maxR
      // Keep the chart readable like the reference board. Raw peaks remain
      // in the projection and are disclosed beside the chart; they should not
      // flatten the normal operating range into a near-zero line.
      // B6（深度审查）：移除 160 硬顶——轴容纳真峰值（×1.1），主体仍用 95 分位防离群压扁。
      const peakRate = Math.max(maxR, displayRate)
      const axisMax = Math.max(20, Math.ceil((Math.max(1, peakRate) * 1.1) / 20) * 20)
      const plotMin = 0
      const plotSpan = axisMax
       const minT = plotTimeline?.plotMin ?? plotTimeline?.min ?? samples[0].time
       const maxT = plotTimeline?.plotMax ?? plotTimeline?.max ?? samples[samples.length - 1].time
       const spanT = Math.max(1, plotTimeline?.plotSpan ?? plotTimeline?.span ?? maxT - minT)
       const mapPlotTime = typeof plotTimeline?.mapTime === 'function' ? plotTimeline.mapTime : (time) => time
      const pts = display.samples.map((sample) => {
         const normalized = Math.max(0, Math.min(1, (sample.rate - plotMin) / plotSpan))
         const timePosition = Math.max(0, Math.min(1, (mapPlotTime(sample.time) - minT) / spanT))
         return [pad + timePosition * (w - 2 * pad), hh - pad - normalized * (hh - 2 * pad)]
      })
      if (pts.length === 1) {
        const line = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
        const baseline = hh - pad
        const area = `${line} L${pts[0][0].toFixed(1)} ${baseline.toFixed(1)} Z`
        return {
          line,
          area,
          w,
          hh,
          minRate: minR,
          maxRate: maxR,
          axisMax,
          clipped: maxR > axisMax,
          rawSampleCount: samples.length,
          renderSampleCount: display.samples.length,
          displayMode: display.displayMode,
        }
      }

      // Fritsch-Carlson-style monotone tangents keep the curve inside the
      // measured envelope even when the time buckets are highly uneven.
      // The previous Catmull-Rom controls could leave the SVG plot and create
      // a visible hook at sharp tool/model transitions.
      const distances = []
      const secants = []
      for (let i = 0; i < pts.length - 1; i += 1) {
        const distance = Math.max(0.0001, pts[i + 1][0] - pts[i][0])
        distances.push(distance)
        secants.push((pts[i + 1][1] - pts[i][1]) / distance)
      }
      const tangents = new Array(pts.length).fill(0)
      if (secants.length === 1) {
        tangents[0] = secants[0]
        tangents[1] = secants[0]
      } else {
        const endpointTangent = (h0, h1, d0, d1) => {
          const candidate = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1)
          if (candidate * d0 <= 0) return 0
          if (d0 * d1 <= 0 && Math.abs(candidate) > Math.abs(3 * d0)) return 3 * d0
          return candidate
        }
        tangents[0] = endpointTangent(distances[0], distances[1], secants[0], secants[1])
        tangents[tangents.length - 1] = endpointTangent(
          distances[distances.length - 1],
          distances[distances.length - 2],
          secants[secants.length - 1],
          secants[secants.length - 2],
        )
        for (let i = 1; i < tangents.length - 1; i += 1) {
          const previous = secants[i - 1]
          const next = secants[i]
          if (previous * next <= 0) continue
          const leftWeight = 2 * distances[i] + distances[i - 1]
          const rightWeight = distances[i] + 2 * distances[i - 1]
          tangents[i] = (leftWeight + rightWeight) / (leftWeight / previous + rightWeight / next)
        }
      }

      const clampY = (value) => Math.max(pad, Math.min(hh - pad, value))
      const commands = [`M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`]
      for (let i = 0; i < pts.length - 1; i += 1) {
        const p1 = pts[i]
        const p2 = pts[i + 1]
        const dx = p2[0] - p1[0]
        const c1 = [p1[0] + dx / 3, clampY(p1[1] + tangents[i] * dx / 3)]
        const c2 = [p2[0] - dx / 3, clampY(p2[1] - tangents[i + 1] * dx / 3)]
        commands.push(`C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`)
      }
      const line = commands.join(' ')
      const baseline = hh - pad
      const first = pts[0]
      const last = pts[pts.length - 1]
      const area = `${line} L${last[0].toFixed(1)} ${baseline.toFixed(1)} L${first[0].toFixed(1)} ${baseline.toFixed(1)} Z`
      return {
        line,
        area,
        w,
        hh,
        minRate: minR,
        maxRate: maxR,
        axisMax,
        clipped: maxR > axisMax,
        rawSampleCount: samples.length,
        renderSampleCount: display.samples.length,
        displayMode: display.displayMode,
      }
    }

    const trajectoryTimeline = (trajectory) => {
      const start = Number(trajectory?.startMs)
      const end = Number(trajectory?.endMs)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
      return { start, end, span: Math.max(1, end - start) }
    }
    const TRAJECTORY_MERGE_GAP_MS = 1000
    const TRAJECTORY_LONG_GAP_MS = 30000
    const TRAJECTORY_COMPRESSED_GAP_MS = 3000
    const trajectoryActivityIntervals = (trajectory) => {
      const source = Array.isArray(trajectory?.segments) ? trajectory.segments : []
      const intervals = []
      for (const segment of source
        .filter((item) => ['model', 'tool'].includes(item?.kind))
        .map((item) => ({ start: Number(item.startMs), end: Number(item.endMs) }))
        .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
        .sort((a, b) => a.start - b.start)) {
        const previous = intervals[intervals.length - 1]
        if (!previous || segment.start - previous.end > TRAJECTORY_MERGE_GAP_MS) intervals.push({ ...segment })
        else previous.end = Math.max(previous.end, segment.end)
      }
      return intervals
    }
    const trajectoryPlotTimeline = (trajectory) => {
      const raw = trajectoryTimeline(trajectory)
      if (!raw) return undefined
      const intervals = trajectoryActivityIntervals(trajectory)
      if (intervals.length === 0) {
        return {
          ...raw,
          plotMin: 0,
          plotMax: raw.span,
          plotSpan: raw.span,
          mode: 'wall-clock',
          gapCount: 0,
          activeSpanMs: 0,
          mapTime: (time) => Math.max(0, Math.min(raw.span, Number(time) - raw.start)),
        }
      }
      const ranges = []
      let rawCursor = raw.start
      let plotCursor = 0
      let longGapCount = 0
      let activeSpanMs = 0
      const addRange = (rawStart, rawEnd, plotStart, plotEnd, kind) => {
        if (rawEnd > rawStart && plotEnd > plotStart) ranges.push({ rawStart, rawEnd, plotStart, plotEnd, kind })
      }
      for (const interval of intervals) {
        const gap = Math.max(0, interval.start - rawCursor)
        if (gap > 0) {
          const plotGap = gap > TRAJECTORY_LONG_GAP_MS ? TRAJECTORY_COMPRESSED_GAP_MS : gap
          if (gap > TRAJECTORY_LONG_GAP_MS) longGapCount += 1
          addRange(rawCursor, interval.start, plotCursor, plotCursor + plotGap, 'gap')
          plotCursor += plotGap
        }
        const active = interval.end - interval.start
        addRange(interval.start, interval.end, plotCursor, plotCursor + active, 'active')
        plotCursor += active
        activeSpanMs += active
        rawCursor = interval.end
      }
      const trailingGap = Math.max(0, raw.end - rawCursor)
      if (trailingGap > 0) {
        const plotGap = trailingGap > TRAJECTORY_LONG_GAP_MS ? TRAJECTORY_COMPRESSED_GAP_MS : trailingGap
        if (trailingGap > TRAJECTORY_LONG_GAP_MS) longGapCount += 1
        addRange(rawCursor, raw.end, plotCursor, plotCursor + plotGap, 'gap')
        plotCursor += plotGap
      }
      const plotSpan = Math.max(1, plotCursor)
      const mapTime = (time) => {
        const numeric = Number(time)
        if (!Number.isFinite(numeric)) return 0
        if (numeric <= ranges[0].rawStart) return ranges[0].plotStart
        for (const range of ranges) {
          if (numeric <= range.rawEnd) {
            const ratio = (numeric - range.rawStart) / Math.max(1, range.rawEnd - range.rawStart)
            return range.plotStart + ratio * (range.plotEnd - range.plotStart)
          }
        }
        return ranges[ranges.length - 1].plotEnd
      }
      return {
        ...raw,
        plotMin: 0,
        plotMax: plotSpan,
        plotSpan,
        mode: longGapCount > 0 ? 'active-compressed' : 'wall-clock',
        gapCount: longGapCount,
        activeSpanMs,
        mapTime,
      }
    }
    const trajectoryPlotPosition = (time, timeline) => {
      if (!timeline || typeof timeline.mapTime !== 'function') return 0
      return Math.max(0, Math.min(100, ((timeline.mapTime(time) - timeline.plotMin) / Math.max(1, timeline.plotSpan)) * 100))
    }
    const trajectoryTickPosition = (tick, trajectory, plotTimeline = trajectoryPlotTimeline(trajectory)) => {
      const timeline = plotTimeline
      const time = Number(tick?.tMs)
      if (!timeline || !Number.isFinite(time)) return '0%'
      return `${trajectoryPlotPosition(time, timeline)}%`
    }
    const trajectoryStateLabel = (view) => {
      if (view?.live) return '实时会话'
      const status = view?.last?.status
      if (status === 'completed') return '已完成会话'
      if (status === 'interrupted') return '已中断会话'
      if (status === 'aborted') return '已终止会话'
      if (status === 'error') return '异常会话'
      return '会话快照'
    }
    const trajectorySourceLabel = (data, trajectory, spark, view) => {
      const source = data?.stale || data?.source === 'persisted'
        ? '快照'
        : data?.source === 'real' ? trajectoryStateLabel(view) : trajectory ? '会话轨迹' : '当前 Turn'
      const points = Array.isArray(spark) ? spark.length : 0
      const segments = Array.isArray(trajectory?.segments) ? trajectory.segments.length : 0
      return trajectory ? `${source} · ${points} 点 · ${segments} 段` : `${source} · ${points} 点`
    }
    const TRAJECTORY_DISPLAY_BUCKETS = 24
    const compressTrajectoryItems = (items, plotTimeline, pointMode = false) => {
      const safeItems = Array.isArray(items)
        ? items
          .map((item) => pointMode
            ? { ...item, tMs: Number(item?.tMs) }
            : { ...item, startMs: Number(item?.startMs), endMs: Number(item?.endMs) })
          .filter((item) => pointMode
            ? Number.isFinite(item.tMs)
            : Number.isFinite(item.startMs) && Number.isFinite(item.endMs) && item.endMs >= item.startMs)
          .sort((a, b) => Number(pointMode ? a.tMs : a.startMs) - Number(pointMode ? b.tMs : b.startMs))
        : []
      if (safeItems.length <= TRAJECTORY_DISPLAY_BUCKETS) return safeItems

      // The complete event counts stay in the semantic contract. Only the
      // painted layer is bucketed so a real long session reads like the
      // reference strip instead of a barcode of 100+ individual tool calls.
      const buckets = new Map()
      for (const item of safeItems) {
        const start = Number(pointMode ? item.tMs : item.startMs)
        const position = trajectoryPlotPosition(start, plotTimeline)
        const bucket = Math.min(
          TRAJECTORY_DISPLAY_BUCKETS - 1,
          Math.max(0, Math.floor((position / 100) * TRAJECTORY_DISPLAY_BUCKETS)),
        )
        const previous = buckets.get(bucket)
        if (!previous) {
          buckets.set(bucket, { ...item, count: 1 })
          continue
        }
        previous.count += 1
        if (pointMode) {
          previous.tMs = Math.min(previous.tMs, item.tMs)
        } else {
          previous.startMs = Math.min(previous.startMs, item.startMs)
          previous.endMs = Math.max(previous.endMs, item.endMs)
        }
      }
      return [...buckets.values()].sort((a, b) => Number(pointMode ? a.tMs : a.startMs) - Number(pointMode ? b.tMs : b.startMs))
    }


    const trajectoryNow = (view, plotTimeline, spark) => {
      if (!plotTimeline) return null
      if (view?.live) {
        const liveTime = Number(view.live.tMs)
        const elapsed = Number(view.live.elapsedMs)
        const lastSample = Array.isArray(spark) && spark.length > 0 ? Number(spark[spark.length - 1]?.tMs) : undefined
        const time = Number.isFinite(liveTime)
          ? liveTime
          : Number.isFinite(elapsed) ? plotTimeline.start + elapsed : lastSample
        return { state: 'live', label: 'Now', position: Number.isFinite(time) ? trajectoryPlotPosition(time, plotTimeline) : 100 }
      }
      const status = view?.last?.status
      if (['completed', 'interrupted', 'aborted', 'error', 'max-tokens'].includes(status)) return { state: 'complete', label: 'End', position: 100 }
      return null
    }
    const TrajectoryStrip = ({ data, trajectory, spark, view }) => {
      const plotTimeline = trajectoryPlotTimeline(trajectory)
      const now = trajectoryNow(view, plotTimeline, spark)
      const segments = Array.isArray(trajectory?.segments)
        ? trajectory.segments.filter((segment) => ['model', 'tool'].includes(segment?.kind))
        : []
      const inputTicks = Array.isArray(trajectory?.inputTicks)
        ? trajectory.inputTicks.filter((tick) => tick?.kind === 'input' && Number.isFinite(Number(tick?.tMs)))
        : []
      const kinds = ['input', 'model', 'tool']
      const realCounts = {
        input: inputTicks.length,
        model: segments.filter((segment) => segment.kind === 'model').length,
        tool: segments.filter((segment) => segment.kind === 'tool').length,
      }
      const kindLabel = (kind) => (kind === 'input' ? '输入' : kind === 'model' ? '模型' : '工具')
      const displayItems = (kind) => compressTrajectoryItems(
        kind === 'input' ? inputTicks : segments.filter((segment) => segment.kind === kind),
        plotTimeline,
        kind === 'input',
      )
      const summary = kinds.map((kind) => `${kindLabel(kind)} ${realCounts[kind]} ${kind === 'input' ? '个' : '段'}`).join('、')
      const displayTotal = kinds.reduce((total, kind) => total + displayItems(kind).length, 0)
      const ticks = plotTimeline ? curveTimeTicks(plotTimeline) : []
      return h('section', {
        className: 'jx-trajectory-strip jx-trajectory-strip--compact',
        'aria-label': `Trajectory Strip，会话轨迹迷你时间轴；${summary}`,
        ...(plotTimeline ? {
          'data-plot-start-ms': plotTimeline.start,
          'data-plot-end-ms': plotTimeline.end,
          'data-plot-time-mode': plotTimeline.mode,
          'data-plot-gap-count': plotTimeline.gapCount,
        } : {}),
        ...(now ? { 'data-now-state': now.state, 'data-now-position': now.position } : {}),
      },
        h('span', { key: 'meta', className: 'jx-trajectory-strip__meta' }, trajectorySourceLabel(data, trajectory, spark, view)),
        trajectory
          ? h('span', {
            key: 'track',
            className: 'jx-trajectory-strip__track',
            'aria-label': `真实数据：${summary}；当前显示 ${displayTotal} 个节奏标记`,
          },
            [
              ...kinds.flatMap((kind) => displayItems(kind).map((item, index) => {
                const isPoint = kind === 'input'
                const startMs = Number(isPoint ? item.tMs : item.startMs)
                const endMs = Number(isPoint ? item.tMs : item.endMs)
                const markerWidth = isPoint
                  ? Math.max(2.5, Math.min(6, 100 / Math.max(1, displayItems(kind).length) * 1.2))
                  : Math.max(.8, trajectoryPlotPosition(endMs, plotTimeline) - trajectoryPlotPosition(startMs, plotTimeline))
                return h('i', {
                  key: `${kind}-${startMs}-${index}`,
                  className: 'jx-trajectory-strip__marker',
                  'data-kind': kind,
                  'data-role': isPoint ? 'point' : 'segment',
                  'data-start-ms': startMs,
                  'data-end-ms': endMs,
                  'data-count': item.count ?? 1,
                  style: {
                    left: `${Math.min(isPoint ? 100 - markerWidth : 100, trajectoryPlotPosition(startMs, plotTimeline))}%`,
                    '--jx-segment-width': `${markerWidth}%`,
                  },
                })
              })),
              now ? h('i', {
                key: 'now',
                className: 'jx-trajectory-now',
                'data-state': now.state,
                'aria-hidden': 'true',
                style: { left: `${now.position}%` },
              }) : null,
            ],
          )
          : h('span', { key: 'empty', className: 'jx-trajectory-empty', role: 'status' },
            h('strong', null, '暂无会话轨迹'),
            h('p', null, '开始一次 AI 调用后，这里会出现 Input、Model、Tools 迷你时间轴。'),
          ),
        h('span', { key: 'ticks', className: 'jx-trajectory-strip__ticks', 'aria-hidden': 'true' },
          ticks.map((tick, index) => h('span', {
            key: `trajectory-time-${index}`,
            className: 'jx-trajectory-strip__tick',
            'data-edge': index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : undefined,
            style: { left: `${tick.position}%` },
          }, tick.label)),
        ),
      )
    }


    const fmtChartElapsed = (ms) => {
      if (!Number.isFinite(Number(ms))) return '—'
      const seconds = Math.max(0, Math.round(Number(ms) / 1000))
       if (seconds < 60) return `${seconds}s`
       if (seconds >= 600) return `${Math.round(seconds / 60)}m`
       if (seconds % 60 === 0) return `${seconds}s`
      return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
    }
    const curveTimeTicks = (plotTimeline) => {
      if (!plotTimeline || !Number.isFinite(plotTimeline.start) || !Number.isFinite(plotTimeline.span)) return []
      const seconds = Math.max(0, plotTimeline.span / 1000)
      const elapsedValues = seconds < 60
        ? [0, 0.25, 0.5, 0.75, 1].map((ratio) => seconds * ratio)
        : (() => {
          const step = Math.max(60, Math.ceil((seconds / 7) / 60) * 60)
          const values = [0]
          for (let value = step; value < seconds && values.length < 8; value += step) values.push(value)
          if (values[values.length - 1] !== seconds) values.push(seconds)
          return values.slice(0, 8)
        })()
      const candidates = elapsedValues.map((elapsed) => {
        const rawTime = plotTimeline.start + plotTimeline.span * (elapsed / Math.max(0.001, seconds))
        return {
          label: fmtChartElapsed(rawTime - plotTimeline.start),
          position: trajectoryPlotPosition(rawTime, plotTimeline),
        }
      })
      // Long sessions may be drawn with compressed idle gaps. Several wall
      // clock ticks can then land on the same few active pixels. Keep the
      // endpoint facts, but drop labels that cannot be read at this scale.
      const minimumGap = seconds >= 60 ? 8 : 0
      const visible = []
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]
        const isLast = index === candidates.length - 1
        if (visible.length === 0) {
          visible.push(candidate)
          continue
        }
        let gap = candidate.position - visible[visible.length - 1].position
        if (isLast && gap < minimumGap) {
          while (visible.length > 1 && gap < minimumGap) {
            visible.pop()
            gap = candidate.position - visible[visible.length - 1].position
          }
        }
        if (gap >= minimumGap || isLast) visible.push(candidate)
      }
      return visible
    }
    const curveRateTicks = (axisMax) => {
      if (!Number.isFinite(Number(axisMax))) return []
      const max = Math.max(40, Math.ceil(Number(axisMax) / 40) * 40)
      const step = max / 4
      return [0, 1, 2, 3, 4].map((index) => Math.round(max - step * index))
    }
    const curveCursor = (view, plotTimeline, spark) => {
      if (!plotTimeline) return null
      if (view?.live) {
        const lastSample = Array.isArray(spark) && spark.length > 0 ? Number(spark[spark.length - 1]?.tMs) : undefined
        return { state: 'live', label: 'Now', position: Number.isFinite(lastSample) ? trajectoryPlotPosition(lastSample, plotTimeline) : 100 }
      }
      const status = view?.last?.status
      if (['completed', 'interrupted', 'aborted', 'error', 'max-tokens'].includes(status)) {
        return { state: 'complete', label: '结束', position: 100 }
      }
      return null
    }
    const CurveLegend = ({ eventTicks, scope = 'turn' }) => {
      const safeTicks = Array.isArray(eventTicks) ? eventTicks : []
      const toolCount = safeTicks.filter((tick) => tick?.kind === 'tool').length
      const issueCount = safeTicks.filter((tick) => ['retry', 'compaction'].includes(tick?.kind)).length
      // V5.8 四色图例恒显：无事件显示 0（luna 复审 P1）
      // B8（v2.1）：Cache 命中率全页唯一在头部——图例只保留实际编码（速度/工具/异常）
      const sessionScoped = scope === 'session'
      const items = [
        { kind: 'rate', label: '速度 (tok/s)' },
        { kind: 'tool', label: sessionScoped ? `会话工具事件 ${toolCount}` : `工具调用 ${toolCount}` },
        { kind: 'issue', label: sessionScoped ? `会话异常 / 重试 ${issueCount}` : `异常 / 重试 ${issueCount}` },
      ]
      return h('div', { className: 'jx-curve-legend', 'aria-label': '图例' },
        items.map((item) => h('span', { key: item.kind, className: 'jx-curve-legend__item', 'data-kind': item.kind }, [
          h('i', { key: 'swatch', className: 'jx-curve-legend__swatch', 'aria-hidden': 'true' }),
          h('span', { key: 'label' }, item.label),
        ])),
      )
    }


    const eventRailCopy = (view) => {
      if (view?.live) return { state: 'working', label: '进行中', detail: `Step ${view.live.openStep || 1}` }
      if (view?.kind === 'idle' && !view?.last) return { state: 'idle', label: '等待会话', detail: '等待下一轮 Turn' }
      const status = view?.last?.status
      if (status === 'completed') return { state: 'complete', label: '完成', detail: `Turn #${view.last.turn}` }
      if (status === 'interrupted') return { state: 'error', label: '已中断', detail: '保留本轮异常状态' }
      if (status === 'aborted') return { state: 'error', label: '已终止', detail: '保留本轮结束状态' }
      if (status === 'error') return { state: 'error', label: '异常', detail: '请查看当前会话' }
      if (status === 'max-tokens') return { state: 'error', label: 'Token 上限', detail: '本轮达到 Token 上限' }
      if (status) return { state: 'complete', label: '已结束', detail: `Turn #${view.last.turn}` }
      return { state: 'idle', label: '等待下一轮 Turn', detail: '完成一次调用后显示事件' }
    }
    // V5.6 P0 降级（P1 契约 §决策11）：宿主无 agent/start/result 事件，
    // 工具事件 tick 来自 fold 的真实 tool/call 而**非子代理**——附 provenance 注记，
    // 绝不伪装「子代理/Luna/模型」字样。
    const toolEventProvenance = (view) => {
      const turn = view?.live && typeof view.live === 'object' ? view.live : view?.last
      const generic = genericActivityCounts(turn?.activitySummary)
      if (generic && generic.tool > 0) return `工具调用 ${generic.tool} 次（非子代理）`
      const ticks = Array.isArray(turn?.eventTicks)
        ? turn.eventTicks.filter((tick) => tick?.kind === 'tool')
        : []
      const segments = Array.isArray(turn?.segments)
        ? turn.segments.filter((segment) => segment?.kind === 'tool')
        : []
      // tick 与 segment 是同一工具调用的两种投影，缺少 generic 时只选
      // 一个有证据的来源，不能相加后把一轮调用显示成两次。
      const count = ticks.length > 0 ? ticks.length : segments.length
      if (count === 0) return undefined
      return `工具事件 ${count} 次（由调用推断，非子代理）`
    }
    // V5.6 S2（sol 裁决）：子代理分支渲染位——宿主 agent/start/result 事件到达前
    // 平台态显示「暂无子代理调用」。真实 agent 事件由 P1 契约（stage-p1）驱动，
    // 未实现前绝不把工具事件推断为子代理（provenance 分离）。
    // V5.8 P2.3（claude 裁决 stage0 §一.1）：agents 结构收窄为
    // {id,parentId,label,status(5态),durationMs,model,reasoningEffort,toolCalls,rate}；
    // 保留 agents 级时间戳由 P2.2 时间轴回溯消费（此处渲染层不读取）。
    // 字段缺省一律「未上报」——不推断、不伪造。
    const SUBAGENT_STATUS_COPY = {
      queued: { label: '等待', state: 'queued' },
      running: { label: '运行中', state: 'running' },
      completed: { label: '完成', state: 'completed' },
      failed: { label: '失败', state: 'failed' },
      cancelled: { label: '已取消', state: 'cancelled' },
    }
    // 兼容旧服务端取值（ok/error/done）与「5 态」收窄前的历史负载
    const SUBAGENT_STATUS_LEGACY = {
      ok: { label: '完成', state: 'completed' },
      done: { label: '完成', state: 'completed' },
      error: { label: '失败', state: 'failed' },
    }
    const subagentStatus = (status) => SUBAGENT_STATUS_COPY[status] || SUBAGENT_STATUS_LEGACY[status] || { label: '状态未知', state: 'unknown' }
    // 速率质量：rate.quality 4 态（exact/estimated/historical/unavailable）；未上报显示「—」
    const subagentRate = (rate) => {
      if (!rate || typeof rate !== 'object') return '—'
      const value = rate.value
      const quality = rate.quality
      const hasValue = value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))
      if (!hasValue) return quality ? String(quality) : '—'
      const rounded = Math.round(Number(value))
      if (quality) return `${rounded} tok/s · ${quality}`
      return `${rounded} tok/s`
    }
    const subagentHasCount = (value) => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))
    const subagentMeta = (agent) => [
      { key: 'model', label: `模型 ${agent.model || '未上报'}` },
      { key: 'effort', label: agent.reasoningEffort ? `推理 ${agent.reasoningEffort}` : '推理 未上报' },
      { key: 'tools', label: `工具 ${subagentHasCount(agent.toolCalls) ? `${agent.toolCalls} 次` : '未上报'}` },
      { key: 'rate', label: `速率 ${subagentRate(agent.rate)}` },
    ]
    const SubagentDock = ({ view }) => {
      // V5.9 ②：live 进行中的子代理从 view.liveSubagents 读取（fold 双通道），结算后由 last.subagents 承载。
      const agents = Array.isArray(view?.liveSubagents) && view.liveSubagents.length > 0
        ? view.liveSubagents
        : Array.isArray(view?.last?.subagents) && view.last.subagents.length > 0 ? view.last.subagents : []
      if (agents.length > 0) {
        // 两层展开：parentId 分组，depth=1 为顶层，depth=2 为其子级；
        // depth≥3 的节点不逐个渲染，合并计数为「另有 N 个下级调用」。
        const byParent = new Map()
        for (const agent of agents) {
          const parentId = agent.parentId === undefined || agent.parentId === null || agent.parentId === '' ? null : String(agent.parentId)
          const bucket = byParent.get(parentId) ?? []
          bucket.push(agent)
          byParent.set(parentId, bucket)
        }
        const roots = byParent.get(null) ?? []
        const allIds = new Set(agents.map((agent) => String(agent.id)))
        // 孤儿节点（parentId 指向不存在的父 agent）也按顶层渲染，避免静默丢失真实上报；
        // 父存在（即使不在顶层）则不算孤儿，仍按正常层级挂在父下。
        for (const [parentId, bucket] of byParent) {
          if (parentId !== null && !allIds.has(parentId)) roots.push(...bucket)
        }
        const depth2 = (parentId) => byParent.get(parentId) ?? []
        // claude 裁决 §三.5：合并计数 N = 深度 >2 的节点总数
        const subtreeNodes = (id) => {
          const children = byParent.get(id) ?? []
          return 1 + children.reduce((sum, c) => sum + subtreeNodes(String(c.id)), 0)
        }
        const deeperCount = (parentId) => {
          const children = byParent.get(parentId) ?? []
          return children.reduce((sum, c) => sum + subtreeNodes(String(c.id)), 0)
        }
        const metaRow = (agent) => h('div', { className: 'jx-subagent-dock__meta', 'aria-label': '子代理详情' }, [
          h('span', { key: 'duration', className: 'jx-subagent-dock__meta-item' }, `时长 ${fmtDur(agent.durationMs)}`),
          ...subagentMeta(agent).map((item) => h('span', { key: item.key, className: 'jx-subagent-dock__meta-item' }, item.label)),
        ])
        const statusCell = (agent) => {
          const present = subagentStatus(agent.status)
          return h('span', { className: 'jx-subagent-dock__status', 'data-status': present.state }, present.label)
        }
        const card = (agent) => [
          h('div', { key: 'row', className: 'jx-subagent-dock__row' },
            h('span', { className: 'jx-subagent-dock__name' }, agent.label || agent.name || '未命名'),
            statusCell(agent)),
          metaRow(agent),
        ]
        const itemNodes = []
        for (const root of roots) {
          itemNodes.push(h('li', { key: root.id, className: 'jx-subagent-dock__item', 'data-depth': '1', 'data-status': subagentStatus(root.status).state },
            card(root)))
          const children = depth2(String(root.id))
          for (const child of children) {
            itemNodes.push(h('li', { key: child.id, className: 'jx-subagent-dock__item', 'data-depth': '2', 'data-status': subagentStatus(child.status).state },
              card(child)))
            const deeper = deeperCount(String(child.id))
            if (deeper > 0) {
              itemNodes.push(h('li', { key: `${child.id}-deeper`, className: 'jx-subagent-dock__item', 'data-depth': '3', 'data-merged': String(deeper) },
                h('span', { className: 'jx-subagent-dock__merged' }, `另有 ${deeper} 个下级调用`)))
            }
          }
        }
        return h('section', { className: 'jx-subagent-dock', 'aria-label': '子代理调用', 'data-state': 'populated' },
          h('span', { className: 'jx-subagent-dock__label' }, `子代理 ${agents.length} 个`),
          h('ul', { className: 'jx-subagent-dock__list' }, itemNodes),
        )
      }
      return h('section', { className: 'jx-subagent-dock', 'aria-label': '子代理调用', 'data-state': 'empty' },
        h('span', { className: 'jx-subagent-dock__label' }, '子代理调用'),
        h('span', { className: 'jx-subagent-dock__empty' }, '暂无子代理调用'),
      )
    }

    // V5.8 设计稿 ④：进度与流程卡——总体进度条 + 6 阶段主线（启动→加载→运行中→工具调用→输出→完成）
    const PROGRESS_STAGES = Object.freeze([
      { key: 'launch', label: '启动' },
      { key: 'load', label: '加载' },
      { key: 'running', label: '运行中' },
      { key: 'tool', label: '工具调用' },
      { key: 'output', label: '输出' },
      { key: 'done', label: '完成' },
    ])
    const progressStageState = ({ status, live, eventTicks }) => {
      if (live) {
        const hasToolTick = Array.isArray(eventTicks) && eventTicks.some((tick) => tick && tick.kind === 'tool')
        return PROGRESS_STAGES.map((stage) => {
          if (stage.key === 'launch' || stage.key === 'load') return { ...stage, state: 'done' }
          if (stage.key === 'running') return { ...stage, state: 'running' }
          if (stage.key === 'tool') return { ...stage, state: hasToolTick ? 'running' : 'pending' }
          return { ...stage, state: 'pending' }
        })
      }
      const finished = status === 'completed' || status === 'interrupted' || status === 'aborted' || status === 'error'
      return PROGRESS_STAGES.map((stage) => {
        if (stage.key === 'done') return { ...stage, state: finished ? 'done' : 'pending' }
        if (finished) return { ...stage, state: 'done' }
        if (stage.key === 'running') return { ...stage, state: 'running' }
        return { ...stage, state: 'pending' }
      })
    }
    const BreathProgressCard = ({ sessionSummary, view }) => {
      const last = view && view.last ? view.last : undefined
      const status = last ? last.status : undefined
      const live = Boolean(view && view.live)
      const eventTicks = Array.isArray(last && last.eventTicks) ? last.eventTicks : []
      const roundsTotal = sessionSummary && Number.isFinite(Number(sessionSummary.rounds)) ? Number(sessionSummary.rounds) : undefined
      // 假进度修复（深度审查 P0-2）：真实完成度未采集——roundsDone 不再等于 roundsTotal
      //（那会永远 100% 欺骗读屏器）。无真实进度来源时：live 显示「进行中」、否则显示「已见 N 轮」，
      // 不画 pct 进度条（诚实披露）。
      const roundsDone = undefined
      const pct = undefined
      const subagents = Array.isArray(last && last.subagents) ? last.subagents : []
      const runningCount = subagents.filter((a) => a.status === 'running').length
      const doneCount = subagents.filter((a) => a.status === 'completed' || a.status === 'ok' || a.status === 'done').length
      return h('section', { className: 'jx-progress-card', 'aria-label': '进度与流程' },
        h('div', { className: 'jx-progress-card__summary' },
          h('span', { className: 'jx-progress-card__text' }, roundsTotal !== undefined ? (live ? '进行中 · 已见 ' + roundsTotal + ' 轮' : '已见 ' + roundsTotal + ' 轮') : '暂无轮次数据'),
          h('div', { className: 'jx-progress-card__bar', role: 'progressbar', 'aria-valuenow': String(pct ?? 0), 'aria-valuemin': '0', 'aria-valuemax': '100' },
            h('i', { className: 'jx-progress-card__fill', style: pct !== undefined ? { width: pct + '%' } : undefined }),
          ),
          h('span', { className: 'jx-progress-card__pct' }, pct !== undefined ? pct + '%' : (live ? '进行中' : '—')),
        ),
        // B10 修复（Tab 方案）：进度卡内只留计数——详情由独立 SubagentDock 承载，消除双渲染。
        h('div', { className: 'jx-progress-card__subagents' },
          h('span', { className: 'jx-progress-card__subagents-label' }, '子代理调用'),
          h('span', { className: 'jx-progress-card__subagents-summary' },
            subagents.length > 0 ? '共 ' + subagents.length + ' 个' : '暂无'),
        ),
      )
    }

    const EventRail = ({ view, freshness, extra }) => {
      const item = eventRailCopy(view)
      const provenance = toolEventProvenance(view)
      const detail = [item.detail, freshness, provenance, extra].filter(Boolean).join(' · ')
      return h('section', { className: 'jx-event-rail', 'aria-label': 'Event Rail', 'data-state': item.state, role: 'status' },
        h('span', { className: 'jx-event-rail__marker', 'aria-hidden': 'true' }),
        h('strong', { className: 'jx-event-rail__label' }, item.label),
        h('span', { className: 'jx-event-rail__detail', 'data-freshness': freshness ? 'stale' : undefined }, detail),
      )
    }

    const threadStatusCopy = (view) => {
      if (view?.live) return '线程状态：生成中'
      const status = view?.last?.status
      if (status === 'completed') return '线程状态：已完成'
      if (status === 'interrupted') return '线程状态：已中断'
      if (status === 'aborted') return '线程状态：已终止'
      if (status === 'error') return '线程状态：异常'
      if (status === 'max-tokens') return '线程状态：已达到 Token 上限'
      return '线程状态：等待下一轮'
    }
    const threadStatusState = (view) => {
      if (view?.live) return 'active'
      const status = view?.last?.status
      if (status === 'completed') return 'stable'
      if (isFailedTurnStatus(status)) return 'failed'
      return 'idle'
    }
    // ── 速率事实五档映射（V5.6 契约，与 telemetry-fold 服务端 view 对齐）──
    //   live.rateQuality==='exact'     && estimateRateTokS 有值 → { label:'实时', state:'live' }
    //   live.rateQuality==='estimated' && estimateRateTokS 有值 → { label:'估算', state:'live' }
    //   无 live 且 last.rateQuality==='historical' && last.avgTps   → { label:'最近', state:'settled' }
    //   sessionSummary.rateQuality==='session' && avgTps            → { label:'平均', state:'settled' }
    //   其余（无值 / 缺 rateQuality / live 实时不可用）              → null → 渲染「等待速度数据」
    // 最近/平均绝不标「实时」：文案只由 rateQuality 档位决定，与数值来源无关。
    const ratePresentation = (view) => {
      const live = view && view.live ? view.live : undefined
      const last = view && view.last && typeof view.last === 'object' ? view.last : undefined
      const summary = view && view.sessionSummary && typeof view.sessionSummary === 'object' ? view.sessionSummary : undefined
      // P0（codex 验收）：0 不是有效速度——缺失/无数据时服务端可能给 0 或 undefined，
      // 一律按无值处理（显示「等待速度数据」），绝不显示「估算 0 tok/s」。
      const finite = (value) => Number.isFinite(Number(value)) && Number(value) > 0
      if (live && live.rateQuality === 'exact' && finite(live.estimateRateTokS)) {
        return { label: '实时', value: Math.round(Number(live.estimateRateTokS)), state: 'live' }
      }
      if (live && live.rateQuality === 'estimated' && finite(live.estimateRateTokS)) {
        return { label: '估算', value: Math.round(Number(live.estimateRateTokS)), state: 'live' }
      }
      // 只有无 live 时才允许历史档（最近/平均），避免把历史数据伪装成实时。
      if (!live && last && last.rateQuality === 'historical' && finite(last.avgTps)) {
        return { label: '最近', value: Math.round(Number(last.avgTps)), state: 'settled' }
      }
      if (summary && summary.rateQuality === 'session' && finite(summary.avgTps)) {
        return { label: '平均', value: Math.round(Number(summary.avgTps)), state: 'settled' }
      }
      return null
    }
    // V5.8 P2.2：无事件空态使用正式文案「当前会话暂无可绘制事件」。
    // 会话轨迹有采样但无 tool/retry/compaction 事件时，也属于无事件可绘制。
    const curveEmptyCopy = (hasTurn, trajectorySource, noEvents) => {
      if (noEvents) return { title: '当前会话暂无可绘制事件', detail: '当前会话没有工具调用、重试或压缩事件；完成一次调用后，事件会出现在这条曲线上。' }
      if (trajectorySource === 'session') return { title: '会话轨迹：速度采样不足', detail: '当前会话只有少量真实速度采样；不会混用最近 Turn 的曲线，点击刷新呼吸节奏重新抓取当前会话数据。' }
      if (hasTurn) return { title: '速度采样不足', detail: '当前 Turn 的速度采样不足；下一轮 Turn 产生更多采样后，这里会显示 BreathCurve。' }
      return { title: '等待下一轮 Turn', detail: '开始一次 AI 调用后，这里会出现你的 BreathCurve。' }
    }
    const BreathEmptyState = ({ hasTurn = false, trajectorySource = 'turn', noEvents = false, error, onRefresh }) => {
      const copy = curveEmptyCopy(hasTurn, trajectorySource, noEvents)
      return h('div', { className: 'jx-curve-empty', 'data-state': hasTurn ? 'insufficient' : 'waiting', 'aria-live': 'polite', role: 'status' },
        h('strong', null, error ? '呼吸节奏刷新失败' : copy.title),
        h('p', null, error || copy.detail),
        error && onRefresh ? h(Button, { variant: 'ghost', size: 'sm', className: 'jx-curve-empty__refresh', type: 'button', onClick: onRefresh, 'aria-label': '重试刷新呼吸节奏' }, '重试') : null,
      )
    }
    const InfoHint = ({ label = '查看指标说明' }) =>
      h('span', { className: 'jx-info-hint', title: label, 'aria-label': label }, 'i')


    const phaseStoryItems = ({ sessionSummary, status, hasTool }) => [
      { key: 'ignition', label: '启动', tone: 'blue', detail: '启动请求，建立连接，准备上下文。' },
      { key: 'acceleration', label: '加速', tone: 'purple', detail: '输入涌入，模型加速处理。' },
      { key: 'cruise', label: '巡航', tone: 'green', detail: '稳定输出，中段缓存效率最佳。' },
      { key: 'turbulence', label: '扰动', tone: 'orange', detail: hasTool && sessionSummary?.toolDurationMs ? `工具调用 ${fmtSessionDuration(sessionSummary.toolDurationMs)}，波动增大。` : '工具调用节点会在这里标记。' },
      { key: 'landing', label: '收敛', tone: 'red', detail: '收敛输出，处理尾部任务。' },
      { key: 'done', label: '完成', tone: 'blue', detail: status === 'completed' ? '任务完成，资源释放，会话结束。' : '任务结束后，这里显示完成状态。' },
    ]

    const phaseStoryActiveKey = ({ status, eventTicks, spark, live }) => {
      if (live) {
        const hasTool = Array.isArray(eventTicks) && eventTicks.some((tick) => tick?.kind === 'tool')
        if (hasTool) return 'turbulence'
        const rates = (Array.isArray(spark) ? spark : []).map((point) => Number(point?.rateTokS)).filter(Number.isFinite)
        if (rates.length >= 3) return 'cruise'
        if (rates.length >= 2) return 'acceleration'
        return 'ignition'
      }
      return undefined
    }

    const PhaseStory = ({ sessionSummary, status, eventTicks, spark, live }) => {
      const hasTool = Array.isArray(eventTicks) && eventTicks.some((tick) => tick?.kind === 'tool')
      const activeKey = phaseStoryActiveKey({ status, eventTicks, spark, live })
      const items = phaseStoryItems({ sessionSummary, status, hasTool })
      const active = items.find((item) => item.key === activeKey)
      const headline = active
        ? `${active.label}：${active.detail}`
        : isFailedTurnStatus(status)
          ? '本轮异常收束；展开查看六个阶段状态'
          : status === 'completed' ? items[items.length - 1].detail
          : '等待真实 Turn 数据'
      return h('section', { className: 'jx-phase-story jx-phase-story--compact', 'aria-label': '阶段叙事 Phase Story' },
        h('details', { className: 'jx-phase-story__fold' },
          h('summary', { className: 'jx-phase-story__summary' },
            h('span', { className: 'jx-phase-story__title' }, '阶段叙事 ', h(InfoHint, { label: '阶段叙事说明' })),
            h('span', { className: 'jx-phase-story__narrative', 'aria-label': '阶段叙事' }, headline),
            h('span', { className: 'jx-phase-story__hint' }, '由真实速度、工具节点和结束状态推导'),
          ),
          h('div', { className: 'jx-phase-story__rail' },
            items.map((item, index) => h('article', {
              key: item.key,
              className: 'jx-phase-story__card',
              'data-phase': item.key,
              'data-tone': item.tone,
              'data-state': item.key === activeKey
                ? 'active'
                : item.key === 'done' && status === 'completed'
                  ? 'complete'
                  : item.key === 'turbulence' && hasTool
                    ? 'seen'
                    : item.key === 'landing' && isFailedTurnStatus(status)
                      ? 'error'
                      : 'quiet',
            },
              h('div', { className: 'jx-phase-story__card-head' },
                h('i', { className: 'jx-phase-story__dot', 'aria-hidden': 'true' }),
                h('strong', null, item.label),
              ),
              h('p', null, item.detail),
              index < 5 ? h('span', { className: 'jx-phase-story__connector', 'aria-hidden': 'true' }) : null,
            )),
          ),
        ),
      )
    }












    // ── 中央弹窗（权威审查 P0）：三项核心事实 + 折叠区（Session Summary/最近 5/Phase Story）──
    const BreathFactItem = ({ metric, label, value, unit, meta, state, quality, icon }) =>
      h('div', {
        className: 'jx-fact',
        'data-metric': metric,
        ...(state ? { 'data-state': state } : {}),
        ...(quality ? { 'data-quality': quality } : {}),
      },
        h('div', { className: 'jx-fact__lockup' },
          icon ? h('span', { className: 'jx-fact__icon', 'aria-hidden': 'true' }, icon) : null,
          h('div', { className: 'jx-fact__copy' },
            h('span', { className: 'jx-fact__label' }, label),
            h('div', { className: 'jx-fact__value-lockup' },
              h('strong', { className: 'jx-fact__value' }, value),
              unit ? h('span', { className: 'jx-fact__unit' }, unit) : null,
            ),
            meta ? h('span', { className: 'jx-fact__meta' }, meta) : null,
          ),
        ),
      )

    const BreathSessionReadout = ({ sessionSummary }) => {
      const summary = sessionSummary || {}
      const required = [
        summary.rounds,
        summary.steps,
        summary.llmDurationMs,
        summary.toolDurationMs,
        summary.avgTtftMs,
        summary.avgTps,
        summary.cachePct,
        summary.inputTokens,
        summary.outputTokens,
      ]
      const complete = Number.isSafeInteger(Number(summary.rounds))
        && Number.isSafeInteger(Number(summary.steps))
        && required.slice(2).every((value) => Number.isFinite(Number(value)))
        && validCachePct(Number(summary.cachePct))
      if (!complete) return null
      const metrics = [
        `${fmtSessionCount(Number(summary.rounds))} 轮 · ${fmtSessionCount(Number(summary.steps))} 步`,
        `LLM ${fmtSessionDuration(Number(summary.llmDurationMs))} · 工具调用 ${fmtSessionDuration(Number(summary.toolDurationMs))}`,
        `首 token 平均 ${fmtSessionLatency(Number(summary.avgTtftMs))} · ${Math.round(Number(summary.avgTps))} tok/s`,
        `缓存命中 ${fmtCache(Number(summary.cachePct))}`,
        `输入 ${fmtSessionTok(Number(summary.inputTokens))} tok · 输出 ${fmtSessionTok(Number(summary.outputTokens))} tok`,
      ]
      return h('div', {
        className: 'jx-session-readout',
        role: 'status',
        'aria-label': '完整运行指标',
        ...(summary.curveQuality ? { 'data-curve-quality': summary.curveQuality } : {}),
      }, metrics.flatMap((metric, index) => [
        index > 0 ? h('span', { key: `separator-${index}`, className: 'jx-session-readout__separator', 'aria-hidden': 'true' }, '|') : null,
        h('span', { key: `metric-${index}`, className: 'jx-session-readout__metric' }, metric),
      ]))
    }

    const BreathSessionSummary = ({ sessionSummary, last, trajectory }) => {
      const span = trajectory && Number.isFinite(Number(trajectory.span))
        ? trajectory.span
        : trajectory && Number.isFinite(Number(trajectory.startMs)) && Number.isFinite(Number(trajectory.endMs))
          ? Number(trajectory.endMs) - Number(trajectory.startMs)
          : last && Number.isFinite(Number(last.durationMs)) ? last.durationMs : undefined
      const rows = [
        ['轮次', sessionSummary && sessionSummary.rounds !== undefined ? String(sessionSummary.rounds) : '—'],
        ['步骤', sessionSummary && sessionSummary.steps !== undefined ? String(sessionSummary.steps) : '—'],
        ['平均速度', sessionSummary && sessionSummary.avgTps !== undefined ? `${Math.round(sessionSummary.avgTps)} tok/s` : '—'],
        ['输入 Token', sessionSummary && sessionSummary.inputTokens !== undefined ? fmtTokCompact(sessionSummary.inputTokens) : '—'],
        ['输出 Token', sessionSummary && sessionSummary.outputTokens !== undefined ? fmtTokCompact(sessionSummary.outputTokens) : '—'],
        ['总时长', span !== undefined ? fmtSessionDuration(span) : '—'],
        ['LLM 时长', sessionSummary && sessionSummary.llmDurationMs !== undefined ? fmtSessionDuration(sessionSummary.llmDurationMs) : '—'],
        ['工具时长', sessionSummary && sessionSummary.toolDurationMs !== undefined ? fmtSessionDuration(sessionSummary.toolDurationMs) : '—'],
      ]
      return h('details', { className: 'jx-fold jx-fold--summary', 'aria-label': '完整会话摘要' },
        h('summary', { className: 'jx-fold__summary' },
          h('span', { className: 'jx-fold__title' }, 'Session Summary'),
          h('span', { className: 'jx-fold__hint' }, '轮次 · Token · 时长'),
        ),
        h('dl', { className: 'jx-summary-grid' },
          rows.flatMap(([label, value]) => [
            h('dt', { key: `${label}-dt` }, label),
            h('dd', { key: `${label}-dd` }, value),
          ]),
        ),
      )
    }

    const BreathSurface = () => {
      const data = useBreath()

      React.useEffect(() => { breathService.load() }, [])


      const view = data && data.view ? data.view : undefined
      const loadError = data?.error || null
      const last = view ? view.last : undefined
      const live = view ? view.live : undefined
      const autoRefreshOn = useBreathAutoRefresh()
      const liveRefreshEnabled = Boolean(live) && autoRefreshOn
      // V5.8 P3.2：页面不可见（document.hidden）时暂停 5s 轮询并停掉曲线呼吸动画
      // 类（.jx-mark 呼吸 pulse），恢复可见后重启。清理保证 unmount 时无残留。
      React.useEffect(() => {
        if (!liveRefreshEnabled) return undefined
        if (typeof window === 'undefined') return undefined
        // V5.8 倒计时驱动器：每 1s 递减；到 0 重置 5（下一轮询）；暂停（!on）时冻结。
        const tickCountdown = () => setBreathCountdown(breathCountdown <= 1 ? 5 : breathCountdown - 1)
        const countdownId = window.setInterval(tickCountdown, 1000)
        const startTimer = () => window.setInterval(() => {
          setBreathCountdown(5)
          breathService.load({ force: true })
        }, 5000)
        let timerId = startTimer()
        const hidden = () => (typeof document !== 'undefined' && document.hidden === true)
        const pause = () => {
          if (hidden() && timerId !== null) {
            window.clearInterval(timerId)
            timerId = null
          }
        }
        const resume = () => {
          if (!hidden() && timerId === null) {
            timerId = startTimer()
          }
        }
        const onVisibility = () => { if (hidden()) pause(); else resume() }
        document.addEventListener?.('visibilitychange', onVisibility)
        return () => {
          document.removeEventListener?.('visibilitychange', onVisibility)
          if (timerId !== null) window.clearInterval(timerId)
          timerId = null
          window.clearInterval(countdownId)
        }
      }, [liveRefreshEnabled])
      const sessionSummary = view ? view.sessionSummary : undefined
      const trajectory = view ? view.trajectory : undefined
      // 五档速率文案（V5.6）：exact→实时 / estimated→估算 / historical→最近 /
      // session→平均 / 其余→「等待速度数据」（替换旧「—」空闲形态：无值不伪装）。
      const speed = ratePresentation(view)
      const speedValue = speed ? `${speed.label} ${speed.value}` : '等待速度数据'
      const speedUnit = speed ? 'tok/s' : undefined
      // V5.8 设计稿 ②：五张指标卡数据推导（样例数字不硬编码；缺失「—」/「未提供」）
      const summary = sessionSummary || {}
      const turn = live && typeof live === 'object' ? live : last
      const turnFacts = panelTurnSteps(view)
      const toolStep = turnFacts.steps.find((step) => step.key === 'tool')
      const toolCount = turnFacts.scope === 'unavailable' ? undefined : toolStep?.count
      const errorTicks = turn && Array.isArray(turn.eventTicks)
        ? turn.eventTicks.filter((tick) => tick && (tick.kind === 'retry' || tick.kind === 'compaction'))
        : []
      const errorRetryCount = errorTicks.length > 0 ? errorTicks.length : undefined
      const retryCancelMeta = errorRetryCount !== undefined
        ? `重试 ${errorTicks.filter((t) => t.kind === 'retry').length} / 取消 ${errorTicks.filter((t) => t.kind === 'compaction').length}`
        : '—'
      const durationMs = turn && Number.isFinite(Number(turn.durationMs)) && Number(turn.durationMs) >= 0
        ? Number(turn.durationMs)
        : undefined
      const metricDuration = durationMs === undefined ? '—' : fmtSessionDuration(durationMs)
      const durationLabel = live ? '当前 Turn 时长' : last ? '最近 Turn 时长' : 'Turn 时长'
      const turnToolDurationMs = turn && [turn.toolWallMs, turn.toolWorkMs, turn.toolDurationMs]
        .map((value) => Number(value))
        .find((value) => Number.isFinite(value) && value >= 0)
      const runIdMeta = view && view.sessionId ? `运行 ID：${String(view.sessionId).slice(0, 16)}` : '运行 ID：未提供'
      const trajectoryPlotValue = trajectoryPlotTimeline(trajectory)
      const plotSource = trajectory
        ? {
          kind: 'session',
          spark: Array.isArray(trajectory.sparkline) ? trajectory.sparkline : [],
          eventTicks: Array.isArray(trajectory.eventTicks) ? trajectory.eventTicks : [],
          plotTimeline: trajectoryPlotValue,
        }
        : {
          kind: 'turn',
          spark: last ? (last.sparkline || []) : [],
          eventTicks: last ? (last.eventTicks || []) : [],
          plotTimeline: undefined,
        }
      const spark = plotSource.spark
      const eventTicks = plotSource.eventTicks
      const plotEventTicks = plotSource.kind === 'session'
        ? trajectoryPlotEventTicks(trajectory, eventTicks)
        : eventTicks
      const recent = (view ? view.recent : []) || []
      const curve = spark.length >= 2 ? buildBreathCurvePath(spark, plotSource.plotTimeline) : null
      // V5.8 P2.2 空态分层：无任何会话数据（无 last 且非 session 轨迹）→「当前会话暂无可绘制事件」；
      // 有会话但采样不足 → 保留采样不足披露（不混用最近 Turn 的曲线）。
      const curveNoEvents = !Boolean(last) && plotSource.kind === 'turn'
      const metric = (value) => h('span', { className: `jx-recent-row__metric${value === '—' ? ' jx-recent-row__metric--muted' : ''}` }, value)
      const freshness = data?.stale && !live
        ? '已保存快照 · 刷新可重新抓取'
        : data?.source === 'real' && live
          ? '实时数据'
          : data?.source === 'real' ? '历史实测数据'
            : data?.source === 'persisted' ? '来自快照' : undefined
      const speedMeta = speed
        ? data?.stale && !live
          ? '已保存快照'
          : speed.state === 'live' && freshness ? freshness : undefined
        : undefined
      const cacheValue = fmtCache(sessionSummary?.cachePct ?? last?.cachePct)
      const cacheTierValue = cacheTier(sessionSummary?.cachePct ?? last?.cachePct)
      const narrative = derivePhaseNarrative(spark, plotEventTicks, last?.status, live)
      const duration = fmtDur(last?.durationMs)
      // V1.0.1：时长事实卡回归 v2.1 语义——会话墙钟跨度（trajectory span）优先，
      // 无轨迹时回退到当前/最近 Turn 时长（metricDuration，保持诚实空态「—」）。
      const sessionSpanMs = trajectoryPlotValue?.span
      const sessionStatus = eventRailCopy(view)
      const curveTicks = curveTimeTicks(plotSource.plotTimeline)
      const cursor = curveCursor(view, plotSource.plotTimeline, spark)
      const rateTicks = curve ? curveRateTicks(curve.axisMax) : []
      const curvePeak = curve && Number.isFinite(Number(curve.maxRate)) ? `峰值 ${Math.round(Number(curve.maxRate))} tok/s` : null
      const headerStatus = threadStatusCopy(view)
      const headerStatusState = threadStatusState(view)
      const headerFreshness = freshness || '等待真实会话'
      return h('div', { className: 'jx-breath-surface jx-breath-native' },
        h(JingxiDialogHeader, {
          title: '鲸息 · 运行轨迹',
          titleId: 'jx-breath-title',
          subtitle: [
            h('span', { className: 'jx-breath-subtitle__status' }, ` · ${headerStatus} · ${headerFreshness}`),
          ],
          subtitleProps: {
            'data-thread-status': headerStatusState,
            'data-freshness': data?.stale ? 'stale' : data?.source === 'real' ? 'live' : 'unknown',
          },
          closeLabel: '关闭鲸息呼吸轨迹',
          onClose: closeBreath,
          showMark: true,
          markState: live ? 'active' : 'idle',
          stats: [
            {
              key: 'rate',
              label: speed ? (speed.label === '实时' ? '实时速度' : speed.label === '估算' ? '估算速度' : speed.label === '平均' ? '平均速度' : speed.label === '最近' ? '最近速度' : '速度') : '速度',
              meta: speedMeta,
              value: speed ? `${speed.value} tok/s` : '等待速度数据',
              icon: h(IconRightUpOutline16, { size: 16 }),
            },
            {
              key: 'cache',
              label: 'Cache 命中率',
              value: cacheValue,
              quality: cacheTierValue,
              meta: '缓存命中',
              icon: h(IconCheckOutline16, { size: 16 }),
            },
          ],
          autoRefresh: {
            on: Boolean(live) && autoRefreshOn,
            disabled: !live,
            countdown: breathCountdown,
            onToggle: () => {
              const next = !autoRefreshOn
              setBreathAutoRefresh(next)
              if (next) breathService.load({ force: true })
            },
          },
          actions: h(Button, {
            variant: 'ghost',
            size: 'sm',
            className: 'jx-dialog-refresh',
            type: 'button',
            'data-jx-refresh': 'breath',
            'aria-label': '刷新呼吸节奏',
            title: '刷新呼吸节奏',
            onClick: () => breathService.load({ force: true }),
          }, h(IconRefreshOutline14, { size: 14 })),
        }),
        h('div', { className: 'jx-breath-body' },
         h('div', { className: 'jx-breath-facts', role: 'group', 'aria-label': '运行核心指标' },
           h(BreathFactItem, { metric: 'tokens', label: 'Token 总量', value: summary.inputTokens !== undefined && summary.outputTokens !== undefined ? fmtTokCompact(Number(summary.inputTokens) + Number(summary.outputTokens)) : '—', meta: summary.inputTokens !== undefined ? `输入 ${fmtTokCompact(Number(summary.inputTokens))} / 输出 ${fmtTokCompact(Number(summary.outputTokens))}` : '未提供', icon: h(IconRightUpOutline16, { size: 18 }) }),
             h(BreathFactItem, { metric: 'duration', label: sessionSpanMs !== undefined ? '会话时长' : durationLabel, value: sessionSpanMs !== undefined ? fmtSessionDuration(Number(sessionSpanMs)) : metricDuration, meta: runIdMeta, icon: h(IconLoadingOutline16, { size: 18 }) }),
           h(BreathFactItem, { metric: 'rounds', label: '轮次 · 步数', value: summary.rounds !== undefined ? summary.rounds + ' 轮' : '—', meta: summary.steps !== undefined ? summary.steps + ' 步' : '未提供', icon: h(IconRightUpOutline16, { size: 18 }) }),
           h(BreathFactItem, { metric: 'tools', label: '工具 · 当前 Turn', value: toolCount !== undefined ? `${toolCount} 次` : '—', meta: turnToolDurationMs !== undefined ? `本轮 ${fmtSessionDuration(turnToolDurationMs)}` : '本轮时长未提供', icon: h(IconRefreshOutline16, { size: 18 }) }),
           h(BreathFactItem, { metric: 'errors', label: '异常 / 重试', value: errorRetryCount !== undefined ? `${errorRetryCount} 次` : '—', meta: retryCancelMeta, icon: h(IconWarningOutline16, { size: 18 }) }),
         ),
        h('div', { className: 'jx-breath-reading' },
          h('section', {
            className: 'jx-curve',
            'aria-label': breathCurveAriaLabel(spark),
            'data-curve-state': curve ? 'plot' : 'empty',
            'data-trajectory-source': plotSource.kind,
            'data-plot-time-scope': plotSource.kind,
            ...(curve ? {} : { 'data-curve-event-empty': curveNoEvents ? 'true' : 'false' }),
            ...(plotSource.plotTimeline ? {
              'data-plot-time-mode': plotSource.plotTimeline.mode,
              'data-plot-gap-count': plotSource.plotTimeline.gapCount,
            } : {}),
            ...(plotSource.plotTimeline ? {
              'data-plot-start-ms': plotSource.plotTimeline.start,
              'data-plot-end-ms': plotSource.plotTimeline.end,
            } : {}),
          },
            h('div', { className: 'jx-curve-head' },
              h('span', { className: 'jx-curve-label' }, plotSource.kind === 'session' ? '会话轨迹 · Breath Curve' : 'Breath Curve'),
              h('span', {
                className: 'jx-curve-source',
                'data-trajectory-provenance': data?.source || 'unknown',
              }, trajectorySourceLabel(data, trajectory, spark, view)),
            ),
            h('div', { className: 'jx-curve-title-row' },
              h('strong', { className: 'jx-curve-title' }, '速度 (tok/s)'),
              h('span', { className: 'jx-phase-narrative', 'aria-label': '阶段叙事' }, narrative),
              curvePeak ? h('span', { className: 'jx-curve-peak', 'aria-label': `速度峰值 ${Math.round(curve.maxRate)} tok/s` }, curvePeak) : null,
            ),
             h(CurveLegend, { eventTicks: plotEventTicks, scope: plotSource.kind }),
            h('div', { className: 'jx-curve-grid' },
              curve
                ? [
                  h('div', { key: 'axis', className: 'jx-curve-yaxis', 'aria-hidden': 'true' },
                    rateTicks.map((value, index) => h('span', { key: `rate-${index}`, className: 'jx-curve-yaxis__tick' }, String(value)))),
                  h('div', { key: 'plot', className: 'jx-curve-plot' }, [
                    h('div', { key: 'guides', className: 'jx-curve-guides', 'aria-hidden': 'true' },
                      [0, 50, 100].map((top) => h('i', { key: `guide-${top}`, style: { top: `${top}%` } }))),
                    h('svg', {
                      key: 'curve',
                      width: curve.w,
                      height: curve.hh,
                      viewBox: `0 0 ${curve.w} ${curve.hh}`,
                      preserveAspectRatio: 'none',
                      className: 'jx-curve-svg',
                      'data-curve-samples': curve.rawSampleCount,
                      'data-curve-render-samples': curve.renderSampleCount,
                      'data-curve-display': curve.displayMode,
                      'data-curve-axis-max': curve.axisMax,
                      'aria-hidden': 'true',
                    }, [
                      h('path', { key: 'line', className: 'jx-curve-line', d: curve.line, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
                      curve.area ? h('path', { key: 'area', className: 'jx-curve-area', d: curve.area, fill: 'currentColor', stroke: 'none' }) : null,
                    ]),
                    h(RuntimeEventTicks, { key: 'ticks', spark, eventTicks: plotEventTicks, plotTimeline: plotSource.plotTimeline, axisMax: curve.axisMax }),
                    cursor
                      ? h('span', {
                        key: 'cursor',
                        className: 'jx-curve-cursor',
                        'data-state': cursor.state,
                        style: { left: `${cursor.position}%` },
                        'aria-hidden': 'true',
                      }, cursor.label)
                      : null,
                    h('div', { key: 'time', className: 'jx-curve-xaxis', 'aria-hidden': 'true' },
                      curveTicks.map((tick, index) => h('span', {
                        key: `time-${index}`,
                        className: 'jx-curve-xaxis__tick',
                        'data-edge': index === 0 ? 'start' : index === curveTicks.length - 1 ? 'end' : undefined,
                        style: { left: `${tick.position}%` },
                      }, tick.label))),
                  ]),
                ]
                : h(BreathEmptyState, { hasTurn: Boolean(last), trajectorySource: plotSource.kind, noEvents: curveNoEvents, error: loadError, onRefresh: () => breathService.load({ force: true }) }),
            ),
          ),
          h(EventRail, { view, freshness: data?.stale && !live ? freshness : undefined, extra: (summary && summary.rounds !== undefined ? (live ? '已持续 ' + summary.rounds + ' 轮' : '已见 ' + summary.rounds + ' 轮') : undefined) }),
        ),
        h('details', { className: 'jx-breath-detail', 'aria-label': '详情' },
          h('summary', { className: 'jx-breath-detail__summary' }, '详情 ▾'),
        h(SubagentDock, { view }),
        h(BreathProgressCard, { sessionSummary, view }),
            h('div', { className: 'jx-breath-folds', 'aria-label': '详细数据与操作' },
              h('div', { className: 'jx-recent', 'aria-label': '最近 5 / Recent 5', role: 'list' },
                h('details', { className: 'jx-recent__fold' },
                  h('summary', { className: 'jx-recent__summary' },
                    h('span', { className: 'jx-recent__label' }, '最近 5'),
                  ),
              h('div', { className: 'jx-recent-rows' },
                recent.length > 0
                  ? recent.map(r => h('div', { key: r.turn, className: 'jx-recent-row', role: 'listitem' },
                      h('span', { className: 'jx-recent-row__turn' }, `#${r.turn}`),
                      h('span', { className: 'jx-recent-row__status', 'aria-label': r.status === 'completed' ? '已完成' : r.status }, r.status === 'completed' ? '✓' : '·'),
                      h('span', { className: 'jx-recent-row__spark', 'aria-label': 'sparkline' }, sparklineGlyph(r.sparkline)),
                      metric(r.avgTps !== undefined ? `${Math.round(r.avgTps)} tok/s` : '—'),
                      metric(r.cachePct !== undefined && r.cachePct !== null ? fmtCache(r.cachePct) : '—'),
                      metric(fmtDur(r.durationMs)),
                    ))
                  : h('div', { className: 'jx-recent-empty' }, '暂无已结算 Turn'),
              ),
            ),
          ),
          h(PhaseStory, { sessionSummary, status: last?.status, eventTicks, spark, live: Boolean(live) }),
        ),
        ),
        ),
      )
    }



    const BreathOverlay = () => {
      const [, force] = React.useReducer((v) => v + 1, 0)
      React.useEffect(() => { breathListeners.add(force); return () => breathListeners.delete(force) }, [])
      // V5.8 P3.3：Esc 关闭 + 关闭后焦点回返触发入口（focus guard 负责进浮层时聚焦关闭按钮）
      useModalEscapeGuard(breathOpen, closeBreath)
      useModalFocusGuard(breathOpen, '.jx-modal--breath')
      if (!breathOpen) return null
      return h(Modal, {
        open: breathOpen,
        onClose: closeBreath,
        title: '鲸息',
        closeLabel: '关闭鲸息呼吸轨迹',
        className: 'jx-modal--breath',


        'data-jx-workbench': 'reference',
        headless: true,
      }, h(BreathSurface, {}))
    }

    // ── 展开侧栏鲸息分区（sol 终版）：状态行 + scope 标注（本轮/累计/暂不可用）+ 三步骤 ──
    const JingxiWideStatus = ({ view, stale = false }) => {

      const state = threadStatusState(view)
      const label = state === 'active'
        ? '运行中'
        : state === 'stable'
          ? '运行正常'
          : state === 'failed' ? '需关注' : '等待下一轮'
      const turnSteps = panelTurnSteps(view)
      return h('div', { className: 'jx-fc-status-block' },

        h('div', { className: 'jx-fc-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
          h('i', { className: 'jx-fc-status__dot', 'data-state': state, 'aria-hidden': 'true' }),
          h('span', { className: 'jx-fc-status__label' }, label),
          h('span', { className: 'jx-fc-status__spacer', 'aria-hidden': 'true' }),
          turnSteps && turnSteps.turnLabel
            ? h('span', { className: 'jx-fc-status__turn', 'aria-hidden': 'true' }, turnSteps.turnLabel)
            : null,
        ),
        // V5.7 sol 终验 #1：tok/s 已归标题行（entry 行右侧渲染，见 FooterStatusCapsule），
        // 状态行只保留 dot + label + Turn（不再承载速率）。
        turnSteps.scope === 'unavailable'
          ? h('div', { className: 'jx-fc-status-wait' }, '等待真实 Turn 数据')
          : null,
        h('ul', { className: 'jx-fc-steps', 'aria-label': '本轮鲸息步骤统计' },
          turnSteps.steps.map((step, index) => {
            const stepState = step.count === null
              ? 'none'
              : step.count > 0
                ? 'done'
                : turnSteps.live
                  ? (index === turnSteps.firstOpen ? 'working' : 'pending')
                  : 'none'
            return h('li', {
              key: step.key,
              className: 'jx-fc-step',
              'data-step': step.key,
              'data-step-state': stepState,
            },
              h('span', { className: 'jx-fc-step__mark', 'aria-hidden': 'true' }, stepState === 'done' ? '●' : stepState === 'none' ? '—' : '○'),
              h('span', { className: 'jx-fc-step__label' }, step.label),
              h('span', { className: 'jx-fc-step__count' }, step.count == null || step.count <= 0 ? '' : `${step.count} 次`),
            )
          }),
        ),
      )
    }

    // ── Sidebar Entry：wide/rail 都只保留一个原生节奏内的鲸息入口 ──
    // V1.0.1：入口点击直达呼吸轨迹（无中间面板）；DSH 更新检查移至
    // Settings Doctor 只读呈现，Footer 不再承载 action 导航。
    const FooterStatusCapsule = (props) => {
      const wide = props.wide !== false
      const breathSurfaceOpen = useBreathOpen()
      const data = useBreath()
      const runtime = useRuntimeState()
      const view = data && data.view ? data.view : undefined
      const last = view ? view.last : undefined
      // V5.7 sol 终验 #1：标题行右侧 tok/s（五档映射，单一映射源 ratePresentation）
      const speed = ratePresentation(view)
      const entryState = view?.live
        ? 'active'
        : runtime.update.status === 'failed' || isFailedTurnStatus(last?.status)
          ? 'failed'
          : last?.status === 'completed' ? 'stable' : 'idle'
      const threadStatus = threadStatusCopy(view)
      // wide 展开态（MSG#70）：可见一行短文案，完整文案走 aria-label。
      // 短文案不复用 threadStatusCopy——完整文案带「线程状态：」前缀留给读屏，
      // 视觉行只显示状态词；stale（data.stale）时追加「 · 数据较旧」。
      const threadStatusShort = view?.live
        ? '正在生成回答'
        : view?.last?.status === 'completed' ? '已完成'
          : view?.last?.status === 'interrupted' ? '已中断'
            : view?.last?.status === 'aborted' ? '已终止'
              : view?.last?.status === 'error' ? '异常'
                : view?.last?.status === 'max-tokens' ? 'Token 上限'
                  : '等待下一轮'
      const threadStale = data?.stale === true
      const threadStatusVisible = threadStale ? `${threadStatusShort} · 数据较旧` : threadStatusShort
      const threadStatusFull = threadStale ? `${threadStatus} · 数据较旧` : threadStatus
      return h('div', {

        className: 'jx-fc',
        'data-sidebar-mode': wide ? 'wide' : 'rail',
        'aria-label': '鲸息入口',
      },
        // wide 重排（V1.0.1 Pure Breath）：① 上细线 → ② 鲸息标题行（官方鲸鱼，
        // 点击直达呼吸轨迹）③ 状态/最近 Turn/三步骤（JingxiWideStatus，panelTurnSteps）
        // ④ 下细线。快捷操作与版本行已移除；设置仍由 DSH 原生区负责。
        wide ? h('div', { className: 'jx-fc-breath' },
          h('div', { className: 'jx-fc-divider jx-fc-divider--breath', 'aria-hidden': 'true' }),
          h(Button, {
            variant: 'ghost',
            className: 'jx-fc-btn jx-fc-entry',
            onClick: (event) => openBreath(event.currentTarget),
            'data-jx-surface-trigger': 'breath',
            'aria-label': '鲸息',
            title: '鲸息',
          },
            h('span', { className: 'jx-fc-entry__icon', 'aria-hidden': 'true' },
              h(JingxiRuntimeMark, { action: 'jingxi', state: entryState, size: 20, decorative: true }),
            ),
            h('span', { className: 'jx-fc-entry__label' }, `鲸息 · ${threadStatusShort}`),
            // V5.9（第三方审查 #1）：中断/需关注态隐藏速率——陈旧速度值不再与「已中断」并列，
            // 避免「已中断 + 最近 125 tok/s」自相矛盾。
            entryState === 'failed'
              ? null
              : h('span', { className: 'jx-fc-entry__rate', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-state': speed ? speed.state : 'waiting', ...(threadStale && speed ? { 'data-stale': 'true', title: '数据较旧' } : {}) },
                h('span', { className: 'jx-fc-entry__rate-label' }, speed ? speed.label : '速度'),
                h('span', { className: 'jx-fc-entry__rate-value' }, speed ? `${speed.value} tok/s${threadStale ? ' · 数据较旧' : ''}` : '等待速度数据'),
              ),
          ),
          h(JingxiWideStatus, { view, stale: threadStale }),

          h('div', { className: 'jx-fc-divider jx-fc-divider--breath', 'aria-hidden': 'true' }),
        ) : null,
        !wide ? h(Button, {
          variant: 'ghost',
          className: 'jx-fc-btn jx-fc-entry',
          onClick: (event) => openBreath(event.currentTarget),
          'data-jx-surface-trigger': 'breath',
          'data-jx-selected': breathSurfaceOpen ? 'true' : undefined,
          'aria-current': breathSurfaceOpen ? 'true' : undefined,
          'aria-label': '鲸息',
          title: '鲸息',
        },
          h('span', { className: 'jx-fc-entry__icon', 'aria-hidden': 'true' },
            h(JingxiRuntimeMark, { action: 'jingxi', state: entryState, size: 20, decorative: true }),
          ),
        ) : null,


      )
    }

    // ── Settings / System secondary ──
    // V5.5 → P0「设置与可达性」：设置区从空壳升级为真实的版本 / 运行状态 / Doctor
    // 功能区。它还是 320px 宿主隐藏 footer 时的正式备用入口（点「打开鲸息」先关闭
    // 设置面板再开 Breath，避免 modal-on-modal）。只读诊断，不做任何 mutation。
    const Settings = (props) => {
      const [status, setStatus] = React.useState(null)
      const [health, setHealth] = React.useState(null)
      const [checking, setChecking] = React.useState(true)
      const runtime = useRuntimeState()
      const loadDiagnostics = React.useCallback(() => {
        setChecking(true)
        // 面板移除后，Settings 成为更新检查的唯一客户端入口：随诊断加载
        // 触发一次只读检查；inflight 去重，「重新检查」按钮可重发。
        checkDshUpdate().catch(() => {})
        Promise.all([
          fetch('/api/jingxi/status', { cache: 'no-store' })
            .then((response) => response.json()).catch(() => null),
          fetch('/api/system/health', { cache: 'no-store' })
            .then((response) => response.json()).catch(() => null),
        ]).then(([statusPayload, healthPayload]) => {
          setStatus(statusPayload && statusPayload.ok ? statusPayload : null)
          setHealth(healthPayload && healthPayload.ready ? healthPayload : null)
          setChecking(false)
        })
      }, [])
      React.useEffect(() => { loadDiagnostics() }, [loadDiagnostics])
      const openRealBreath = () => {
        const close = typeof props?.close === 'function' ? props.close : undefined
        if (close) try { close() } catch { /* keep going */ }
        openBreath(null)
      }
      const update = runtime?.update || {}
      const dshVersion = update.currentVersion || health?.dshVersion || status?.hostDshVersion || '—'
      const compatState = update.compatibility?.state
      const stateRow = (label, value, state, hint) =>
        h('div', { className: 'jx-settings-state', 'data-state': state || 'unknown' },
          h('span', { className: 'jx-settings-state__label' }, label),
          h('span', { className: 'jx-settings-state__value' }, value ?? '—'),
          hint ? h('span', { className: 'jx-settings-state__hint' }, hint) : null,
        )
      return h('div', { className: 'jx-settings' },
        h('div', { className: 'jx-settings-row', 'aria-label': '设置' },
          h('span', { className: 'jx-settings-row__icon', 'aria-hidden': 'true' },
            h(IconSettingsOutline16, { size: 24, className: 'jx-settings-row__glyph' }),
          ),
          h('span', { className: 'jx-settings-row__label' }, '设置'),
        ),
        h('div', { className: 'jx-settings-body' },
          h('div', { className: 'jx-settings-open' },
            h(Button, {
              variant: 'primary',
              size: 'sm',
              className: 'jx-settings-open__btn',
              'data-jx-surface-trigger': 'breath',
              'aria-label': '打开鲸息呼吸轨迹',
              onClick: openRealBreath,
            }, h('span', { className: 'jx-settings-open__label' }, '打开鲸息')),
            h('p', { className: 'jx-settings-open__hint' }, '窄窗口下也从设置直达鲸息呼吸轨迹'),
          ),
          h('section', { className: 'jx-settings-section', 'aria-label': '版本' },
            h('h3', { className: 'jx-settings-section__title' }, '版本'),
            stateRow('鲸息插件', status?.jingxiVersion ?? '—'),
            stateRow('设计基线', status?.designVersion ?? '—'),
            stateRow('DSH 宿主', dshVersion),
            stateRow('宿主兼容', compatState || 'unknown', compatState === 'verified' ? 'ok' : undefined,
              compatState === 'verified' ? '已验证' : '未验证'),
          ),
          h('section', { className: 'jx-settings-section', 'aria-label': '运行状态' },
            h('h3', { className: 'jx-settings-section__title' }, '运行状态'),
            stateRow('会话投影', status?.projectionRegistered ? '已注册' : '未注册',
              status?.projectionRegistered ? 'ok' : 'error'),
            stateRow('实时遥测', status?.realListening ? '监听中' : '未监听',
              status?.realListening ? 'ok' : 'error'),
            stateRow('DSH 运行', health?.ready ? '健康' : checking ? '检查中' : '不可用',
              health?.ready ? 'ok' : 'error',
              health?.pid ? `pid ${health.pid}` : undefined),
          ),
          h('details', { className: 'jx-settings-doctor' },
            h('summary', { className: 'jx-settings-doctor__summary' }, '诊断与修复'),
            h('div', { className: 'jx-settings-doctor__body' },
              stateRow('插件版本', status?.jingxiVersion ?? '—'),
              stateRow('更新可用', update.updateAvailable ? '有更新' : '最新', update.updateAvailable ? 'warn' : 'ok'),
              stateRow('更新适配', update.mutationAllowed ? '允许' : '已阻止',
                update.mutationAllowed ? 'ok' : update.compatibility?.state === 'unknown' ? 'warn' : 'error'),
              // 只读诊断的诚实失败面：检查失败时给出可操作原因，不伪造成功态
              update.status === 'failed' && update.error
                ? stateRow('检查失败', update.error, 'error')
                : null,
              h('div', { className: 'jx-settings-doctor__actions' },
                h(Button, {
                  variant: 'ghost',
                  size: 'sm',
                  className: 'jx-settings-doctor__recheck',
                  'aria-label': '重新检查',
                  onClick: loadDiagnostics,
                  disabled: checking,
                }, checking ? '检查中…' : '重新检查'),
              ),
            ),
          ),
        ),
      )
    }

    function apply(ctx) {
      // 一次初始刷新；完成快照不轮询，live session 只由 BreathSurface 维持 5s 刷新。
      breathService.load()
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'jingxi', order: 90, label: '鲸息' }, FooterStatusCapsule,
      ))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'jingxi', order: 90, label: '鲸息轨迹' }, BreathOverlay,
      ))
      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'jingxi', order: 90, label: '鲸息' }, Settings,
      ))
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})


