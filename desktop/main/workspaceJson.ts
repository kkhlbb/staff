/**
 * userData/workspace 下的 JSON 索引读写（A-04）。
 *
 * 索引文件不是项目文件，不能复用 `.cunlian` 的容器校验；但同样要求
 * “临时文件 → 回读校验 → rename”的原子写入，避免崩溃后留下半个索引。
 * 所有目录都从调用方注入的 rootDir 派生，不读取 renderer 传入的路径。
 */
import { randomUUID } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { nodeFileOps, type FileOps } from './fileStore'

/** 在 fileStore 的端口上加“建目录”，便于测试注入失败。 */
export interface WorkspaceOps extends FileOps {
  ensureDirectory(directoryPath: string): Promise<void>
}

export const nodeWorkspaceOps: WorkspaceOps = {
  ...nodeFileOps,
  async ensureDirectory(directoryPath) {
    await fsp.mkdir(directoryPath, { recursive: true, mode: 0o700 })
  },
}

export const WORKSPACE_JSON_MAX_BYTES = 1024 * 1024

export type JsonReadResult =
  | { state: 'missing' }
  | { state: 'ok'; value: unknown }
  | { state: 'invalid'; detail: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function errnoOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

/** 读取并解析 JSON 索引；文件不存在返回 missing，内容损坏返回 invalid（不静默当空）。 */
export async function readJsonIndex(
  ops: WorkspaceOps,
  filePath: string,
  maxBytes = WORKSPACE_JSON_MAX_BYTES,
): Promise<JsonReadResult> {
  const kind = await ops.statKind(filePath)
  if (kind === 'missing') {
    return { state: 'missing' }
  }
  if (kind !== 'file') {
    return { state: 'invalid', detail: '不是常规文件（链接、目录或其它类型）' }
  }
  let bytes: Uint8Array
  try {
    bytes = await ops.readFile(filePath)
  } catch (error) {
    return { state: 'invalid', detail: `读取失败：${errnoOf(error) ?? String(error)}` }
  }
  if (bytes.byteLength > maxBytes) {
    return { state: 'invalid', detail: `超过 ${maxBytes} 字节上限` }
  }
  let text: string
  try {
    text = decoder.decode(bytes)
  } catch {
    return { state: 'invalid', detail: '不是合法 UTF-8' }
  }
  try {
    return { state: 'ok', value: JSON.parse(text) as unknown }
  } catch {
    return { state: 'invalid', detail: '不是合法 JSON' }
  }
}

/**
 * 原子写 JSON：独占创建临时文件 → 回读并按 JSON 解析 → rename。
 * rename 前原文件保持不变；失败时清理本次临时文件。
 */
export async function writeJsonIndex(
  ops: WorkspaceOps,
  filePath: string,
  value: unknown,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const directory = path.dirname(filePath)
  let bytes: Uint8Array
  try {
    bytes = encoder.encode(`${JSON.stringify(value, null, 2)}\n`)
  } catch (error) {
    return { ok: false, detail: `无法序列化索引：${errnoOf(error) ?? String(error)}` }
  }
  if (bytes.byteLength > WORKSPACE_JSON_MAX_BYTES) {
    return { ok: false, detail: `索引超过 ${WORKSPACE_JSON_MAX_BYTES} 字节上限` }
  }

  const tempPath = `${filePath}.${randomUUID()}.tmp`
  let tempWritten = false
  try {
    try {
      await ops.ensureDirectory(directory)
      await ops.writeExclusive(tempPath, bytes)
      tempWritten = true
    } catch (error) {
      return { ok: false, detail: `写入临时索引失败：${errnoOf(error) ?? String(error)}` }
    }

    try {
      const back = await ops.readFile(tempPath)
      decoder.decode(back)
      JSON.parse(decoder.decode(back))
    } catch (error) {
      return { ok: false, detail: `临时索引回读校验失败：${errnoOf(error) ?? String(error)}` }
    }

    try {
      await ops.rename(tempPath, filePath)
      tempWritten = false
    } catch (error) {
      return { ok: false, detail: `替换索引失败：${errnoOf(error) ?? String(error)}` }
    }

    try {
      await ops.syncDirectory(directory)
    } catch {
      // 目录同步失败只影响耐久性，不影响本次内容；由调用方决定是否警告。
    }
    return { ok: true }
  } finally {
    if (tempWritten) {
      try {
        await ops.remove(tempPath)
      } catch {
        // 清理失败不掩盖原始结果。
      }
    }
  }
}

/**
 * 把损坏的索引改名隔离（保留原字节供诊断），不删除、不覆盖正式项目。
 * 返回隔离后的路径；索引文件不存在时返回 null。
 */
export async function isolateCorruptIndex(
  ops: WorkspaceOps,
  filePath: string,
  stamp: string,
): Promise<string | null> {
  const kind = await ops.statKind(filePath)
  if (kind !== 'file') {
    return null
  }
  const target = `${filePath}.corrupt-${stamp.replace(/[^0-9A-Za-z._-]/g, '')}`
  await ops.rename(filePath, target)
  return target
}
