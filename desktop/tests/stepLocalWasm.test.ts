import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, symlink } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { loadLocalStepWasm, STEP_LOCAL_WASM_MAX_BYTES } from '../main/cad/stepLocalWasm'
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const minimal = Buffer.from([0,97,115,109,1,0,0,0])
describe('explicit main-process local WASM selection', () => {
  it('does not read any path without independent opt-in; rejects partial/unknown consent', async () => {
    expect(await loadLocalStepWasm({})).toBeUndefined()
    for (const env of [ { CUNLIAN_STEP_LOCAL_WASM: '/not/read' }, { CUNLIAN_STEP_LOCAL_OPT_IN: 'true' }, { CUNLIAN_STEP_LOCAL_OPT_IN: '1' } ]) {
      await expect(loadLocalStepWasm(env)).rejects.toThrow('STEP_LOCAL_CONFIG')
    }
  })
  it('requires absolute exact path and SHA, regular non-symlink file and bounded size', async () => {
    const root = await mkdtemp(path.join(process.cwd(), 'node_modules/.cache/local-policy-'))
    const file = path.join(root, 'candidate.wasm'); await writeFile(file, minimal)
    const env = { CUNLIAN_STEP_LOCAL_OPT_IN: '1', CUNLIAN_STEP_LOCAL_WASM: file, CUNLIAN_STEP_LOCAL_SHA256: hash(minimal) }
    expect((await loadLocalStepWasm(env))?.sha256).toBe(hash(minimal))
    expect((await loadLocalStepWasm(env))?.bytes).toEqual(minimal)
    await expect(loadLocalStepWasm({ ...env, CUNLIAN_STEP_LOCAL_WASM: 'candidate.wasm' })).rejects.toThrow('STEP_LOCAL_CONFIG')
    await expect(loadLocalStepWasm({ ...env, CUNLIAN_STEP_LOCAL_SHA256: 'A'.repeat(64) })).rejects.toThrow('STEP_LOCAL_CONFIG')
    await expect(loadLocalStepWasm({ ...env, CUNLIAN_STEP_LOCAL_SHA256: '0'.repeat(64) })).rejects.toThrow('STEP_LOCAL_HASH')
    const link = path.join(root, 'link.wasm'); await symlink(file, link)
    await expect(loadLocalStepWasm({ ...env, CUNLIAN_STEP_LOCAL_WASM: link })).rejects.toThrow('STEP_LOCAL_FILE')
    await expect(loadLocalStepWasm({ ...env, CUNLIAN_STEP_LOCAL_WASM: root })).rejects.toThrow('STEP_LOCAL_FILE')
    await expect(loadLocalStepWasm({ ...env, CUNLIAN_STEP_LOCAL_WASM: path.join(root, 'missing') })).rejects.toThrow('STEP_LOCAL_FILE')
    await writeFile(file, Buffer.alloc(STEP_LOCAL_WASM_MAX_BYTES + 1))
    await expect(loadLocalStepWasm(env)).rejects.toThrow('STEP_LOCAL_SIZE')
  })
})
