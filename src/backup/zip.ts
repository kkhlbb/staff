/**
 * .cunlian.zip 的 ZIP 读写封装（V2.2 D 组）。
 *
 * 使用成熟库 @zip.js/zip.js 2.24.0（BSD-3-Clause），只在浏览器/Node 的
 * 内存中处理备份，不依赖文件系统，也不把条目直接解压到磁盘。
 *
 * 安全边界：
 * - 条目总数 ≤ 500；
 * - 解压后总字节 ≤ 150 MiB（先按中央目录声明值预检，再按实际解压字节复核）；
 * - 拒绝绝对路径、`..`、反斜杠、盘符、控制字符、尾随点/空格、符号链接、
 *   加密条目与目录条目；
 * - 规范化（NFC + 小写）后重名直接拒绝，避免大小写不敏感文件系统上的覆盖；
 * - 单个条目声明大小与实际解压大小必须一致，防止“声明很小、实际膨胀”的炸弹。
 *
 * 本模块只负责 ZIP 结构安全，不理解业务文件；manifest、哈希与引用校验在
 * backup/restore.ts 中完成。
 */
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js'

/** 规格 §8：初始限制 500 条目。含 manifest.json 本身。 */
export const MAX_BACKUP_ENTRIES = 500
/** 规格 §8：解压后总大小 150 MiB。 */
export const MAX_BACKUP_UNCOMPRESSED_BYTES = 150 * 1024 * 1024

export type ZipSafetyErrorCode =
  | 'invalid_zip'
  | 'too_many_entries'
  | 'too_large'
  | 'unsafe_path'
  | 'duplicate_entry'

export interface ZipSafetyError {
  code: ZipSafetyErrorCode
  message: string
  detail?: string
}

export type ZipSafetyResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ZipSafetyError }

export interface ZipWriteEntry {
  /** 必须是已通过 validateEntryPath 的相对路径。 */
  path: string
  bytes: Uint8Array
  /** 0 = 仅存储；PDF 等已压缩数据可跳过 deflate。 */
  level?: number
}

const SEGMENT_PATTERN = /^[A-Za-z0-9._%!*'()~-]+$/

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

/**
 * 返回 null 表示路径安全；否则返回面向用户的原因。
 *
 * 只接受“每段由 ASCII 字母/数字/安全符号组成”的相对路径。项目 ID 等
 * 动态片段在生成路径时用 encodeURIComponent 编码，因此 `%` 是合法的。
 */
export function validateEntryPath(name: string): string | null {
  if (name.length === 0) {
    return 'ZIP 条目名为空'
  }
  if (name.length > 240) {
    return 'ZIP 条目名过长（超过 240 字符）'
  }
  if (hasControlCharacter(name)) {
    return 'ZIP 条目名包含控制字符'
  }
  if (name.includes('\\')) {
    return 'ZIP 条目名包含反斜杠，可能是 Windows 路径变体'
  }
  if (name.startsWith('/')) {
    return 'ZIP 条目名是绝对路径'
  }
  if (/^[A-Za-z]:/.test(name)) {
    return 'ZIP 条目名包含盘符'
  }
  const segments = name.split('/')
  for (const segment of segments) {
    if (segment === '') {
      return 'ZIP 条目名包含空路径段'
    }
    if (segment === '.' || segment === '..') {
      return 'ZIP 条目名包含路径穿越段（. 或 ..）'
    }
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      return 'ZIP 条目名以点或空格结尾，可能在不同文件系统上被改写'
    }
    if (!SEGMENT_PATTERN.test(segment)) {
      return `ZIP 条目名包含不允许的字符：${segment}`
    }
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return `ZIP 条目名包含无效的百分号编码：${segment}`
    }
    if (
      decoded.includes('/') ||
      decoded.includes('\\') ||
      decoded === '.' ||
      decoded === '..' ||
      hasControlCharacter(decoded)
    ) {
      return `ZIP 条目名解码后包含路径穿越或控制字符：${segment}`
    }
  }
  return null
}

/** 规范化重名比较：NFC + 小写，覆盖 macOS/Windows 的大小写与 Unicode 变体。 */
export function normalizedEntryName(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

/**
 * 读取并安全校验 ZIP，返回按名称索引的字节内容。
 *
 * 所有结构检查在返回任何业务数据之前完成；调用方不得在失败时使用部分条目。
 */
export async function readZipEntries(
  bytes: Uint8Array,
): Promise<ZipSafetyResult<Map<string, Uint8Array>>> {
  let reader: ZipReader<Uint8Array> | null = null
  try {
    reader = new ZipReader(new Uint8ArrayReader(bytes), {
      useWebWorkers: false,
    })
    const entries = await reader.getEntries()

    if (entries.length > MAX_BACKUP_ENTRIES) {
      return {
        ok: false,
        error: {
          code: 'too_many_entries',
          message: `ZIP 条目数 ${entries.length} 超过上限 ${MAX_BACKUP_ENTRIES}`,
        },
      }
    }

    const seen = new Set<string>()
    let declaredTotal = 0
    for (const entry of entries) {
      if (entry.directory) {
        return {
          ok: false,
          error: {
            code: 'invalid_zip',
            message: `ZIP 包含目录条目：${entry.filename}`,
          },
        }
      }
      if (entry.symlink) {
        return {
          ok: false,
          error: {
            code: 'invalid_zip',
            message: `ZIP 包含符号链接条目：${entry.filename}`,
          },
        }
      }
      if (entry.encrypted) {
        return {
          ok: false,
          error: {
            code: 'invalid_zip',
            message: `ZIP 包含加密条目，本工具不支持：${entry.filename}`,
          },
        }
      }
      const pathError = validateEntryPath(entry.filename)
      if (pathError !== null) {
        return {
          ok: false,
          error: {
            code: 'unsafe_path',
            message: `不安全的 ZIP 条目：${entry.filename}`,
            detail: pathError,
          },
        }
      }
      const normalized = normalizedEntryName(entry.filename)
      if (seen.has(normalized)) {
        return {
          ok: false,
          error: {
            code: 'duplicate_entry',
            message: `ZIP 包含重复条目：${entry.filename}`,
          },
        }
      }
      seen.add(normalized)

      const size = entry.uncompressedSize
      if (!Number.isSafeInteger(size) || size < 0) {
        return {
          ok: false,
          error: {
            code: 'invalid_zip',
            message: `ZIP 条目大小无效：${entry.filename}`,
          },
        }
      }
      declaredTotal += size
      if (declaredTotal > MAX_BACKUP_UNCOMPRESSED_BYTES) {
        return {
          ok: false,
          error: {
            code: 'too_large',
            message: `ZIP 解压后总大小超过 ${MAX_BACKUP_UNCOMPRESSED_BYTES} 字节（150 MiB）`,
          },
        }
      }
    }

    const contents = new Map<string, Uint8Array>()
    let actualTotal = 0
    for (const entry of entries) {
      if (!('getData' in entry)) {
        return {
          ok: false,
          error: {
            code: 'invalid_zip',
            message: `ZIP 包含无法读取的目录条目：${entry.filename}`,
          },
        }
      }
      const data = await entry.getData(new Uint8ArrayWriter())
      if (data.length !== entry.uncompressedSize) {
        return {
          ok: false,
          error: {
            code: 'invalid_zip',
            message: `ZIP 条目实际大小与声明不一致：${entry.filename}`,
            detail: `声明 ${entry.uncompressedSize} 字节，实际 ${data.length} 字节`,
          },
        }
      }
      actualTotal += data.length
      if (actualTotal > MAX_BACKUP_UNCOMPRESSED_BYTES) {
        return {
          ok: false,
          error: {
            code: 'too_large',
            message: `ZIP 实际解压后总大小超过 ${MAX_BACKUP_UNCOMPRESSED_BYTES} 字节（150 MiB）`,
          },
        }
      }
      contents.set(entry.filename, data)
    }

    return { ok: true, value: contents }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    // zip.js 会在读取中央目录时直接拒绝某些条目名（目录遍历、绝对路径、
    // 反斜杠等）并抛出 "Unsafe filename"。这不是“文件损坏”，应按不安全
    // 路径返回，测试和 UI 才能区分具体原因。
    if (/unsafe filename/i.test(detail)) {
      return {
        ok: false,
        error: {
          code: 'unsafe_path',
          message: 'ZIP 包含库层拒绝的不安全条目名（目录遍历或绝对路径变体）。',
          detail,
        },
      }
    }
    return {
      ok: false,
      error: {
        code: 'invalid_zip',
        message: '无法读取 ZIP：文件损坏、不是 ZIP，或结构存在歧义。',
        detail,
      },
    }
  } finally {
    if (reader !== null) {
      try {
        await reader.close()
      } catch {
        // 关闭失败不改变已经完成的读取结果。
      }
    }
  }
}

/** 写入 ZIP；所有路径在写入前再次校验，防止调用方传入穿越路径。 */
export async function writeZipEntries(
  entries: readonly ZipWriteEntry[],
): Promise<ZipSafetyResult<Uint8Array>> {
  for (const entry of entries) {
    const pathError = validateEntryPath(entry.path)
    if (pathError !== null) {
      return {
        ok: false,
        error: {
          code: 'unsafe_path',
          message: `拒绝写入不安全的条目：${entry.path}`,
          detail: pathError,
        },
      }
    }
  }

  const names = new Set(entries.map((entry) => normalizedEntryName(entry.path)))
  if (names.size !== entries.length) {
    return {
      ok: false,
      error: {
        code: 'duplicate_entry',
        message: '备份条目名重复，拒绝生成 ZIP',
      },
    }
  }
  if (entries.length > MAX_BACKUP_ENTRIES) {
    return {
      ok: false,
      error: {
        code: 'too_many_entries',
        message: `备份条目数 ${entries.length} 超过上限 ${MAX_BACKUP_ENTRIES}；请先清理不用的来源版本。`,
      },
    }
  }

  try {
    const writer = new Uint8ArrayWriter()
    const zipWriter = new ZipWriter(writer, { useWebWorkers: false })
    for (const entry of entries) {
      await zipWriter.add(entry.path, new Uint8ArrayReader(entry.bytes), {
        level: entry.level ?? 6,
        useWebWorkers: false,
      })
    }
    await zipWriter.close()
    return { ok: true, value: await writer.getData() }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'invalid_zip',
        message: '生成 ZIP 失败，未返回任何备份文件。',
        detail: error instanceof Error ? error.message : String(error),
      },
    }
  }
}
