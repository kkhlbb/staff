import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const STEP_LOCAL_WASM_MAX_BYTES = 64 * 1024 * 1024
// Snapshot at main module initialization. No renderer/model/IPC configuration surface.
const startupSelection = {
  CUNLIAN_STEP_LOCAL_OPT_IN: process.env.CUNLIAN_STEP_LOCAL_OPT_IN,
  CUNLIAN_STEP_LOCAL_WASM: process.env.CUNLIAN_STEP_LOCAL_WASM,
  CUNLIAN_STEP_LOCAL_SHA256: process.env.CUNLIAN_STEP_LOCAL_SHA256,
}
type Selection = Partial<Record<keyof typeof startupSelection, string>>
export async function loadLocalStepWasm(env: Selection = startupSelection): Promise<{ bytes: Buffer; sha256: string } | undefined> {
  const consent = env.CUNLIAN_STEP_LOCAL_OPT_IN, filename = env.CUNLIAN_STEP_LOCAL_WASM, sha256 = env.CUNLIAN_STEP_LOCAL_SHA256
  if (consent === undefined && filename === undefined && sha256 === undefined) return undefined
  if (consent !== '1' || !filename || !path.isAbsolute(filename) || !sha256 || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error('STEP_LOCAL_CONFIG')
  // No privilege changes or fallback. Open once, reject symlink leaf, read bounded bytes
  // from the same descriptor: replacing the selected pathname cannot swap worker input.
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => { throw new Error('STEP_LOCAL_FILE') })
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new Error('STEP_LOCAL_FILE')
    if (stat.size < 8 || stat.size > STEP_LOCAL_WASM_MAX_BYTES) throw new Error('STEP_LOCAL_SIZE')
    const bytes = Buffer.alloc(stat.size + 1)
    let read = 0
    while (read < bytes.length) {
      const result = await file.read(bytes, read, bytes.length - read, null)
      if (!result.bytesRead) break
      read += result.bytesRead
    }
    if (read !== stat.size) throw new Error('STEP_LOCAL_SIZE')
    const snapshot = bytes.subarray(0, read)
    if (createHash('sha256').update(snapshot).digest('hex') !== sha256) throw new Error('STEP_LOCAL_HASH')
    return { bytes: snapshot, sha256 }
  } finally { await file.close() }
}
