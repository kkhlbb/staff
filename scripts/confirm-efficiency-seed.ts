/**
 * L2 确认效率：截屏用证据夹具（显式运行，不进入 npm test / test:desktop）。
 *
 * 生成一个含 **真实 r6 任务书 PDF**（6 份语料里最复杂的一份：87 候选 / 44 待确认 /
 * 43 阻塞 / 29 条仅差单位）的 .cunlian，草稿走真实 pdfjs → buildPdfTextLayer →
 * buildExtractionDraft，不手写候选。打包应用打开后即可看到分组、批量补单位与互斥拒绝。
 *
 * 用法：
 *   CONFIRM_SEED_OUT=/abs/path/CONFIRM-L2.cunlian \
 *     npx vitest run --config vitest.v36fixture.config.ts
 *
 * 语料默认在 ~/DSH/tmp/cunlian-v36/real-docs（可用 REAL_DOC_CORPUS 覆盖）；
 * 缺失/被替换直接失败，不静默跳过。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSampleSnapshot } from '../src/project-file/__fixtures__/sampleProjectFile'
import { encodeProjectFile } from '../src/project-file/codec'
import type { ProjectFileSnapshot } from '../src/project-file/types'
import { buildExtractionDraft, buildPdfTextLayer } from '../src/document-extraction'
import { extractPdfTextPages } from '../desktop/main/pdfTextExtract'

const OUT = process.env.CONFIRM_SEED_OUT
const repoRoot = path.resolve(__dirname, '..')
const CORPUS = process.env.REAL_DOC_CORPUS ?? path.join(process.env.HOME ?? '', 'DSH/tmp/cunlian-v36/real-docs')

describe('L2 确认效率证据夹具', () => {
  it.skipIf(!OUT)('生成含真实 r6 任务书与提取草稿的项目文件', async () => {
    // 只用 manifest 里的 r6（不猜文件名、不改字节）。
    const manifest = JSON.parse(
      await fsp.readFile(path.join(repoRoot, 'docs/evidence/real-doc-baseline/corpus-manifest.json'), 'utf8'),
    ) as { documents: { id: string; file: string; sha256: string; pages: number }[] }
    const doc = manifest.documents.find((item) => item.id === 'r6')
    expect(doc, 'manifest 里必须有 r6（真实文档基线）').toBeDefined()
    if (doc === undefined) return
    const bytes = new Uint8Array(await fsp.readFile(path.join(CORPUS, doc.file)))
    const { createHash } = await import('node:crypto')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    expect(sha256, `语料 ${doc.file} 与 manifest sha256 不一致`).toBe(doc.sha256)

    const base = await createSampleSnapshot()
    const source = {
      documentId: base.documents[0]!.id,
      revisionId: base.revisions[0]!.id,
      sha256,
      blobKey: base.blobs[0]!.blobKey,
      pageCount: doc.pages,
    }
    const rawPages = await extractPdfTextPages(
      bytes,
      { from: 1, to: doc.pages },
      { maxTextItems: 200000, timeoutMs: 300000 },
    )
    const draft = buildExtractionDraft({
      projectId: base.project.id,
      baseToken: 'base-1',
      source,
      pageRange: { from: 1, to: doc.pages },
      layer: buildPdfTextLayer(rawPages),
    })
    const snapshot: ProjectFileSnapshot = {
      ...base,
      project: { ...base.project, extractionDrafts: [draft] },
      documents: [{ ...base.documents[0]!, title: doc.file }],
      revisions: [
        {
          ...base.revisions[0]!,
          fileName: doc.file,
          sha256,
          byteSize: bytes.byteLength,
          pageCount: doc.pages,
        },
      ],
      blobs: [{ ...base.blobs[0]!, sha256, byteSize: bytes.byteLength }],
      attachments: [{ blobKey: base.blobs[0]!.blobKey, bytes }],
    }
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok, encoded.ok ? '' : JSON.stringify(encoded.error)).toBe(true)
    if (!encoded.ok) return
    await fsp.mkdir(path.dirname(OUT!), { recursive: true })
    await fsp.writeFile(OUT!, encoded.value.bytes)
    console.log(
      `SEED_WRITTEN ${OUT} · ${draft.candidates.length} 候选（pending ${draft.candidates.filter((c) => c.status === 'pending').length}）`,
    )
  }, 300_000)
})
