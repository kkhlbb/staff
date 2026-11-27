import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  M1ClientConnectionState,
  M1ConnectionSource,
  M1ProjectAuthorizationState,
} from '../m1WorkbenchBridge'
import type { M2ViewMode } from '../m2WorkbenchBridge'
import type { M2ArtifactStatusMeta } from '../M2CenterCanvas'
import { readWindowChromeInfo, type WorkbenchTheme } from '../workbenchTheme'
import {
  formatAuthorizationLabel,
  formatClientConnectionLabel,
  formatSourceLabel,
  getAuthorizationTone,
  getClientConnectionTone,
  type SidebarTab,
  type WorkbenchLocalProject,
} from '../workbenchHelpers'
import { ReportExportMenu, type ReportExportMenuProps } from './ReportExportMenu'

export interface WorkbenchTopBarProps {
  readonly projectId: string
  readonly projectName: string
  readonly baseRevision: string | null
  readonly draftRevision: string | null
  readonly workflowStep: 1 | 2 | 3
  readonly showOnboarding: boolean
  readonly effectiveViewMode: M2ViewMode
  readonly isNarrow: boolean
  readonly modelStatusMeta: M2ArtifactStatusMeta
  readonly drawingStatusMeta: M2ArtifactStatusMeta
  readonly onChangeViewMode: (mode: M2ViewMode) => void

  // Connection popover
  readonly connectionState: M1ClientConnectionState
  readonly connectionSource: M1ConnectionSource
  readonly clientName: string | null
  readonly apiModel: string
  readonly skippedConnection: boolean
  readonly compactConnectionLabel: string
  readonly authorizationState: M1ProjectAuthorizationState
  readonly connectionPopoverOpen: boolean
  readonly readonlyAuthPending: boolean
  readonly takeoverPending: boolean
  readonly selectedTakeoverTarget: 'local-agent' | 'model-api' | ''
  readonly onToggleConnectionPopover: () => void
  readonly onCloseConnectionPopover: () => void
  readonly onRequestReadonlyAuthorization: () => void
  readonly onChangeSelectedTakeoverTarget: (value: 'local-agent' | 'model-api' | '') => void
  readonly onTakeoverDraft: () => void
  readonly onToggleOnboardingFromPopover: () => void

  // Completion CTA
  readonly hasSaveableResult: boolean
  readonly showCompletionView: boolean
  readonly onToggleCompletionView: () => void

  // Integrated Project Menu
  readonly moreMenuOpen: boolean
  readonly sidebarTab: SidebarTab
  readonly theme: WorkbenchTheme
  readonly hasMigrationReport: boolean
  readonly localProjects?: readonly WorkbenchLocalProject[]
  readonly onToggleMoreMenu: () => void
  readonly onCloseMoreMenu: () => void
  readonly onSwitchSidebarMode: () => void
  readonly onToggleTheme: () => void
  readonly onOpenLocalProjectSelector: () => void
  readonly onOpenLocalProject?: (item: WorkbenchLocalProject) => void
  readonly onImportStep?: () => void
  readonly onCreateNewBlock?: () => void
  readonly onOpenMigrationReport: () => void
  readonly reportExport?: Omit<ReportExportMenuProps, 'variant'>
}

/**
 * 36px integrated frameless custom titlebar (v1.1.0 / v4 prototype):
 * - `-webkit-app-region: drag` across the bar, `no-drag` on all interactive controls
 * - Automatically reserves platform safe-area insets from `window.cunlianDesktop?.windowChrome`
 *   (macOS left traffic lights / Windows right 138px titleBarOverlay with 1px divider)
 * - Left: 16px geometric vector mark + integrated `项目名 ▾` dropdown menu + pure-text revision status
 * - Center: minimal underline view tabs (`模型` / `工程图` / `并排`)
 * - Right: quiet connection dot trigger, `浅色/深色`, `导出`, and sole `--accent` `保存` action
 */
export function WorkbenchTopBar({
  projectId,
  projectName,
  baseRevision,
  draftRevision,
  showOnboarding,
  effectiveViewMode,
  isNarrow,
  modelStatusMeta,
  drawingStatusMeta,
  onChangeViewMode,
  connectionState,
  connectionSource,
  clientName,
  apiModel,
  skippedConnection,
  compactConnectionLabel,
  authorizationState,
  connectionPopoverOpen,
  readonlyAuthPending,
  takeoverPending,
  selectedTakeoverTarget,
  onToggleConnectionPopover,
  onCloseConnectionPopover,
  onRequestReadonlyAuthorization,
  onChangeSelectedTakeoverTarget,
  onTakeoverDraft,
  onToggleOnboardingFromPopover,
  hasSaveableResult,
  showCompletionView,
  onToggleCompletionView,
  moreMenuOpen,
  sidebarTab,
  theme,
  localProjects = [],
  onToggleMoreMenu,
  onCloseMoreMenu,
  onSwitchSidebarMode,
  onToggleTheme,
  onOpenLocalProjectSelector,
  onOpenLocalProject,
  onImportStep,
  onCreateNewBlock,
  onOpenMigrationReport,
  reportExport,
}: WorkbenchTopBarProps) {
  const connPopoverAnchorRef = useRef<HTMLDivElement | null>(null)
  const projMenuAnchorRef = useRef<HTMLDivElement | null>(null)
  const exportMenuAnchorRef = useRef<HTMLDivElement | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  const windowChrome = useMemo(() => readWindowChromeInfo(), [])
  const leftInsetPx =
    windowChrome?.hasCustomTitlebar && windowChrome.leftInsetPx > 0 ? windowChrome.leftInsetPx : 0
  const rightInsetPx =
    windowChrome?.hasCustomTitlebar && windowChrome.rightInsetPx > 0
      ? windowChrome.rightInsetPx
      : 0

  useEffect(() => {
    if (!connectionPopoverOpen && !moreMenuOpen && !exportMenuOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (connectionPopoverOpen) onCloseConnectionPopover()
        if (moreMenuOpen) onCloseMoreMenu()
        if (exportMenuOpen) setExportMenuOpen(false)
      }
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return
      if (connectionPopoverOpen && connPopoverAnchorRef.current && !connPopoverAnchorRef.current.contains(event.target)) {
        onCloseConnectionPopover()
      }
      if (moreMenuOpen && projMenuAnchorRef.current && !projMenuAnchorRef.current.contains(event.target)) {
        onCloseMoreMenu()
      }
      if (exportMenuOpen && exportMenuAnchorRef.current && !exportMenuAnchorRef.current.contains(event.target)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [
    connectionPopoverOpen,
    moreMenuOpen,
    exportMenuOpen,
    onCloseConnectionPopover,
    onCloseMoreMenu,
  ])

  const revisionSummary = draftRevision
    ? `草稿 ${draftRevision}`
    : baseRevision
      ? `已提交 ${baseRevision}`
      : '未提交'

  return (
    <header
      className="pa-workbench-topbar"
      aria-label="顶部连接状态栏"
      data-testid="workbench-topbar"
      data-platform={windowChrome?.platform ?? 'web'}
    >
      <div
        className="pa-topbar-left"
        style={leftInsetPx > 0 ? { paddingLeft: `${leftInsetPx}px` } : undefined}
        data-left-inset-px={String(leftInsetPx)}
      >
        {leftInsetPx > 0 ? (
          <span
            className="pa-titlebar-inset-marker"
            data-testid="titlebar-left-inset"
            aria-hidden="true"
          />
        ) : null}

        <span className="pa-app-mark" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect
              x="2"
              y="2"
              width="12"
              height="12"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="5.5" cy="8" r="1.2" fill="currentColor" />
            <circle cx="10.5" cy="8" r="1.2" fill="currentColor" />
          </svg>
        </span>

        {/* Integrated Project & File Menu (replaces classic menu bar) */}
        <div className="pa-popover-anchor" ref={projMenuAnchorRef}>
          <button
            type="button"
            data-testid="more-menu-btn"
            className="pa-proj-trigger"
            aria-label={`项目菜单：${projectName}`}
            aria-haspopup="menu"
            aria-expanded={moreMenuOpen}
            onClick={() => {
              setExportMenuOpen(false)
              onToggleMoreMenu()
            }}
          >
            <h1 className="pa-project-title">{projectName}</h1>
            <span className="pa-proj-caret" aria-hidden="true">
              ▾
            </span>
          </button>

          {moreMenuOpen ? (
            <div
              className="pa-proj-menu"
              role="menu"
              aria-label="项目与工作台菜单"
              data-testid="project-dropdown-menu"
            >
              <div className="pa-pm-label">项目与文件</div>
              <button
                type="button"
                role="menuitem"
                data-testid="menu-import-step"
                className="pa-pm-item"
                onClick={() => {
                  onCloseMoreMenu()
                  if (onImportStep) onImportStep()
                  else onOpenLocalProjectSelector()
                }}
              >
                <span>导入 STEP 装配…</span>
                <span className="pa-pm-k">Ctrl+I</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="menu-new-block"
                className="pa-pm-item"
                onClick={() => {
                  onCloseMoreMenu()
                  if (onCreateNewBlock) onCreateNewBlock()
                  else onOpenLocalProjectSelector()
                }}
              >
                <span>新建轻量 3D 积木</span>
                <span className="pa-pm-k">Ctrl+N</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="menu-open-project"
                className="pa-pm-item"
                onClick={() => {
                  onOpenLocalProjectSelector()
                }}
              >
                <span>打开 .cunlian 项目…</span>
                <span className="pa-pm-k">Ctrl+O</span>
              </button>

              {localProjects.length > 0 ? (
                <>
                  <div className="pa-pm-sep" role="separator" />
                  <div className="pa-pm-label">内置示例模板</div>
                  {localProjects.map((tpl) => (
                    <button
                      key={tpl.projectId}
                      type="button"
                      role="menuitem"
                      data-testid={`menu-template-${tpl.projectId}`}
                      className="pa-pm-item"
                      onClick={() => {
                        onCloseMoreMenu()
                        if (onOpenLocalProject) onOpenLocalProject(tpl)
                        else onOpenLocalProjectSelector()
                      }}
                    >
                      <span>
                        {tpl.projectName}
                        {tpl.projectId === projectId ? '（当前）' : ''}
                      </span>
                    </button>
                  ))}
                </>
              ) : null}

              <div className="pa-pm-sep" role="separator" />
              <div className="pa-pm-label">连接与工具</div>
              <button
                type="button"
                role="menuitem"
                data-testid="menu-ai-config"
                className="pa-pm-item"
                onClick={() => {
                  onCloseMoreMenu()
                  onToggleOnboardingFromPopover()
                }}
              >
                <span>AI 连接与模型配置…</span>
                <span className="pa-pm-k">Ctrl+,</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="pa-pm-item"
                onClick={onSwitchSidebarMode}
              >
                <span>
                  {sidebarTab === 'builtin' ? '切换到外置 Agent 活动' : '切换到内置模型对话'}
                </span>
                <span className="pa-pm-k">{sidebarTab === 'builtin' ? '内置' : '外置'}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="pa-pm-item"
                onClick={onOpenLocalProjectSelector}
              >
                <span>切换本地项目</span>
                <span className="pa-pm-k">{projectId}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="pa-pm-item"
                onClick={onOpenMigrationReport}
              >
                <span>查看旧项目迁移差异报告</span>
              </button>

              <div className="pa-pm-sep" role="separator" />
              <a
                href="#/desktop-m1-readonly"
                role="menuitem"
                className="pa-pm-item pa-menu-link"
                onClick={onCloseMoreMenu}
              >
                <span>只读授权视图</span>
              </a>
              <a
                href="#/desktop-legacy"
                role="menuitem"
                className="pa-pm-item pa-menu-link"
                onClick={onCloseMoreMenu}
              >
                <span>返回旧工作台</span>
              </a>
            </div>
          ) : null}
        </div>

        <span
          className="pa-proj-rev pa-mono"
          aria-label="修订版本状态"
          title={`正式版 ${baseRevision ?? '无'} · 草稿 ${draftRevision ?? '无'}`}
        >
          {revisionSummary}
        </span>
      </div>

      {/* Center: Minimal underline view tabs */}
      <div className="pa-topbar-center">
        {!showOnboarding ? (
          <div className="pa-tb-tabs" role="tablist" aria-label="中央画布视图切换">
            <button
              type="button"
              role="tab"
              aria-selected={effectiveViewMode === 'model'}
              data-artifact-status={modelStatusMeta.stateKey}
              title={modelStatusMeta.text}
              className={effectiveViewMode === 'model' ? 'pa-tb-tab pa-btn-active' : 'pa-tb-tab'}
              onClick={() => onChangeViewMode('model')}
            >
              模型
              {isNarrow ? <span aria-hidden="true"> {modelStatusMeta.symbol}</span> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveViewMode === 'drawing'}
              data-artifact-status={drawingStatusMeta.stateKey}
              title={drawingStatusMeta.text}
              className={effectiveViewMode === 'drawing' ? 'pa-tb-tab pa-btn-active' : 'pa-tb-tab'}
              onClick={() => onChangeViewMode('drawing')}
            >
              工程图
              {isNarrow ? <span aria-hidden="true"> {drawingStatusMeta.symbol}</span> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveViewMode === 'split'}
              disabled={isNarrow}
              title={isNarrow ? '窗口较窄时自动退化为模型/工程图标签页' : '模型与工程图并排联动'}
              className={effectiveViewMode === 'split' ? 'pa-tb-tab pa-btn-active' : 'pa-tb-tab'}
              onClick={() => onChangeViewMode('split')}
            >
              并排
            </button>
          </div>
        ) : null}
      </div>

      {/* Right: Quiet tools + optional Win11 native caption overlay inset */}
      <div className="pa-topbar-right">
        <div
          className={rightInsetPx > 0 ? 'pa-tb-tools pa-tb-tools-divided' : 'pa-tb-tools'}
        >
          {/* Quiet Connection & Authorization Popover Trigger */}
          <div className="pa-popover-anchor" ref={connPopoverAnchorRef}>
            <button
              type="button"
              data-testid="connection-capsule-btn"
              className="pa-tb-icon-btn pa-tb-conn-btn"
              aria-label="当前连接来源"
              aria-haspopup="dialog"
              aria-expanded={connectionPopoverOpen}
              onClick={() => {
                setExportMenuOpen(false)
                onToggleConnectionPopover()
              }}
            >
              <span
                className={
                  connectionState === 'connected'
                    ? 'pa-conn-dot'
                    : connectionState === 'disconnected' && connectionSource !== 'none'
                      ? 'pa-conn-dot pa-conn-dot-offline'
                      : 'pa-conn-dot pa-conn-dot-idle'
                }
                aria-hidden="true"
              />
              <span>{compactConnectionLabel}</span>
            </button>

            {connectionPopoverOpen ? (
              <div className="pa-popover pa-conn-popover" role="dialog" aria-label="连接与授权详情">
                <div className="pa-header">
                  <strong className="pa-title">连接与授权</strong>
                  <button
                    type="button"
                    data-testid="close-connection-popover-btn"
                    className="pa-icon-btn"
                    aria-label="关闭连接与授权详情"
                    title="关闭"
                    onClick={onCloseConnectionPopover}
                  >
                    ✕
                  </button>
                </div>
                <div className="pa-popover-meta">
                  <span className="pa-muted">
                    来源：{formatSourceLabel(connectionSource, clientName, apiModel, skippedConnection)}
                  </span>
                  <div className="pa-row">
                    <span
                      className={`pa-pill ${getClientConnectionTone(connectionState)}`}
                      aria-label="顶部客户端连接状态"
                    >
                      客户端：{formatClientConnectionLabel(connectionState, clientName)}
                    </span>
                    <span
                      className={`pa-pill ${getAuthorizationTone(authorizationState)}`}
                      aria-label="顶部项目授权状态"
                    >
                      项目授权：{formatAuthorizationLabel(authorizationState)}
                    </span>
                  </div>
                </div>

                {authorizationState === 'unauthorized' ? (
                  <button
                    type="button"
                    className="pa-btn pa-btn-primary pa-btn-sm"
                    disabled={readonlyAuthPending}
                    onClick={onRequestReadonlyAuthorization}
                  >
                    {readonlyAuthPending ? '申请只读授权中…' : '申请原生只读授权'}
                  </button>
                ) : authorizationState !== 'authorized-writable' && draftRevision === null ? (
                  <div className="pa-list">
                    {connectionSource === 'none' ? (
                      <select
                        aria-label="写入目标入口"
                        className="pa-select"
                        value={selectedTakeoverTarget}
                        onChange={(event) =>
                          onChangeSelectedTakeoverTarget(
                            event.target.value as 'local-agent' | 'model-api' | '',
                          )
                        }
                      >
                        <option value="">请选择写入目标入口</option>
                        <option value="local-agent">本地 Agent</option>
                        <option value="model-api">模型 API</option>
                      </select>
                    ) : null}
                    <button
                      type="button"
                      className="pa-btn pa-btn-primary pa-btn-sm"
                      disabled={
                        takeoverPending ||
                        (connectionSource === 'none' && !selectedTakeoverTarget)
                      }
                      onClick={onTakeoverDraft}
                    >
                      {takeoverPending ? '申请写入中…' : '申请原生写入'}
                    </button>
                  </div>
                ) : null}

                <div className="pa-popover-footer">
                  <button
                    type="button"
                    className="pa-btn pa-btn-ghost pa-btn-sm"
                    onClick={onCloseConnectionPopover}
                  >
                    取消 / 退出
                  </button>
                  <button
                    type="button"
                    className="pa-btn pa-btn-sm"
                    onClick={onToggleOnboardingFromPopover}
                  >
                    切换连接
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            data-testid="theme-toggle-btn"
            className="pa-tb-icon-btn"
            aria-label="切换浅色/深色主题"
            aria-pressed={theme === 'dark'}
            title="切换深浅色"
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? '浅色' : '深色'}
          </button>

          {reportExport ? (
            <div className="pa-popover-anchor" ref={exportMenuAnchorRef}>
              <button
                type="button"
                data-testid="topbar-export-btn"
                className="pa-tb-icon-btn"
                aria-label="导出仿真报告"
                aria-haspopup="menu"
                aria-expanded={exportMenuOpen}
                title="导出离线仿真报告"
                onClick={() => {
                  onCloseMoreMenu()
                  onCloseConnectionPopover()
                  setExportMenuOpen((prev) => !prev)
                }}
              >
                导出
              </button>
              {exportMenuOpen ? (
                <div
                  className="pa-dropdown-menu pa-export-dropdown"
                  role="menu"
                  aria-label="导出工程报告菜单"
                >
                  <ReportExportMenu
                    {...reportExport}
                    variant="menu-items"
                    onExportComplete={(msg) => {
                      reportExport.onExportComplete?.(msg)
                      setExportMenuOpen(false)
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {hasSaveableResult && !showOnboarding ? (
            <button
              type="button"
              data-testid="complete-and-save-btn"
              className="pa-tb-icon-btn pa-tb-icon-btn-accent"
              aria-expanded={showCompletionView}
              title="确认并保存修订 (Ctrl+S)"
              onClick={onToggleCompletionView}
            >
              保存
            </button>
          ) : null}
        </div>

        {rightInsetPx > 0 ? (
          <div
            className="pa-titlebar-right-inset"
            data-testid="titlebar-right-inset"
            style={{ width: `${rightInsetPx}px` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </header>
  )
}
