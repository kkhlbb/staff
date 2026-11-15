import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { nodeFileOps, sha256Bytes, type FileOps } from './fileStore'
import { IpcFailure } from './ipc'

// Unlike the older drawing store, cleanup also covers an owned partial write/fsync failure.
const stepFileOps: FileOps = { ...nodeFileOps, async writeExclusive(target, bytes) {
 const handle = await fs.open(target, 'wx', 0o600)
 let complete = false
 try {
  let offset = 0
  while (offset < bytes.length) {
   const r = await handle.write(bytes, offset, bytes.length - offset)
   if (r.bytesWritten <= 0) throw Error('short write')
   offset += r.bytesWritten
  }
  await handle.sync(); await handle.close(); complete = true
 } finally {
  if (!complete) {
   try { await handle.close() } catch { /* original write/sync/close failure retained */ }
   await fs.unlink(target)
  }
 }
} }
export class StepExportStore {
 private readonly ops: FileOps
 constructor(ops: FileOps = stepFileOps) { this.ops = ops }
 async fingerprint(target: string): Promise<string | null> {
  const kind = await this.ops.statKind(target)
  if (kind !== 'file' && kind !== 'missing') throw new IpcFailure('SAVE_FAILED', 'STEP 目标必须是常规文件，不允许目录或符号链接')
  return kind === 'missing' ? null : sha256Bytes(await this.ops.readFile(target))
 }
 /** No cancellation after entry: commit phase returns actual disk state. Last-check/rename is not a filesystem CAS. */
 async save(target: string, bytes: Uint8Array, expected: string | null): Promise<{ sha256: string; warnings: string[] }> {
  const temporary = `${target}.${randomUUID()}.step-tmp`
  let owned = false, committed = false
  try {
   if (path.extname(target).toLowerCase() !== '.step') throw new IpcFailure('SAVE_FAILED', '必须使用 .step 后缀')
   if (await this.ops.statKind(path.dirname(target)) !== 'directory') throw new IpcFailure('SAVE_FAILED', '目标父目录不存在')
   if (await this.fingerprint(target) !== expected) throw new IpcFailure('EXTERNAL_MODIFIED', '目标与确认时不一致，已拒绝覆盖')
   const digest = await sha256Bytes(bytes)
   await this.ops.writeExclusive(temporary, bytes); owned = true
   const read = await this.ops.readFile(temporary)
   if (read.length !== bytes.length || await sha256Bytes(read) !== digest) throw new IpcFailure('VERIFY_FAILED', 'STEP 临时文件校验失败')
   if (await this.fingerprint(target) !== expected) throw new IpcFailure('EXTERNAL_MODIFIED', '生成期间目标被其它程序修改')
   await this.ops.rename(temporary, target); owned = false; committed = true
   await this.ops.syncDirectory(path.dirname(target))
   if (await this.fingerprint(target) !== digest) throw Error('committed hash mismatch')
   return { sha256: digest, warnings: [] }
  } catch (error) {
   if (committed) throw new IpcFailure('COMMITTED_UNCONFIRMED', '文件已替换，但回读或持久化未确认；不能视为未写入')
   if (error instanceof IpcFailure) throw error
   const code = (error as NodeJS.ErrnoException).code
   throw new IpcFailure(code === 'ENOSPC' ? 'NO_SPACE' : ['EACCES','EPERM','EROFS'].includes(code ?? '') ? 'PERMISSION_DENIED' : 'STEP_EXPORT_FAILED', 'STEP 文件提交失败，原目标未被本任务替换')
  } finally {
   if (owned) {
    try { await this.ops.remove(temporary) }
    catch {
     // An owned temporary remains: report this stronger failure instead of promising cleanup.
     // eslint-disable-next-line no-unsafe-finally
     throw new IpcFailure('STEP_EXPORT_FAILED', 'STEP 临时文件清理失败；原目标未替换')
    }
   }
  }
 }
}
