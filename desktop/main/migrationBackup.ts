/**
 * V3.5：迁移前可恢复副本（任务卡 §3/§8-A）。
 *
 * 关键约束（任务卡 §2 的既有缺口）：
 * - 副本必须是**最终文件**，不是 `.tmp` 临时文件；同目录、唯一命名、独占创建；
 * - 副本必须覆盖 PDF、模型、图纸引用、历史与草稿——`.cunlian` 容器本身把这些
 *   全部装在同一个 ZIP 里（attachments/、revisions/、history/、workspace/draft.json），
 *   因此整文件字节副本即完整可恢复来源；
 * - 写后必须回读并比对 SHA-256；不一致即失败；
 * - 备份失败必须阻止升级，原文件保持不变。
 */
import path from 'node:path'
import { PROJECT_FILE_EXTENSION } from '../../src/project-file/types'
import { sha256Bytes, type FileOps } from './fileStore'

export type MigrationBackupErrorCode =
  | 'BACKUP_FAILED'
  | 'BACKUP_VERIFY_FAILED'
  | 'BACKUP_SOURCE_UNREADABLE'
  | 'BACKUP_SOURCE_CHANGED'

export interface MigrationBackupError {
  code: MigrationBackupErrorCode
  message: string
  detail?: string
}

/** 备份记录：原路径、副本路径、字节数与哈希；随保存警告一起展示。 */
export interface MigrationBackupRecord {
  originalPath: string
  backupPath: string
  sha256: string
  byteSize: number
  createdAt: string
}

export type MigrationBackupResult =
  | { ok: true; value: MigrationBackupRecord }
  | { ok: false; error: MigrationBackupError }

export interface MigrationBackupOptions {
  ops: FileOps
  originalPath: string
  /** 打开时记录的磁盘指纹；不一致说明文件已被外部改动，先拒绝。 */
  expectedFingerprint: string | null
  now: () => Date
  newSuffix: () => string
}

/** `.pre-v35.<唯一标识>.cunlian`；唯一标识由调用方注入，测试可复现。 */
export function migrationBackupPath(originalPath: string, suffix: string): string {
  return `${originalPath}.pre-v35.${suffix}${PROJECT_FILE_EXTENSION}`
}

function errnoOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : 'unknown'
}

/**
 * 创建并校验迁移前副本；任何失败都不改动原文件。
 * 调用方必须在成功保存后才把记录写入会话。
 */
export async function createMigrationBackup(
  options: MigrationBackupOptions,
): Promise<MigrationBackupResult> {
  const { ops, originalPath } = options
  const kind = await ops.statKind(originalPath)
  if (kind !== 'file') {
    return {
      ok: false,
      error: {
        code: 'BACKUP_SOURCE_UNREADABLE',
        message: '迁移前备份失败：原项目文件不存在或不是常规文件，已阻止升级。',
        detail: kind,
      },
    }
  }

  let bytes: Uint8Array
  try {
    bytes = await ops.readFile(originalPath)
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'BACKUP_SOURCE_UNREADABLE',
        message: '迁移前备份失败：无法读取原项目文件，已阻止升级。',
        detail: `${errnoOf(error)}: ${error instanceof Error ? error.message : String(error)}`,
      },
    }
  }
  const sha256 = await sha256Bytes(bytes)
  if (options.expectedFingerprint !== null && sha256 !== options.expectedFingerprint) {
    return {
      ok: false,
      error: {
        code: 'BACKUP_SOURCE_CHANGED',
        message: '迁移前备份失败：原项目文件已被外部修改，已阻止升级。',
        detail: `expected=${options.expectedFingerprint}, actual=${sha256}`,
      },
    }
  }

  const directory = path.dirname(originalPath)
  let backupPath = migrationBackupPath(originalPath, options.newSuffix())
  // 唯一名冲突时最多重试 3 次；仍失败即阻止升级，绝不覆盖已有副本。
  let created = false
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const existing = await ops.statKind(backupPath)
    if (existing !== 'missing') {
      backupPath = migrationBackupPath(originalPath, options.newSuffix())
      continue
    }
    try {
      await ops.writeExclusive(backupPath, bytes)
      created = true
    } catch (error) {
      if (errnoOf(error) === 'EEXIST') {
        backupPath = migrationBackupPath(originalPath, options.newSuffix())
        continue
      }
      return {
        ok: false,
        error: {
          code: 'BACKUP_FAILED',
          message: '迁移前备份失败：无法写入副本，已阻止升级。',
          detail: `${errnoOf(error)}: ${error instanceof Error ? error.message : String(error)}`,
        },
      }
    }
  }
  if (!created) {
    return {
      ok: false,
      error: {
        code: 'BACKUP_FAILED',
        message: '迁移前备份失败：无法获得唯一副本文件名，已阻止升级。',
        detail: backupPath,
      },
    }
  }

  try {
    const readBack = await ops.readFile(backupPath)
    const readBackSha = await sha256Bytes(readBack)
    if (readBackSha !== sha256 || readBack.byteLength !== bytes.byteLength) {
      return {
        ok: false,
        error: {
          code: 'BACKUP_VERIFY_FAILED',
          message: '迁移前备份失败：副本回读哈希与原文不一致，已阻止升级。',
          detail: `source=${sha256}, backup=${readBackSha}`,
        },
      }
    }
    // 副本已完整落盘；目录同步失败只影响掉电后的可见性，明确警告而不是谎报。
    await ops.syncDirectory(directory)
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'BACKUP_VERIFY_FAILED',
        message: '迁移前备份失败：无法回读确认副本，已阻止升级。',
        detail: `${errnoOf(error)}: ${error instanceof Error ? error.message : String(error)}`,
      },
    }
  }

  return {
    ok: true,
    value: {
      originalPath,
      backupPath,
      sha256,
      byteSize: bytes.byteLength,
      createdAt: options.now().toISOString(),
    },
  }
}

/** 面向用户的保存警告；明确副本路径与哈希，便于恢复核对。 */
export function migrationBackupNotice(record: MigrationBackupRecord): string {
  return `迁移前已创建可恢复副本：${record.backupPath}（SHA-256 ${record.sha256}，${record.byteSize} 字节），原文件 ${record.originalPath}。`
}
