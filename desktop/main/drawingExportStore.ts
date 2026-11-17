/**
 * 导出文件（PDF/SVG/DXF）的原子落盘（V3-C-04，DXF 复用同一提交序列）。
 *
 * 与 fileStore 相同的提交序列：校验后缀/父目录/非常规文件 → 核对目标指纹 →
 * 同目录唯一临时文件 wx/0600 写满 + fsync → 回读哈希 + 结构校验 → rename 前
 * 再核对目标未变 → 原子 rename → 回读确认。
 *
 * 失败只清理本次创建的临时文件，绝不 truncate/unlink 用户原目标。
 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { nodeFileOps, sha256Bytes, type FileOps, type SaveError } from './fileStore'

export type DrawingExportKind = 'pdf' | 'svg' | 'dxf-r12' | 'dxf-2000'

export const DRAWING_EXPORT_EXTENSION: Record<DrawingExportKind, string> = {
  pdf: '.pdf',
  svg: '.svg',
  'dxf-r12': '.dxf',
  'dxf-2000': '.dxf',
}

export interface DrawingExportSaveOptions {
  targetPath: string
  kind: DrawingExportKind
  bytes: Uint8Array
  /** 对话框确认时磁盘上的目标指纹；null 表示目标应不存在。 */
  expectedFingerprint: string | null
  /** 可选的同步提交门禁，仅已保存版本导出传入；普通草稿导出不受影响。 */
  canCommit?: () => boolean
  verify: (
    bytes: Uint8Array,
  ) => Promise<{ ok: true } | { ok: false; message: string; detail?: string }>
  ops?: FileOps
  newSuffix?: () => string
}

export interface DrawingExportSaveValue {
  path: string
  fingerprint: string
  warnings: string[]
}

export type DrawingExportSaveResult =
  | { ok: true; value: DrawingExportSaveValue }
  | { ok: false; error: SaveError }

function errnoCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

export class DrawingExportStore {
  private readonly ops: FileOps
  private readonly newSuffix: () => string

  constructor(options: { ops?: FileOps; newSuffix?: () => string } = {}) {
    this.ops = options.ops ?? nodeFileOps
    this.newSuffix = options.newSuffix ?? (() => randomUUID())
  }

  async kindOf(targetPath: string): Promise<'missing' | 'file' | 'directory' | 'symlink' | 'other'> {
    return this.ops.statKind(targetPath)
  }

  async fingerprint(targetPath: string): Promise<string | null> {
    const kind = await this.ops.statKind(targetPath)
    if (kind !== 'file') return null
    return sha256Bytes(await this.ops.readFile(targetPath))
  }

  async save(options: DrawingExportSaveOptions): Promise<DrawingExportSaveResult> {
    const ops = options.ops ?? this.ops
    const expectedExtension = DRAWING_EXPORT_EXTENSION[options.kind]
    if (path.extname(options.targetPath).toLowerCase() !== expectedExtension) {
      return {
        ok: false,
        error: { code: 'SAVE_FAILED', message: `导出文件必须以 ${expectedExtension} 结尾` },
      }
    }
    const directory = path.dirname(options.targetPath)
    if ((await ops.statKind(directory)) !== 'directory') {
      return { ok: false, error: { code: 'SAVE_FAILED', message: '目标父目录不存在或不是目录' } }
    }
    const targetKind = await ops.statKind(options.targetPath)
    if (targetKind === 'symlink' || targetKind === 'other' || targetKind === 'directory') {
      return {
        ok: false,
        error: { code: 'SAVE_FAILED', message: '目标不是常规文件（不允许符号链接或目录）' },
      }
    }
    const currentFingerprint =
      targetKind === 'file' ? await sha256Bytes(await ops.readFile(options.targetPath)) : null
    if (options.expectedFingerprint !== currentFingerprint) {
      return {
        ok: false,
        error: {
          code: 'EXTERNAL_MODIFIED',
          message: '目标文件与确认时不一致，已拒绝覆盖',
          detail: `expected=${options.expectedFingerprint ?? 'null'}, actual=${currentFingerprint ?? 'null'}`,
        },
      }
    }

    const warnings: string[] = []
    const tempPath = `${options.targetPath}.${this.newSuffix()}.tmp`
    let tempWritten = false
    try {
      try {
        await ops.writeExclusive(tempPath, options.bytes)
        tempWritten = true
      } catch (error) {
        const code = errnoCode(error)
        return {
          ok: false,
          error:
            code === 'ENOSPC'
              ? { code: 'NO_SPACE', message: '磁盘空间不足，导出已中止', detail: code }
              : code === 'EACCES' || code === 'EPERM' || code === 'EROFS'
                ? { code: 'PERMISSION_DENIED', message: '没有写入目标目录的权限', detail: code }
                : { code: 'WRITE_FAILED', message: '写入临时文件失败，导出已中止', detail: code },
        }
      }

      let tempBytes: Uint8Array
      try {
        tempBytes = await ops.readFile(tempPath)
      } catch (error) {
        return {
          ok: false,
          error: { code: 'VERIFY_FAILED', message: '无法回读临时文件', detail: errnoCode(error) },
        }
      }
      const digest = await sha256Bytes(options.bytes)
      if ((await sha256Bytes(tempBytes)) !== digest) {
        return {
          ok: false,
          error: { code: 'VERIFY_FAILED', message: '临时文件回读哈希与写入内容不一致' },
        }
      }
      const verification = await options.verify(tempBytes)
      if (!verification.ok) {
        return {
          ok: false,
          error: {
            code: 'VERIFY_FAILED',
            message: `导出前结构校验失败：${verification.message}`,
            detail: verification.detail,
          },
        }
      }

      // rename 前最后一次确认目标未变。
      const beforeKind = await ops.statKind(options.targetPath)
      const beforeFingerprint =
        beforeKind === 'file' ? await sha256Bytes(await ops.readFile(options.targetPath)) : null
      if (beforeFingerprint !== currentFingerprint) {
        return {
          ok: false,
          error: { code: 'EXTERNAL_MODIFIED', message: '导出期间目标文件被其它程序修改，已拒绝覆盖' },
        }
      }

      // 同步门禁不等于异步提交锁；已保存版本入口在共同会话事务内调用本方法。
      if (options.canCommit?.() === false) {
        return { ok: false, error: { code: 'BUSY', message: '导出来源已变化，已取消导出' } }
      }
      try {
        await ops.rename(tempPath, options.targetPath)
        tempWritten = false
      } catch (error) {
        const code = errnoCode(error)
        return {
          ok: false,
          error: {
            code: code === 'EACCES' || code === 'EPERM' || code === 'EROFS' ? 'RENAME_FAILED' : 'RENAME_FAILED',
            message: '原子替换失败，原文件保持不变',
            detail: code,
          },
        }
      }

      try {
        await ops.syncDirectory(directory)
      } catch (error) {
        warnings.push(`目录同步失败，持久化未确认（${errnoCode(error) ?? 'unknown'}）；文件已替换。`)
      }

      try {
        const committed = await ops.readFile(options.targetPath)
        if ((await sha256Bytes(committed)) !== digest) {
          return {
            ok: false,
            error: {
              code: 'VERIFY_FAILED',
              message: '文件已替换，但回读校验未通过；持久化状态未确认',
            },
          }
        }
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'VERIFY_FAILED',
            message: '文件已替换，但无法回读确认；持久化状态未确认',
            detail: errnoCode(error),
          },
        }
      }

      return { ok: true, value: { path: options.targetPath, fingerprint: digest, warnings } }
    } finally {
      if (tempWritten) {
        try {
          await ops.remove(tempPath)
        } catch {
          // 清理失败不掩盖原始结果；下一次使用新的随机临时名。
        }
      }
    }
  }
}
