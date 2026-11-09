/**
 * main 侧受限文件端口（V3-B2）：只做 lstat/大小/有界读取。
 * - 不跟随符号链接（lstat）；
 * - 读取按块进行，累计到 max 字节即停止，不会整文件无限读；
 * - 所有错误交给调用方映射为 IPC 码。
 */
import { promises as fsp, type Stats } from 'node:fs'
import type { FileKind, ModelFileIo } from './modelChannels'

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === code
  )
}

function kindOfStats(stats: Stats): FileKind {
  if (stats.isSymbolicLink()) return 'symlink'
  if (stats.isFile()) return 'file'
  if (stats.isDirectory()) return 'directory'
  return 'other'
}

export function createModelFileIo(chunkSize = 1024 * 1024): ModelFileIo {
  return {
    async kindOf(targetPath) {
      try {
        const stats = await fsp.lstat(targetPath)
        return kindOfStats(stats)
      } catch (error) {
        if (isErrno(error, 'ENOENT') || isErrno(error, 'ENOTDIR')) return 'missing'
        return 'other'
      }
    },
    async sizeOf(targetPath) {
      try {
        const stats = await fsp.lstat(targetPath)
        return stats.isFile() && !stats.isSymbolicLink() ? stats.size : null
      } catch {
        return null
      }
    },
    async readUpTo(targetPath, max) {
      const handle = await fsp.open(targetPath, 'r')
      try {
        const stats = await handle.stat()
        if (!stats.isFile()) {
          throw new Error('不是常规文件')
        }
        const chunks: Uint8Array[] = []
        let total = 0
        while (total < max) {
          const remaining = max - total
          const buffer = Buffer.allocUnsafe(Math.min(chunkSize, remaining))
          const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null)
          if (bytesRead === 0) break
          chunks.push(buffer.subarray(0, bytesRead))
          total += bytesRead
        }
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
          merged.set(chunk, offset)
          offset += chunk.byteLength
        }
        return merged
      } finally {
        await handle.close()
      }
    },
  }
}
