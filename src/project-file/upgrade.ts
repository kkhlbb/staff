/**
 * 项目文件格式升级（V3-B2）：formatVersion 1 / schema 3 → 2 / 4。
 *
 * 只在用户显式保存时由 main 执行；打开旧文件不写盘、不产生 dirty。
 * 旧的文件版本快照原样保留（schema3），新增一个 schema4 版本记录作为当前版本。
 */
import type { ProjectFileSnapshot } from './types'

export const FORMAT_UPGRADE_NOTICE =
  '已升级为项目文件格式 2（schema 4）：历史版本与数值已保留；B1 及更早程序不能打开此文件，且没有无损降级。'

export interface UpgradeOptions {
  now?: () => Date
  newRevisionId?: () => string
}

/**
 * 返回升级后的聚合与新版本 ID；源已是格式 2 时原样返回并标记 upgraded=false。
 * 调用方必须在真实保存成功后才把结果写回会话。
 */
export function upgradeSnapshotToV2(
  snapshot: ProjectFileSnapshot,
  options: UpgradeOptions = {},
): { snapshot: ProjectFileSnapshot; upgraded: boolean; notice: string | null } {
  if (snapshot.project.sourceFormatVersion !== 1) {
    return { snapshot, upgraded: false, notice: null }
  }
  const now = (options.now ?? (() => new Date()))().toISOString()
  const revisionId =
    options.newRevisionId?.() ?? `rev-${Math.random().toString(36).slice(2, 10)}-upgrade`
  const project = {
    ...snapshot.project,
    schemaVersion: 4 as const,
    sourceFormatVersion: 2 as const,
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
          reason: '保存时升级为格式 2（V3-B2）',
          project,
        },
      ],
    },
    upgraded: true,
    notice: FORMAT_UPGRADE_NOTICE,
  }
}
