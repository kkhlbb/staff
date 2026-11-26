import { useEffect, useRef } from 'react'
import type {
  M1ClientConnectionState,
  M1ConnectionSource,
  M1ProjectAuthorizationState,
} from '../m1WorkbenchBridge'
import type { M2ViewMode } from '../m2WorkbenchBridge'
import type { M2ArtifactStatusMeta } from '../M2CenterCanvas'
import type { WorkbenchTheme } from '../workbenchTheme'
import {
  formatAuthorizationLabel,
  formatClientConnectionLabel,
  formatSourceLabel,
  getAuthorizationTone,
  getClientConnectionTone,
  type SidebarTab,
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

  // More menu
  readonly moreMenuOpen: boolean
  readonly sidebarTab: SidebarTab
  readonly theme: WorkbenchTheme
  readonly hasMigrationReport: boolean
  readonly onToggleMoreMenu: () => void
  readonly onCloseMoreMenu: () => void
  readonly onSwitchSidebarMode: () => void
  readonly onToggleTheme: () => void
  readonly onOpenLocalProjectSelector: () => void
  readonly onOpenMigrationReport: () => void
  readonly reportExport?: Omit<ReportExportMenuProps, 'variant'>
}

/**
 * Single-row 48px minimal top bar (GUI-V2-UX-01):
 * Left: brand + project title + revision capsule + 3-step indicator
 * Center: unique view switch (模型 / 图纸 / 并排)
 * Right: <= 3 controls (Connection capsule, Complete & Save CTA, More ⋯ menu)
 */
export function WorkbenchTopBar({
  projectId,
  projectName,
  baseRevision,
  draftRevision,
  workflowStep,
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
  onToggleMoreMenu,
  onCloseMoreMenu,
  onSwitchSidebarMode,
  onToggleTheme,
  onOpenLocalProjectSelector,
  onOpenMigrationReport,
  reportExport,
}: WorkbenchTopBarProps) {
  const connPopoverAnchorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!connectionPopoverOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseConnectionPopover()
      }
    }
    const handlePointerDown = (event: MouseEvent) => {
      const anchor = connPopoverAnchorRef.current
      if (anchor && event.target instanceof Node && !anchor.contains(event.target)) {
        onCloseConnectionPopover()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [connectionPopoverOpen, onCloseConnectionPopover])

  return (
    <header className="pa-workbench-topbar" aria-label="顶部连接状态栏">
      <div className="pa-topbar-left">
        <span className="pa-brand-mini" aria-hidden="true">
          <span className="pa-brand-mini-icon">寸</span>
          <span>寸链</span>
        </span>
        <h1 className="pa-title pa-project-title">{projectName}</h1>
        <span className="pa-rev-capsule pa-mono" aria-label="修订版本状态">
          正式版 {baseRevision ?? '无'} · 草稿 {draftRevision ?? '无'}
        </span>
        <span className="pa-workflow-steps" aria-label="三步工作流进度">
          <span className={workflowStep >= 1 ? 'pa-step pa-step-done' : 'pa-step'}>① 连接</span>
          <span className="pa-step-sep" aria-hidden="true">
            ›
          </span>
          <span
            className={
              workflowStep === 2
                ? 'pa-step pa-step-active'
                : workflowStep > 2
                  ? 'pa-step pa-step-done'
                  : 'pa-step'
            }
          >
            ② 改图
          </span>
          <span className="pa-step-sep" aria-hidden="true">
            ›
          </span>
          <span className={workflowStep === 3 ? 'pa-step pa-step-active' : 'pa-step'}>③ 保存</span>
        </span>
      </div>

      {/* Center: Single Source of Truth for View Switching (Not duplicated in canvas) */}
      <div className="pa-topbar-center">
        {!showOnboarding ? (
          <div className="pa-segmented" role="tablist" aria-label="中央画布视图切换">
            <button
              type="button"
              role="tab"
              aria-selected={effectiveViewMode === 'model'}
              data-artifact-status={modelStatusMeta.stateKey}
              title={modelStatusMeta.text}
              className={effectiveViewMode === 'model' ? 'pa-btn-active' : undefined}
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
              className={effectiveViewMode === 'drawing' ? 'pa-btn-active' : undefined}
              onClick={() => onChangeViewMode('drawing')}
            >
              图纸
              {isNarrow ? <span aria-hidden="true"> {drawingStatusMeta.symbol}</span> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveViewMode === 'split'}
              disabled={isNarrow}
              title={isNarrow ? '窗口较窄时自动退化为模型/图纸标签页' : '模型与图纸并排联动'}
              className={effectiveViewMode === 'split' ? 'pa-btn-active' : undefined}
              onClick={() => onChangeViewMode('split')}
            >
              并排
            </button>
          </div>
        ) : null}
      </div>

      {/* Right: Strictly <= 3 interactive controls (Connection Capsule + Complete & Save CTA + More Menu) */}
      <div className="pa-topbar-right">
        {/* 1. Connection Status Capsule */}
        <div className="pa-popover-anchor" ref={connPopoverAnchorRef}>
          <button
            type="button"
            data-testid="connection-capsule-btn"
            className="pa-conn-capsule-btn"
            aria-label="当前连接来源"
            aria-haspopup="dialog"
            aria-expanded={connectionPopoverOpen}
            onClick={onToggleConnectionPopover}
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
                  ×
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

        {/* 2. Primary Workflow CTA: Complete & Save */}
        {hasSaveableResult && !showOnboarding ? (
          <button
            type="button"
            data-testid="complete-and-save-btn"
            className="pa-btn pa-btn-primary pa-btn-sm"
            aria-expanded={showCompletionView}
            onClick={onToggleCompletionView}
          >
            完成并保存
          </button>
        ) : null}

        {/* 3. "More ⋯" Menu */}
        <div className="pa-popover-anchor">
          <button
            type="button"
            data-testid="more-menu-btn"
            className="pa-btn pa-btn-ghost pa-more-btn"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={moreMenuOpen}
            onClick={onToggleMoreMenu}
          >
            ⋯
          </button>

          {moreMenuOpen ? (
            <div className="pa-dropdown-menu" role="menu" aria-label="更多操作菜单">
              <button
                type="button"
                role="menuitem"
                className="pa-menu-item"
                onClick={onSwitchSidebarMode}
              >
                <span>
                  {sidebarTab === 'builtin' ? '切换到外置 Agent 活动' : '切换到内置模型对话'}
                </span>
                <span className="pa-muted">
                  {sidebarTab === 'builtin' ? '当前：内置' : '当前：外置'}
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                data-testid="theme-toggle-btn"
                aria-label="切换浅色/深色主题"
                aria-pressed={theme === 'dark'}
                className="pa-menu-item"
                onClick={onToggleTheme}
              >
                <span>主题外观</span>
                <span className="pa-muted">
                  {theme === 'light' ? '☀ Light Studio' : '☾ Dark CAD'}
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                className="pa-menu-item"
                onClick={onOpenLocalProjectSelector}
              >
                <span>切换本地项目</span>
                <span className="pa-muted pa-mono">{projectId}</span>
              </button>

              <button
                type="button"
                role="menuitem"
                className="pa-menu-item"
                onClick={onOpenMigrationReport}
              >
                <span>查看旧项目迁移差异报告</span>
              </button>

              {reportExport ? (
                <>
                  <div className="pa-menu-divider" role="separator" />
                  <ReportExportMenu
                    {...reportExport}
                    variant="menu-items"
                    onExportComplete={(msg) => {
                      reportExport.onExportComplete?.(msg)
                      onCloseMoreMenu()
                    }}
                  />
                </>
              ) : null}

              <div className="pa-menu-divider" role="separator" />

              <a
                href="#/desktop-m1-readonly"
                role="menuitem"
                className="pa-menu-item pa-menu-link"
                onClick={onCloseMoreMenu}
              >
                <span>只读授权视图</span>
              </a>
              <a
                href="#/desktop-legacy"
                role="menuitem"
                className="pa-menu-item pa-menu-link"
                onClick={onCloseMoreMenu}
              >
                <span>返回旧工作台</span>
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
