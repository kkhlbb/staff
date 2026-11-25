/*
 * M1 Session View (first connection, local project selection, and task activities).
 *
 * Field limitations (do not invent unfrozen fields or transport contracts):
 * - snapshot.connection has no source or clientName, so the view cannot legally show
 *   a connected client name or claim the snapshot is "local Agent" vs "model API".
 *   Entry choice is UI intent only.
 * - No frozen list-projects / connect / takeover APIs; local project list is a
 *   caller-supplied prop; those actions stay unconnected.
 * - Activity statuses do not include a dedicated "tool round-trip" state; use
 *   existing status labels from m1FieldPresentation only.
 */

import { useState } from 'react';
import './ProjectAgentPanel.css';
import {
  M1_SYNTHETIC_BADGE,
  presentM1Context,
  type M1ContextPresentation,
} from './m1FieldPresentation';

export const M1_SESSION_FORMAL_SAVE_ENABLED = false as const;
export const M1_SESSION_PRODUCTION_API_CONNECTED = false as const;

export interface LocalProjectItem {
  readonly projectId: string;
  readonly draftRevision?: string | null;
}

export interface ProjectAgentM1SessionProps {
  readonly context?: unknown;
  readonly synthetic?: boolean;
  readonly localProjects?: readonly LocalProjectItem[];
  readonly onSelectLocalAgent?: () => void;
  readonly onSelectModelApi?: () => void;
  readonly onSkipToLocalProjects?: () => void;
  readonly onSelectProject?: (projectId: string) => void;
  readonly onReconnect?: () => void;
  readonly className?: string;
}

type EntryIntent = 'local-agent' | 'model-api' | 'skip-local' | null;

function getConnectionTone(state: M1ContextPresentation['connection']['state'] | null): string {
  if (state === 'connected') {
    return 'pa-tone-pass';
  }
  if (state === 'connecting') {
    return 'pa-tone-pending';
  }
  return 'pa-tone-muted';
}

function getAuthorizationTone(
  state: M1ContextPresentation['authorization']['state'] | null,
): string {
  if (state === 'authorized-writable') {
    return 'pa-tone-pass';
  }
  if (state === 'authorized-readonly') {
    return 'pa-tone-action';
  }
  return 'pa-tone-muted';
}

function getWriterTone(occupied: boolean): string {
  return occupied ? 'pa-tone-pending' : 'pa-tone-muted';
}

function getActivityToneByLabel(statusLabel: string): string {
  switch (statusLabel) {
    case '已成功':
      return 'pa-tone-pass';
    case '运行中':
      return 'pa-tone-action';
    case '排队中':
    case '等待输入':
    case '已中断':
      return 'pa-tone-pending';
    case '已失败':
      return 'pa-tone-danger';
    case '已取消':
    default:
      return 'pa-tone-muted';
  }
}

export function ProjectAgentM1Session({
  context,
  synthetic = false,
  localProjects = [],
  onSelectLocalAgent,
  onSelectModelApi,
  onSkipToLocalProjects,
  onSelectProject,
  onReconnect,
  className,
}: ProjectAgentM1SessionProps) {
  const [entryIntent, setEntryIntent] = useState<EntryIntent>(null);
  const [showLocalProjects, setShowLocalProjects] = useState(false);

  const hasContextInput = context !== undefined && context !== null;
  const presented = hasContextInput ? presentM1Context(context, { synthetic }) : null;
  const validPresentation: M1ContextPresentation | null =
    presented && presented.ok ? presented.value : null;
  const isInvalidContext = presented !== null && !presented.ok;

  const formalSaveEnabled = M1_SESSION_FORMAL_SAVE_ENABLED;
  const productionApiConnected = M1_SESSION_PRODUCTION_API_CONNECTED;

  const showSyntheticBadge = Boolean(
    validPresentation ? validPresentation.synthetic : synthetic,
  );
  const syntheticBadgeText = validPresentation?.syntheticBadge ?? M1_SYNTHETIC_BADGE;

  const connectionState = validPresentation?.connection.state ?? null;
  const connectionLabel = validPresentation?.connection.label ?? '未连接';
  const authorizationState = validPresentation?.authorization.state ?? null;
  const authorizationLabel = validPresentation?.authorization.label ?? '未授权';
  const writerOccupied = validPresentation?.writer.occupied ?? false;
  const writerLabel = validPresentation?.writer.label ?? '写入位空闲';

  const isDisconnectedWithProject = Boolean(
    validPresentation &&
      validPresentation.projectId &&
      validPresentation.connection.state === 'disconnected',
  );

  const rootClassName = className ? `pa-preview ${className}` : 'pa-preview';

  const handleSelectLocalAgent = () => {
    if (!onSelectLocalAgent) {
      return;
    }
    setEntryIntent('local-agent');
    onSelectLocalAgent();
  };

  const handleSelectModelApi = () => {
    if (!onSelectModelApi) {
      return;
    }
    setEntryIntent('model-api');
    onSelectModelApi();
  };

  const handleSkipToLocalProjects = () => {
    setEntryIntent('skip-local');
    setShowLocalProjects(true);
    onSkipToLocalProjects?.();
  };

  const spacerDraft = validPresentation?.spacerDraft ?? null;

  return (
    <div className={rootClassName}>
      <section className="pa-panel" aria-label="项目助手 M1 会话">
        <header className="pa-header">
          <div className="pa-row">
            <h2 className="pa-title">项目助手会话</h2>
            {showSyntheticBadge ? (
              <span className="pa-pill pa-tone-pending">{syntheticBadgeText}</span>
            ) : null}
          </div>
          <div className="pa-row">
            <span className="pa-pill pa-tone-muted">
              {productionApiConnected ? '已接通' : '生产 API：未接通'}
            </span>
            <button
              type="button"
              className="pa-btn"
              disabled={!formalSaveEnabled}
            >
              正式保存
            </button>
          </div>
        </header>

        <section className="pa-card" aria-label="连接入口">
          <span className="pa-card-label">首次连接与入口选择</span>
          <div className="pa-controls">
            <button
              type="button"
              className={
                entryIntent === 'local-agent' ? 'pa-btn pa-btn-active' : 'pa-btn'
              }
              disabled={!onSelectLocalAgent}
              onClick={handleSelectLocalAgent}
            >
              连接本地 Agent
            </button>
            <button
              type="button"
              className={
                entryIntent === 'model-api' ? 'pa-btn pa-btn-active' : 'pa-btn'
              }
              disabled={!onSelectModelApi}
              onClick={handleSelectModelApi}
            >
              使用模型 API
            </button>
            <button
              type="button"
              className={
                entryIntent === 'skip-local' ? 'pa-btn pa-btn-active' : 'pa-btn'
              }
              onClick={handleSkipToLocalProjects}
            >
              跳过，查看本地项目
            </button>
          </div>
          <p className="pa-muted">
            点击选项只进入配置，界面显示实际连接状态；本层生产传输未接通。
          </p>
        </section>

        <div className="pa-grid">
          <section className="pa-card" aria-label={`连接：${connectionLabel}`}>
            <span className="pa-card-label">连接状态</span>
            <div className="pa-row">
              <span className={`pa-pill ${getConnectionTone(connectionState)}`}>
                {connectionLabel}
              </span>
            </div>
          </section>
          <section className="pa-card" aria-label={`授权：${authorizationLabel}`}>
            <span className="pa-card-label">项目授权</span>
            <div className="pa-row">
              <span className={`pa-pill ${getAuthorizationTone(authorizationState)}`}>
                {authorizationLabel}
              </span>
            </div>
          </section>
          <section className="pa-card" aria-label={`写入：${writerLabel}`}>
            <span className="pa-card-label">写入位</span>
            <div className="pa-row">
              <span className={`pa-pill ${getWriterTone(writerOccupied)}`}>
                {writerLabel}
              </span>
            </div>
          </section>
        </div>

        {isInvalidContext ? (
          <div className="pa-notice" role="alert">
            当前上下文无效，已保持未接通状态，未载入任何项目或活动数据。
          </div>
        ) : null}

        {isDisconnectedWithProject && validPresentation ? (
          <div className="pa-notice" role="status">
            <div className="pa-header">
              <span>
                连接已断开 · 项目{' '}
                <span className="pa-mono">{validPresentation.projectId}</span> · 版本{' '}
                <span className="pa-mono">
                  {validPresentation.draftRevision ?? '无'}
                </span>
              </span>
              <button
                type="button"
                className="pa-btn"
                disabled={!onReconnect}
                onClick={() => {
                  onReconnect?.();
                }}
              >
                重新连接
              </button>
            </div>
            <p className="pa-muted">已保留当前结果，断线不等于取消。</p>
          </div>
        ) : null}

        {showLocalProjects ? (
          <section className="pa-card" aria-label="本地项目列表">
            <span className="pa-card-label">本地项目</span>
            {localProjects.length === 0 ? (
              <p className="pa-muted">无可列本地项目</p>
            ) : (
              <ul className="pa-list">
                {localProjects.map((project) => (
                  <li key={project.projectId} className="pa-check">
                    <div className="pa-row">
                      <span className="pa-mono">{project.projectId}</span>
                      {project.draftRevision ? (
                        <span className="pa-muted pa-mono">
                          版本 {project.draftRevision}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="pa-btn"
                      disabled={!onSelectProject}
                      aria-label={`选择项目 ${project.projectId}`}
                      onClick={() => {
                        onSelectProject?.(project.projectId);
                      }}
                    >
                      选择项目
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {validPresentation ? (
          <>
            <section className="pa-card" aria-label="当前项目">
              <span className="pa-card-label">当前项目与草稿版本</span>
              <div className="pa-row">
                <span>
                  项目：<span className="pa-mono">{validPresentation.projectId}</span>
                </span>
                <span>
                  草稿版本：
                  <span className="pa-mono">
                    {validPresentation.draftRevision ?? '无'}
                  </span>
                </span>
              </div>
            </section>

            {spacerDraft ? (
              <section className="pa-card" aria-label="隔套草稿">
                <div className="pa-header">
                  <span className="pa-card-label">隔套草稿</span>
                  <span className="pa-muted">
                    版本 <span className="pa-mono">{spacerDraft.draftRevision}</span>
                  </span>
                </div>
                <ul className="pa-list">
                  {(
                    [
                      {
                        key: 'innerDiameterQ',
                        label: '内径',
                        valueMm: spacerDraft.innerDiameterMm,
                        source: spacerDraft.sources.innerDiameterQ,
                      },
                      {
                        key: 'outerDiameterQ',
                        label: '外径',
                        valueMm: spacerDraft.outerDiameterMm,
                        source: spacerDraft.sources.outerDiameterQ,
                      },
                      {
                        key: 'lengthQ',
                        label: '长度',
                        valueMm: spacerDraft.lengthMm,
                        source: spacerDraft.sources.lengthQ,
                      },
                    ] as const
                  ).map((dimension) => {
                    const excerpt =
                      typeof dimension.source.anchor?.excerpt === 'string' &&
                      dimension.source.anchor.excerpt.trim().length > 0
                        ? dimension.source.anchor.excerpt
                        : null;

                    return (
                      <li key={dimension.key} className="pa-check">
                        <div className="pa-row">
                          <span>{dimension.label}</span>
                          <span className="pa-mono">{dimension.valueMm} mm</span>
                        </div>
                        <div className="pa-row">
                          <span className="pa-pill pa-tone-muted">
                            {dimension.source.label}
                          </span>
                          {excerpt ? <span className="pa-muted">{excerpt}</span> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {spacerDraft.question ? (
                  <div className="pa-notice">
                    <span className="pa-pill pa-tone-pending">
                      {spacerDraft.question.reasonLabel}
                    </span>{' '}
                    <span>{spacerDraft.question.prompt}</span>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="pa-card" aria-label="任务活动">
              <span className="pa-card-label">任务活动</span>
              {validPresentation.activities.length === 0 ? (
                <p className="pa-muted">暂无任务活动</p>
              ) : (
                <ul className="pa-list">
                  {validPresentation.activities.map((activity) => {
                    const lastStep =
                      typeof activity.lastStep === 'string' &&
                      activity.lastStep.trim().length > 0
                        ? activity.lastStep
                        : null;

                    return (
                      <li key={activity.taskId} className="pa-card">
                        <div className="pa-header">
                          <span className="pa-mono">{activity.taskId}</span>
                          <span
                            className={`pa-pill ${getActivityToneByLabel(activity.statusLabel)}`}
                          >
                            {activity.statusLabel}
                          </span>
                        </div>
                        {lastStep ? <p className="pa-muted">{lastStep}</p> : null}
                        {activity.question ? (
                          <div className="pa-notice">
                            <span className="pa-pill pa-tone-pending">
                              {activity.question.reasonLabel}
                            </span>{' '}
                            <span>{activity.question.prompt}</span>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </section>
    </div>
  );
}
