/**
 * 项目文件格式升级（V3.5）：formatVersion 保持 2，项目 schema 6 → 7。
 *
 * 只在用户显式保存或首次需要正式写盘的条款/变更提交时由 main 执行；
 * 打开旧文件不写盘、不产生 dirty。旧的文件版本快照原样保留（schema3/4/5/6），
 * 新增一个 schema7 版本记录作为当前版本；“旧历史不可变”与既有约定一致。
 *
 * 写盘前必须另存可恢复副本（见 desktop/main/migrationBackup.ts）：本函数
 * 只负责内存升级，不承担备份职责。
 */
import type { ProjectFileSnapshot } from './types'
import { PROJECT_FILE_SCHEMA_VERSION } from './types'

export const FORMAT_UPGRADE_NOTICE =
  '已升级为项目文件格式 2（schema 7）：任务书条款与检查证据已启用；历史版本、PDF、模型、图纸与数值均已保留；旧版程序不能打开此文件，且没有无损降级。'

export interface UpgradeOptions {
  now?: () => Date
  newRevisionId?: () => string
}

/**
 * 返回升级后的聚合与新版本 ID；源已是当前 schema 时原样返回并标记 upgraded=false。
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
    // 当前版本记录也必须是 schema7；schema6 文件读入后工作形状虽为 7，
    // 但当前历史记录仍是 6，保存时必须新增一条 7 的版本（旧记录不可变）。
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
          reason: '保存时升级为项目 schema 7（V3.5）',
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
