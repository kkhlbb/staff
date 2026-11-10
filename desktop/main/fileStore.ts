/**
 * 项目文件的磁盘 I/O（A-02）。
 *
 * 原子保存序列（任务卡 §4.2）：
 * 1. 校验目标后缀、父目录、目标必须是常规文件（非符号链接）；
 * 2. 用期望指纹核对磁盘现状，不一致返回 EXTERNAL_MODIFIED；
 * 3. 同目录 `<目标名>.<uuid>.tmp` 独占创建（wx）、0600 写入、fsync；
 * 4. 从临时文件回读，核对大小/哈希并执行完整打开校验；
 * 5. rename 前再次核对目标指纹未变，然后同目录 rename；
 * 6. rename 是提交点；随后尽力同步父目录并回读目标确认哈希。
 *
 * 任何一步失败都不能破坏原文件：只允许清理本次生成的临时文件，不 truncate/
 * unlink 原目标。错误按 errno 映射成保存码，日志保留底层 errno，UI 不暴露堆栈。
 */
import { createHash, randomUUID } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { PROJECT_FILE_EXTENSION, PROJECT_FILE_MAX_SOURCE_BYTES } from '../../src/project-file/types'

export type SaveErrorCode =
  | 'PERMISSION_DENIED'
  | 'NO_SPACE'
  | 'WRITE_FAILED'
  | 'VERIFY_FAILED'
  | 'RENAME_FAILED'
  | 'EXTERNAL_MODIFIED'
  | 'BUSY'
  | 'SAVE_FAILED'

export interface SaveError {
  code: SaveErrorCode
  message: string
  detail?: string
}

export type SaveResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SaveError }

export type FileKind = 'missing' | 'file' | 'directory' | 'symlink' | 'other'

/** 文件系统端口；默认实现走 node:fs，测试可注入故障。 */
export interface FileOps {
  statKind(targetPath: string): Promise<FileKind>
  readFile(targetPath: string): Promise<Uint8Array>
  /** 独占创建（wx）+ 0600 + 写满 + fsync + close。 */
  writeExclusive(targetPath: string, bytes: Uint8Array): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(targetPath: string): Promise<void>
  syncDirectory(directoryPath: string): Promise<void>
}

export const nodeFileOps: FileOps = {
  async statKind(targetPath) {
    try {
      const info = await fsp.lstat(targetPath)
      if (info.isSymbolicLink()) return 'symlink'
      if (info.isFile()) return 'file'
      if (info.isDirectory()) return 'directory'
      return 'other'
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return 'missing'
      throw error
    }
  },

  async readFile(targetPath) {
    const buffer = await fsp.readFile(targetPath)
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  },

  async writeExclusive(targetPath, bytes) {
    const handle = await fsp.open(targetPath, 'wx', 0o600)
    try {
      let offset = 0
      while (offset < bytes.byteLength) {
        const { bytesWritten } = await handle.write(
          bytes,
          offset,
          bytes.byteLength - offset,
        )
        if (bytesWritten <= 0) {
          throw new ShortWriteError(offset, bytes.byteLength)
        }
        offset += bytesWritten
      }
      await handle.sync()
    } finally {
      await handle.close()
    }
  },

  async rename(from, to) {
    await fsp.rename(from, to)
  },

  async remove(targetPath) {
    await fsp.unlink(targetPath)
  },

  async syncDirectory(directoryPath) {
    const handle = await fsp.open(directoryPath, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
}

/** 短写：底层只写入部分字节；必须按 WRITE_FAILED 处理，不能当成功。 */
export class ShortWriteError extends Error {
  readonly written: number
  readonly expected: number

  constructor(written: number, expected: number) {
    super(`短写：只写入 ${written}/${expected} 字节`)
    this.name = 'ShortWriteError'
    this.written = written
    this.expected = expected
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

function errnoCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function mapWriteError(error: unknown): SaveError {
  const errno = errnoCode(error)
  const detail = `${errno ?? 'unknown'}: ${error instanceof Error ? error.message : String(error)}`
  if (error instanceof ShortWriteError) {
    return { code: 'WRITE_FAILED', message: '写入不完整，保存已中止', detail: error.message }
  }
  if (errno === 'EACCES' || errno === 'EPERM') {
    return { code: 'PERMISSION_DENIED', message: '没有写入目标目录的权限', detail }
  }
  if (errno === 'ENOSPC' || errno === 'EDQUOT') {
    return { code: 'NO_SPACE', message: '磁盘空间不足，保存已中止', detail }
  }
  if (errno === 'EROFS') {
    return { code: 'PERMISSION_DENIED', message: '目标位于只读文件系统', detail }
  }
  return { code: 'WRITE_FAILED', message: '写入临时文件失败，保存已中止', detail }
}

function mapRenameError(error: unknown): SaveError {
  const errno = errnoCode(error)
  const detail = `${errno ?? 'unknown'}: ${error instanceof Error ? error.message : String(error)}`
  if (errno === 'EACCES' || errno === 'EPERM' || errno === 'EROFS') {
    return { code: 'RENAME_FAILED', message: '没有权限替换目标文件', detail }
  }
  if (errno === 'ENOSPC') {
    return { code: 'NO_SPACE', message: '磁盘空间不足，替换失败', detail }
  }
  return { code: 'RENAME_FAILED', message: '原子替换失败，原文件保持不变', detail }
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex')
}

export interface VerifyBytes {
  /** 完整打开校验；返回错误表示不能提交。 */
  (bytes: Uint8Array): Promise<{ ok: true } | { ok: false; code: string; message: string; detail?: string }>
}

export interface SaveAtomicOptions {
  targetPath: string
  bytes: Uint8Array
  /** null 表示调用方认为目标尚不存在；非 null 时磁盘指纹必须一致。 */
  expectedFingerprint: string | null
  verify: VerifyBytes
  ops?: FileOps
  newSuffix?: () => string
}

export interface SaveAtomicValue {
  path: string
  fingerprint: string
  warnings: string[]
}

export class FileStore {
  private readonly ops: FileOps
  private readonly newSuffix: () => string

  constructor(options: { ops?: FileOps; newSuffix?: () => string } = {}) {
    this.ops = options.ops ?? nodeFileOps
    this.newSuffix = options.newSuffix ?? (() => randomUUID())
  }

  /** 迁移前副本与保存必须使用同一组文件端口，避免测试/产物走真实磁盘。 */
  get fileOps(): FileOps {
    return this.ops
  }

  /** 读取项目文件字节与磁盘指纹；不做业务解析。 */
  async readProjectFile(
    targetPath: string,
  ): Promise<SaveResult<{ bytes: Uint8Array; fingerprint: string }>> {
    const kind = await this.safeStatKind(targetPath)
    if (!kind.ok) {
      return kind
    }
    if (kind.value === 'missing') {
      return { ok: false, error: { code: 'SAVE_FAILED', message: '项目文件不存在' } }
    }
    if (kind.value !== 'file') {
      return {
        ok: false,
        error: { code: 'SAVE_FAILED', message: '目标不是常规文件（不允许符号链接或目录）' },
      }
    }
    let bytes: Uint8Array
    try {
      bytes = await this.ops.readFile(targetPath)
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'SAVE_FAILED',
          message: '读取项目文件失败',
          detail: errnoCode(error) ?? String(error),
        },
      }
    }
    if (bytes.byteLength > PROJECT_FILE_MAX_SOURCE_BYTES) {
      return {
        ok: false,
        error: { code: 'SAVE_FAILED', message: '项目文件超过 150 MiB 输入上限' },
      }
    }
    return { ok: true, value: { bytes, fingerprint: await sha256Bytes(bytes) } }
  }

  async fingerprint(targetPath: string): Promise<string | null> {
    const kind = await this.safeStatKind(targetPath)
    if (!kind.ok || kind.value !== 'file') {
      return null
    }
    return sha256Bytes(await this.ops.readFile(targetPath))
  }

  /** 只查文件类型，不读内容；用于把“文件不存在/不是常规文件”映射成 NOT_FOUND。 */
  async kindOf(targetPath: string): Promise<FileKind> {
    return this.ops.statKind(targetPath)
  }

  async saveAtomic(options: SaveAtomicOptions): Promise<SaveResult<SaveAtomicValue>> {
    const ops = options.ops ?? this.ops
    const suffix = (options.newSuffix ?? this.newSuffix)()
    const targetPath = options.targetPath
    const warnings: string[] = []

    if (path.extname(targetPath).toLowerCase() !== PROJECT_FILE_EXTENSION) {
      return {
        ok: false,
        error: {
          code: 'SAVE_FAILED',
          message: `项目文件必须以 ${PROJECT_FILE_EXTENSION} 结尾`,
        },
      }
    }
    const directory = path.dirname(targetPath)
    const directoryKind = await this.safeStatKindWith(ops, directory)
    if (!directoryKind.ok) {
      return directoryKind
    }
    if (directoryKind.value !== 'directory') {
      return {
        ok: false,
        error: { code: 'SAVE_FAILED', message: '目标父目录不存在或不是目录' },
      }
    }

    const targetKind = await this.safeStatKindWith(ops, targetPath)
    if (!targetKind.ok) {
      return targetKind
    }
    if (targetKind.value === 'symlink' || targetKind.value === 'other' || targetKind.value === 'directory') {
      return {
        ok: false,
        error: { code: 'SAVE_FAILED', message: '目标不是常规文件（不允许符号链接或目录）' },
      }
    }

    let currentFingerprint: string | null = null
    if (targetKind.value === 'file') {
      try {
        currentFingerprint = await sha256Bytes(await ops.readFile(targetPath))
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'SAVE_FAILED',
            message: '无法读取现有目标文件，未做任何写入',
            detail: errnoCode(error) ?? String(error),
          },
        }
      }
    }
    if (options.expectedFingerprint !== currentFingerprint) {
      return {
        ok: false,
        error: {
          code: 'EXTERNAL_MODIFIED',
          message: '磁盘上的项目文件与打开时不一致，已拒绝覆盖',
          detail:
            currentFingerprint === null
              ? '目标文件已不存在'
              : `期望 ${options.expectedFingerprint ?? '不存在'}，实际 ${currentFingerprint}`,
        },
      }
    }

    const tempPath = `${targetPath}.${suffix}.tmp`
    let tempWritten = false
    try {
      try {
        await ops.writeExclusive(tempPath, options.bytes)
        tempWritten = true
      } catch (error) {
        return { ok: false, error: mapWriteError(error) }
      }

      let tempBytes: Uint8Array
      try {
        tempBytes = await ops.readFile(tempPath)
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'VERIFY_FAILED',
            message: '无法回读临时文件，保存已中止',
            detail: errnoCode(error) ?? String(error),
          },
        }
      }
      const expectedDigest = await sha256Bytes(options.bytes)
      if ((await sha256Bytes(tempBytes)) !== expectedDigest) {
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
            message: '保存前自校验失败，原文件保持不变',
            detail: `${verification.code}: ${verification.message}`,
          },
        }
      }

      // rename 前最后一次确认目标指纹未变（外部进程可能在这期间改文件）。
      let beforeRenameFingerprint: string | null = null
      const beforeRenameKind = await ops.statKind(targetPath)
      if (beforeRenameKind === 'file') {
        beforeRenameFingerprint = await sha256Bytes(await ops.readFile(targetPath))
      }
      if (beforeRenameFingerprint !== currentFingerprint) {
        return {
          ok: false,
          error: {
            code: 'EXTERNAL_MODIFIED',
            message: '保存期间目标文件被其它程序修改，已拒绝覆盖',
          },
        }
      }

      try {
        await ops.rename(tempPath, targetPath)
        tempWritten = false
      } catch (error) {
        return { ok: false, error: mapRenameError(error) }
      }

      // rename 已提交；后续失败只报告“已替换但持久化/校验未确认”，不回滚。
      try {
        await ops.syncDirectory(directory)
      } catch (error) {
        warnings.push(
          `目录同步失败，持久化未确认（${errnoCode(error) ?? 'unknown'}）；文件已替换。`,
        )
      }

      try {
        const committedBytes = await ops.readFile(targetPath)
        if ((await sha256Bytes(committedBytes)) !== expectedDigest) {
          return {
            ok: false,
            error: {
              code: 'VERIFY_FAILED',
              message: '文件已替换，但回读校验未通过；原文件已被新内容替换',
              detail: '持久化状态未确认，请重新打开检查',
            },
          }
        }
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'VERIFY_FAILED',
            message: '文件已替换，但无法回读确认；持久化状态未确认',
            detail: errnoCode(error) ?? String(error),
          },
        }
      }

      return { ok: true, value: { path: targetPath, fingerprint: expectedDigest, warnings } }
    } finally {
      if (tempWritten) {
        try {
          await ops.remove(tempPath)
        } catch {
          // 清理失败不掩盖原始结果；下次保存使用新的随机临时名。
        }
      }
    }
  }

  private async safeStatKind(targetPath: string): Promise<SaveResult<FileKind>> {
    return this.safeStatKindWith(this.ops, targetPath)
  }

  private async safeStatKindWith(
    ops: FileOps,
    targetPath: string,
  ): Promise<SaveResult<FileKind>> {
    try {
      return { ok: true, value: await ops.statKind(targetPath) }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'SAVE_FAILED',
          message: '无法访问目标路径',
          detail: errnoCode(error) ?? String(error),
        },
      }
    }
  }
}
