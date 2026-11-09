/**
 * 项目文件格式升级（V3-C-03）：formatVersion 保持 2，项目 schema 3/4 → 5。
 *
 * 只在用户显式保存时由 main 执行；打开旧文件不写盘、不产生 dirty。
 * 旧的文件版本快照原样保留（schema3/schema4），新增一个 schema5 版本记录作为
 * 当前版本；“旧历史不可变”与 A/B2 的既有约定一致。
 */
import type { ProjectFileSnapshot } from './types'
import { PROJECT_FILE_SCHEMA_VERSION } from './types'

export const FORMAT_UPGRADE_NOTICE =
  '已升级为项目文件格式 2（schema 5）：历史版本与数值已保留；B1/B2 及更早程序不能打开此文件，且没有无损降级。'

export interface UpgradeOptions {
  now?: () => Date
  newRevisionId?: () => string
}

/**
 * 返回升级后的聚合与新版本 ID；源已是格式 2 时原样返回并标记 upgraded=false。
 * 调用方必须在真实保存成功后才把结果写回会话。
 */
export function upgradeSnapshotToCurrent(
  snapshot: ProjectFileSnapshot,
  options: UpgradeOptions = {},
): { snapshot: ProjectFileSnapshot; upgraded: boolean; notice: string | null } {
  const currentRevision = snapshot.fileRevisions.find(
    (revision) => revision.revisionId === snapshot.project.currentRevisionId,
  )
  if (
    snapshot.project.schemaVersion === PROJECT_FILE_SCHEMA_VERSION &&
    snapshot.project.sourceFormatVersion === 2 &&
    // 当前版本记录也必须是 schema5；schema4 文件读入后工作形状虽为 5，
    // 但当前历史记录仍是 4，保存时必须新增一条 5 的版本（旧记录不可变）。
    currentRevision?.project.schemaVersion === PROJECT_FILE_SCHEMA_VERSION
  ) {
    return { snapshot, upgraded: false, notice: null }
  }
  const now = (options.now ?? (() => new Date()))().toISOString()
  const revisionId =
    options.newRevisionId?.() ?? `rev-${Math.random().toString(36).slice(2, 10)}-upgrade`
  const project: ProjectFileSnapshot['project'] = {
    ...snapshot.project,
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    sourceFormatVersion: 2,
    currentRevisionId: revisionId,
    updatedAt: now,
  }
  return {
    snapshot: {
      ...snapshot,
      project,
      fileRevisions: [
        ...snapshot.fileRevisions,
        {
          revisionId,
          createdAt: now,
          parentId: snapshot.project.currentRevisionId,
          reason: '保存时升级为项目 schema 5（V3-C）',
          project,
        },
      ],
    },
    upgraded: true,
    notice: FORMAT_UPGRADE_NOTICE,
  }
}

/** A/B2 的旧函数名保留为别名，避免调用方在 C 内重复改两遍。 */
export const upgradeSnapshotToV2 = upgradeSnapshotToCurrent
