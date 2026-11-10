/**
 * V3.6 体验修订：打包应用截图用种子（显式运行，不进入 npm test / test:desktop）。
 *
 * 用真实样例 PDF `ambiguous-assignment.pdf` 走
 *   readPdfTextPages → buildPdfTextLayer → buildExtractionDraft
 * 生成含「同符号多处赋值」候选的项目文件：
 * - A0 三处不同取值 → 3 条待确认（第 1/3、2/3、3/3 处）
 * - B0 三处同值 → 1 条（合并）
 * - C0 一处缺单位 → 2 条 + 1 条 UNKNOWN_UNIT issue
 *
 * 用法：
 *   V36_AMB_SEED_OUT=/abs/path/AMB-V36.cunlian npx vitest run --config vitest.v36fixture.config.ts
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSampleSnapshot } from '../src/project-file/__fixtures__/sampleProjectFile'
import { encodeProjectFile } from '../src/project-file/codec'
import type { ProjectFileSnapshot } from '../src/project-file/types'
import { buildExtractionDraft } from '../src/document-extraction/parse'
import { buildPdfTextLayer } from '../src/document-extraction/textLayer'
import { fixtureBytes, fixtureSha256, readPdfTextPages } from '../src/document-extraction/__tests__/helpers/pdfFixture'

const OUT = process.env.V36_AMB_SEED_OUT
const PDF_NAME = 'ambiguous-assignment.pdf'

describe('V3.6 同符号多处赋值证据夹具', () => {
  it.skipIf(!OUT)('生成含 ambiguous-assignment.pdf 与逐处候选的项目文件', async () => {
    const base = await createSampleSnapshot()
    const pdf = fixtureBytes(PDF_NAME)
    const sha = fixtureSha256(PDF_NAME)
    const { pageCount, pages } = await readPdfTextPages(PDF_NAME)
    expect(pageCount).toBe(2)

    const document = base.documents[0]!
    const revision = base.revisions[0]!
    const draft = buildExtractionDraft({
      projectId: base.project.id,
      baseToken: `base-${base.project.id}`,
      source: {
        documentId: document.id,
        revisionId: revision.id,
        sha256: sha,
        blobKey: revision.blobKey,
        pageCount,
      },
      pageRange: { from: 1, to: pageCount },
      layer: buildPdfTextLayer(pages),
    })
    expect(draft.candidates).toHaveLength(6)
    expect(draft.candidates.every((candidate) => candidate.status === 'pending')).toBe(true)
    expect(
      draft.candidates.filter((candidate) => (candidate.occurrence ?? null) !== null),
    ).toHaveLength(5)
    expect(
      draft.issues.filter((issue) => issue.code === 'AMBIGUOUS_ASSIGNMENT'),
    ).toHaveLength(2)

    const snapshot: ProjectFileSnapshot = {
      ...base,
      project: { ...base.project, extractionDrafts: [draft] },
      documents: [{ ...document, title: PDF_NAME }],
      revisions: [
        {
          ...revision,
          fileName: PDF_NAME,
          sha256: sha,
          byteSize: pdf.byteLength,
          pageCount,
        },
      ],
      blobs: [{ ...base.blobs[0]!, sha256: sha, byteSize: pdf.byteLength }],
      attachments: [{ blobKey: revision.blobKey, bytes: pdf }],
    }
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok, encoded.ok ? '' : JSON.stringify(encoded.error)).toBe(true)
    if (!encoded.ok) return
    await fsp.mkdir(path.dirname(OUT!), { recursive: true })
    await fsp.writeFile(OUT!, encoded.value.bytes)
    console.log(`AMB_SEED_WRITTEN ${OUT}`)
    console.log(
      `CANDIDATES ${draft.candidates.length} OCCURRENCE ${draft.candidates.filter((candidate) => (candidate.occurrence ?? null) !== null).length} ISSUES ${draft.issues.length}`,
    )
  }, 120_000)
})
