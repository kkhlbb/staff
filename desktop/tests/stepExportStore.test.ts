import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { StepExportStore } from '../main/stepExportStore'
import { nodeFileOps } from '../main/fileStore'
const dirs: string[] = []
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }) })
async function fixture() {
 const d = await fs.mkdtemp(path.join(os.tmpdir(), 'step-store-')); dirs.push(d)
 const target = path.join(d, '隔套 名称.step'); await fs.writeFile(target, 'original')
 const store = new StepExportStore(); const expected = await store.fingerprint(target)
 return { d, target, store, expected, bytes: new TextEncoder().encode('real-kernel-bytes-transport') }
}
it('atomic transport hashes exact bytes, without creating project versions', async () => {
 const f = await fixture(); const r = await f.store.save(f.target, f.bytes, f.expected)
 expect(r.sha256).toMatch(/^[0-9a-f]{64}$/); expect(await fs.readFile(f.target)).toEqual(Buffer.from(f.bytes)); expect(await fs.readdir(f.d)).toEqual(['隔套 名称.step'])
})
it.each(['writeExclusive','readFile','rename'] as const)('pre-commit %s failure preserves existing bytes', async method => {
 const f = await fixture(); const ops = { ...nodeFileOps, [method]: async () => { throw Object.assign(new Error('injected'), { code: 'ENOSPC' }) } }
 const store = new StepExportStore(ops)
 await expect(store.save(f.target, f.bytes, f.expected)).rejects.toThrow()
 expect(await fs.readFile(f.target, 'utf8')).toBe('original'); expect(await fs.readdir(f.d)).toEqual(['隔套 名称.step'])
})
it('post-rename fsync failure is COMMITTED_UNCONFIRMED, never cancelled or untouched', async () => {
 const f = await fixture(); const store = new StepExportStore({ ...nodeFileOps, syncDirectory: async () => { throw Error('fsync') } })
 await expect(store.save(f.target, f.bytes, f.expected)).rejects.toMatchObject({ code: 'COMMITTED_UNCONFIRMED' })
 expect(await fs.readFile(f.target)).toEqual(Buffer.from(f.bytes))
})
it('rejects changed target, symlink, directory and missing parent before writes', async () => {
 const f = await fixture(); await fs.writeFile(f.target, 'external')
 await expect(f.store.save(f.target, f.bytes, f.expected)).rejects.toMatchObject({ code: 'EXTERNAL_MODIFIED' })
 const link = path.join(f.d, 'link.step'); await fs.symlink(f.target, link)
 for (const target of [link, f.d, path.join(f.d,'missing','x.step')]) await expect(f.store.save(target, f.bytes, null)).rejects.toThrow()
 expect(await fs.readFile(f.target, 'utf8')).toBe('external')
})
it('detects last-kind substitution even when prior target was missing', async () => {
 const f = await fixture(); const target = path.join(f.d, 'new.step'); let checks = 0
 const store = new StepExportStore({ ...nodeFileOps, statKind: async p => p === target && ++checks > 1 ? 'symlink' : nodeFileOps.statKind(p) })
 await expect(store.save(target, f.bytes, null)).rejects.toThrow()
 expect(await fs.readdir(f.d)).toEqual(['隔套 名称.step'])
})
