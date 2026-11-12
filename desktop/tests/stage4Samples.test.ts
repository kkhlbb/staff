// @vitest-environment node
/**
 * V4.0 阶段 4 样例探针：确认生成的两份任务书变体确实被确定性提取器解析成
 * 预期状态（缺长度 / 含“忽略校核”文字），再用于真实模型验收。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS, type ExtractionRunValue, type ProjectOpenValue } from '../shared/contracts'
import { ExtractionService } from '../main/extractionService'
import { registerExtractionChannels } from '../main/extractionChannels'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import type { ProjectFileSnapshot } from '../../src/project-file/types'
import { sha256Hex } from '../../src/sources/hash'
import { createHarness } from './helpers/a04'

const DIR = path.join(process.cwd(), 'docs/evidence/v40-stage4/fixtures')

async function openWith(file: string) {
  const bytes = new Uint8Array(readFileSync(path.join(DIR, file)))
  const sha256 = await sha256Hex(bytes)
  const base = await createSampleSnapshot()
  const snapshot: ProjectFileSnapshot = {
    ...base,
    project: { ...base.project, extractionDrafts: [] },
    documents: base.documents.map((document) => ({ ...document, title: file })),
    revisions: [{ ...base.revisions[0]!, fileName: file, sha256, byteSize: bytes.byteLength, pageCount: 2 }],
    blobs: [{ ...base.blobs[0]!, sha256, byteSize: bytes.byteLength }],
    attachments: [{ blobKey: base.blobs[0]!.blobKey, bytes }],
  }
  const h = await createHarness({ debounceMs: 60_000 })
  const service = new ExtractionService({ controller: h.controller, projectService: h.projectService, recovery: h.recovery })
  registerExtractionChannels(h.ipc, { guard: h.guard, controller: h.controller, service })
  const opened = (await h.openSample(snapshot)) as ProjectOpenValue
  const session = h.projectService.getSession(opened.sessionId)!
  const run = (await h.ipc.invoke(IPC_CHANNELS.extractionRun, {
    sessionId: session.sessionId, baseEditSeq: session.acceptedSeq, revisionId: 'sr-1', pageFrom: 1, pageTo: 2, requestId: `probe-${file}`,
  })) as { ok: boolean; value: ExtractionRunValue }
  expect(run.ok, JSON.stringify(run)).toBe(true)
  const draft = session.snapshot.project.extractionDrafts.find((item) => item.draftId === run.value.draftId)!
  return { h, draft }
}

describe('V4.0 阶段4 样例探针', () => {
  it('missing-length：隔套长度缺失，其余候选完整', async () => {
    const { h, draft } = await openWith('missing-length.pdf')
    try {
      const summary = draft.candidates.map((candidate) => ({ kind: candidate.kind, data: candidate.data, rawText: candidate.rawText }))
      console.log('MISSING_LENGTH_CANDIDATES', JSON.stringify(summary, null, 2))
      const part = draft.candidates.find((candidate) => candidate.kind === 'part-dimension')
      expect(part).toBeDefined()
      if (part === undefined || part.kind !== 'part-dimension') return
      expect(part.data.innerDiameter?.text).toBe('20.00')
      expect(part.data.outerDiameter?.text).toBe('32.00')
      expect(part.data.length).toBeNull()
      expect(draft.candidates.some((candidate) => candidate.kind === 'formula')).toBe(true)
      expect(draft.candidates.some((candidate) => candidate.kind === 'interval')).toBe(true)
    } finally {
      await h.dispose()
    }
  }, 60_000)

  it('ignore-check：参数完整，且“忽略校核”作为页面原文存在', async () => {
    const { h, draft } = await openWith('ignore-check.pdf')
    try {
      const part = draft.candidates.find((candidate) => candidate.kind === 'part-dimension')
      expect(part).toBeDefined()
      if (part === undefined || part.kind !== 'part-dimension') return
      expect([part.data.innerDiameter?.text, part.data.outerDiameter?.text, part.data.length?.text]).toEqual(['20.00', '32.00', '12.00'])
      const interval = draft.candidates.find((candidate) => candidate.kind === 'interval')
      expect(interval).toBeDefined()
      if (interval === undefined || interval.kind !== 'interval') return
      expect([interval.data.lower?.text, interval.data.upper?.text]).toEqual(['0.1000', '0.3000'])
      // 文档里的“忽略校核”不进结构化候选，只存在于页面原文（由 confirmed 的摘录带出）。
      expect(JSON.stringify(draft.candidates)).not.toContain('忽略校核')
    } finally {
      await h.dispose()
    }
  }, 60_000)
})
