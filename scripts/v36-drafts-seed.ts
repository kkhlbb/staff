/**
 * V3.6 多草稿证据生成器（显式运行，不进入 npm test / test:desktop）。
 *
 * 生成一个 schema8 项目文件，忠实现场复现用户报告的场景：
 * 同一份 PDF（sr-89d9193b 等价物：仓库内 1110 两页任务书）+ 同一页范围 [1,2]，
 * 因为规则版本升到 document-extractor-3，项目里同时存在两份草稿：
 * - document-extractor-1：7 条候选，其中 1 条已确认（旧结果，已被取代）；
 * - document-extractor-3：7 条候选，全部待确认（当前草稿）。
 *
 * 都用真实 pdfjs 文本层 + 真实 buildExtractionDraft / confirmCandidate 路径，
 * 不手写候选、不伪造出处。
 *
 * 用法：
 *   V36_DRAFTS_SEED_OUT=/abs/path/DRAFTS-V36.cunlian \
 *     npx vitest run --config vitest.v36fixture.config.ts
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSampleSnapshot } from '../src/project-file/__fixtures__/sampleProjectFile'
import { encodeProjectFile } from '../src/project-file/codec'
import type { ProjectFileSnapshot } from '../src/project-file/types'
import {
  fixtureBytes,
  fixtureSha256,
  readPdfTextPages,
} from '../src/document-extraction/__tests__/helpers/pdfFixture'
import { buildPdfTextLayer } from '../src/document-extraction/textLayer'
import { buildExtractionDraft } from '../src/document-extraction/parse'
import { confirmCandidate } from '../src/document-extraction/draft'
import { EXTRACTOR_VERSION } from '../src/document-extraction/types'

const OUT = process.env.V36_DRAFTS_SEED_OUT
const PDF_NAME = 'taskbook-TB-2026-1110.pdf'

describe('V3.6 多草稿证据夹具', () => {
  it.skipIf(!OUT)('生成含两份草稿的项目文件（旧规则 1 条已确认 / 新规则全待确认）', async () => {
    const base = await createSampleSnapshot()
    const pdf = fixtureBytes(PDF_NAME)
    const sha = fixtureSha256(PDF_NAME)
    const { pages } = await readPdfTextPages(PDF_NAME)
    const layer = buildPdfTextLayer(pages)

    const source = {
      documentId: base.documents[0]!.id,
      revisionId: base.revisions[0]!.id,
      sha256: sha,
      blobKey: base.blobs[0]!.blobKey,
      pageCount: 2,
    }
    const build = (extractorVersion: string) =>
      buildExtractionDraft({
        projectId: base.project.id,
        baseToken: `base-${base.project.id}`,
        source,
        pageRange: { from: 1, to: 2 },
        layer,
        extractorVersion,
      })

    const oldRule = build('document-extractor-1')
    const target = oldRule.candidates.find(
      (candidate) => candidate.kind === 'ring' && candidate.status === 'pending',
    )
    expect(target).toBeDefined()
    const confirmed = confirmCandidate(oldRule, {
      candidateId: target!.candidateId,
      editRevision: target!.editRevision,
      confirmed: true,
      actor: 'local-operator',
      decidedAt: '2026-11-10T08:30:00.000Z',
    })
    expect(confirmed.ok, confirmed.ok ? '' : confirmed.message).toBe(true)
    if (!confirmed.ok) return

    const current = build(EXTRACTOR_VERSION)
    expect(oldRule.candidates).toHaveLength(7)
    expect(current.candidates).toHaveLength(7)
    expect(current.extractorVersion).toBe('document-extractor-3')

    const snapshot: ProjectFileSnapshot = {
      ...base,
      project: {
        ...base.project,
        extractionDrafts: [confirmed.value, current],
      },
      documents: [{ ...base.documents[0]!, title: PDF_NAME }],
      revisions: [
        {
          ...base.revisions[0]!,
          fileName: PDF_NAME,
          sha256: sha,
          byteSize: pdf.byteLength,
          pageCount: 2,
        },
      ],
      blobs: [{ ...base.blobs[0]!, sha256: sha, byteSize: pdf.byteLength }],
      attachments: [{ blobKey: base.blobs[0]!.blobKey, bytes: pdf }],
    }

    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok, encoded.ok ? '' : JSON.stringify(encoded.error)).toBe(true)
    if (!encoded.ok) return
    await fsp.mkdir(path.dirname(OUT!), { recursive: true })
    await fsp.writeFile(OUT!, encoded.value.bytes)
    console.log(`DRAFTS_SEED_WRITTEN ${OUT}`)
    console.log(`OLD_DRAFT ${confirmed.value.draftId}`)
    console.log(`NEW_DRAFT ${current.draftId}`)
    console.log(`OLD_CANDIDATES ${confirmed.value.candidates.length}`)
    console.log(`NEW_CANDIDATES ${current.candidates.length}`)
  }, 120_000)
})
