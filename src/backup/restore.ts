/**
 * 完整备份 .cunlian.zip 的空库恢复写入端（V2.2 D 组，规格 §8）。
 *
 * A-03 把纯解析/校验抽到 restoreParser.ts 供 V3 迁移共用；本文件只保留：
 * - `inspectBackup`：校验并返回摘要，不写库；
 * - `restoreBackup`：目标库必须为空，单个 IndexedDB 事务写入全部 store，
 *   任一步失败整体回滚；恢复时清除当前人工确认（历史快照不递归清）。
 *
 * 原错误码、事务顺序与测试注入点保持不变。
 */
import type { Project } from '../domain/types'
import type { SourceBinding } from '../sources/bindings'
import { addChangeEvent, changeEventId } from '../history/events'
import {
  BINDING_STORE_NAME,
  DRAFT_STORE_NAME,
  EVENT_STORE_NAME,
  IMPORT_SNAPSHOT_STORE_NAME,
  MIGRATION_BACKUP_STORE_NAME,
  PROJECT_STORE_NAME,
  SNAPSHOT_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  requestResult,
  transactionDone,
  withDatabase,
} from '../storage/db'
import {
  failure,
  parseBackup,
  type BackupInspection,
  type RestoreResult,
  type RestoreSummary,
} from './restoreParser'

export type {
  BackupInspection,
  ParsedBackup,
  RestoreError,
  RestoreErrorCode,
  RestoreResult,
  RestoreSummary,
} from './restoreParser'

/* -------------------------------------------------------------------------- */
/* 对外接口                                                                   */
/* -------------------------------------------------------------------------- */

/** 只校验并返回摘要，不写数据库；UI 用它显示恢复前确认。 */
export async function inspectBackup(
  bytes: Uint8Array,
): Promise<RestoreResult<BackupInspection>> {
  const parsed = await parseBackup(bytes)
  if (!parsed.ok) {
    return parsed
  }
  return {
    ok: true,
    value: {
      manifest: parsed.value.manifest,
      projectSummaries: parsed.value.manifest.projects,
      counts: parsed.value.manifest.counts,
      createdAt: parsed.value.manifest.createdAt,
      totalUncompressedBytes: parsed.value.manifest.totalUncompressedBytes,
    },
  }
}

const RESTORE_STORES = [
  PROJECT_STORE_NAME,
  DRAFT_STORE_NAME,
  SOURCE_DOCUMENT_STORE_NAME,
  SOURCE_REVISION_STORE_NAME,
  SOURCE_BLOB_STORE_NAME,
  BINDING_STORE_NAME,
  EVENT_STORE_NAME,
  SNAPSHOT_STORE_NAME,
  IMPORT_SNAPSHOT_STORE_NAME,
  MIGRATION_BACKUP_STORE_NAME,
] as const

/**
 * 恢复完整备份到空数据库。
 *
 * 目标库任一业务 store 非空都拒绝，避免覆盖现有项目或与退役历史冲突。
 * 所有校验通过后才开启写事务；失败时事务 abort，任何 store 都不会变化。
 */
export async function restoreBackup(
  bytes: Uint8Array,
  options: {
    now?: string
    /** 仅测试注入：在写入若干 store 后、提交前调用；抛错用于验证整体回滚。 */
    afterPartialWrite?: () => void
  } = {},
): Promise<RestoreResult<RestoreSummary>> {
  const parsed = await parseBackup(bytes)
  if (!parsed.ok) {
    return parsed
  }
  const backup = parsed.value
  const restoredAt = options.now ?? new Date().toISOString()

  try {
    return await withDatabase(async (db) => {
      const transaction = db.transaction([...RESTORE_STORES], 'readwrite')
      const done = transactionDone(transaction)
      try {
        const counts: Record<string, number> = {}
        for (const storeName of RESTORE_STORES) {
          counts[storeName] = await requestResult(
            transaction.objectStore(storeName).count(),
          )
        }
        const nonEmpty = Object.entries(counts).filter(([, count]) => count > 0)
        if (nonEmpty.length > 0) {
          await done
          return failure(
            'database_not_empty',
            '目标数据库不是空库，恢复已取消，未写入任何数据。请先清空或换一个空浏览器配置再恢复。',
            nonEmpty.map(([store, count]) => `${store}=${count}`).join('；'),
          )
        }

        // 恢复时清除人工确认：数值、坐标、哈希与历史不变。
        for (const project of backup.projects) {
          transaction.objectStore(PROJECT_STORE_NAME).add({
            ...project,
            relationReview: null,
          } satisfies Project)
        }
        for (const draft of backup.drafts) {
          transaction.objectStore(DRAFT_STORE_NAME).add(draft)
        }
        for (const document of backup.documents) {
          transaction.objectStore(SOURCE_DOCUMENT_STORE_NAME).add(document)
        }
        for (const revision of backup.revisions) {
          transaction.objectStore(SOURCE_REVISION_STORE_NAME).add(revision)
        }
        for (const blob of backup.blobs) {
          transaction.objectStore(SOURCE_BLOB_STORE_NAME).add({
            blobKey: blob.blobKey,
            projectId: blob.projectId,
            sha256: blob.sha256,
            byteSize: blob.byteSize,
            blob: new Blob([new Uint8Array(blob.bytes)], {
              type: 'application/pdf',
            }),
          })
        }
        // 仅测试注入：此处项目、草稿、文档、版本、Blob 已排入事务，但绑定、
        // 事件、快照与恢复事件尚未写入；抛错应让整个事务回滚。
        options.afterPartialWrite?.()
        for (const binding of backup.bindings) {
          transaction.objectStore(BINDING_STORE_NAME).add({
            ...binding,
            reviewedTermRevision: null,
            reviewedAt: null,
            historicalAcceptance: null,
          } satisfies SourceBinding)
        }
        for (const event of backup.events) {
          transaction.objectStore(EVENT_STORE_NAME).add(event)
        }
        for (const snapshot of backup.snapshots) {
          transaction.objectStore(SNAPSHOT_STORE_NAME).add(snapshot)
        }
        for (const snapshot of backup.importSnapshots) {
          transaction.objectStore(IMPORT_SNAPSHOT_STORE_NAME).add(snapshot)
        }
        for (const migration of backup.migrationBackups) {
          transaction.objectStore(MIGRATION_BACKUP_STORE_NAME).add(migration)
        }
        // 恢复本身是一条历史事件；与数据同事务，失败不会留下孤立事件。
        for (const project of backup.projects) {
          addChangeEvent(transaction, {
            id: `${changeEventId(
              'project_restored_from_bundle',
              project.id,
            )}:${restoredAt}`,
            projectId: project.id,
            type: 'project_restored_from_bundle',
            createdAt: restoredAt,
            message:
              '已从 .cunlian.zip 完整备份恢复；数值、来源文件、绑定坐标与历史保留，人工确认已清除。',
          })
        }

        await done
        return {
          ok: true as const,
          value: {
            projects: backup.projects.map((project) => ({
              id: project.id,
              name: project.name,
            })),
            counts: backup.manifest.counts,
            confirmationsCleared: true as const,
            restoredAt,
          },
        }
      } catch (error) {
        try {
          transaction.abort()
        } catch {
          // 事务可能已结束。
        }
        await done.catch(() => undefined)
        return failure(
          'write_failed',
          '写入恢复数据失败，事务已回滚，数据库未改变。',
          error instanceof Error ? error.message : String(error),
        )
      }
    })
  } catch (error) {
    return failure(
      'storage_failure',
      '打开本地数据库失败，恢复未开始。',
      error instanceof Error ? error.message : String(error),
    )
  }
}
