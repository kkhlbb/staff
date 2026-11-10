/**
 * 临时证据生成器（只在本机显式运行时写外部临时目录，不进入常规测试）。
 * 生成：含真实两页任务书附件的 P35-A 项目文件，供打包应用通过 open-file 打开。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSpacerSnapshot } from '../../src/project-file/__fixtures__/spacerProjectFile'
import { IPC_CHANNELS } from '../shared/contracts'
import { registerSourceChannels } from '../main/sourceChannels'
import { inspectSourcePdf } from '../main/pdfSourceInspect'
import { createHarness } from './helpers/a04'

const OUT = process.env.V35_SEED_OUT
const PDF = path.join(process.cwd(), 'docs/evidence/V3.5/fixtures/taskbook-2p.pdf')

describe('V3.5 证据夹具', () => {
  it.runIf(Boolean(OUT))('生成含 PDF 附件的项目文件', async () => {
    const harness = await createHarness()
    try {
      const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
      const opened = await harness.openSample(snapshot, 'v35-seed')
      const files = new Map<string, Uint8Array>()
      files.set(PDF, new Uint8Array(await fsp.readFile(PDF)))
      registerSourceChannels(harness.ipc, {
        guard: harness.guard,
        controller: harness.controller,
        projectService: harness.projectService,
        recovery: harness.recovery,
        pickSourcePath: async () => PDF,
        io: {
          async kindOf(target) { return files.has(target) ? 'file' : 'missing' },
          async sizeOf(target) { return files.get(target)?.byteLength ?? null },
          async readUpTo(target, max) {
            const bytes = files.get(target)!
            return bytes.slice(0, Math.min(max, bytes.byteLength))
          },
        },
        inspectPdf: (bytes) => inspectSourcePdf(bytes),
      })
      const session = harness.projectService.getSession(opened.sessionId)!
      const imported = await harness.invoke(IPC_CHANNELS.sourceImport, {
        sessionId: opened.sessionId,
        baseEditSeq: session.acceptedSeq,
      })
      expect(imported.ok).toBe(true)
      const saved = await harness.invoke<import('../shared/contracts').ProjectSaveValue>(IPC_CHANNELS.projectSave, {
        sessionId: opened.sessionId,
        editSeq: session.acceptedSeq,
        expectedFingerprint: session.fingerprint,
      })
      expect(saved.ok, saved.ok ? '' : JSON.stringify(saved.error)).toBe(true)
      if (!saved.ok) return
      await fsp.mkdir(path.dirname(OUT!), { recursive: true })
      await fsp.copyFile(saved.value.path, OUT!)
      console.log(`SEED_WRITTEN ${OUT}`)
    } finally {
      await harness.dispose()
    }
  }, 120_000)
})
