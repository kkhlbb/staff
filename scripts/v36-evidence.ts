/**
 * V3.6 阶段 1 证据生成器（只在显式命令时运行，不属于任何常规测试套件）：
 *
 *   npx vitest run --config vitest.v36evidence.config.ts
 *
 * 读取仓库内固定样例 PDF，调用真实提取器，把候选（含页/选区/原文片段）
 * 与坏样例判定写到 docs/evidence/V3.6/。不修改任何项目文件。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { serializeEvidence } from './evidence-json'
import { it } from 'vitest'
import {
  buildPdfTextLayer,
  buildExtractionDraft,
  type ExtractionDraft,
} from '../src/document-extraction'
import {
  fixturePath,
  fixtureSha256,
  readPdfTextPages,
} from '../src/document-extraction/__tests__/helpers/pdfFixture'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const OUT_DIR = 'docs/evidence/V3.6'

async function extract(name: string, projectId: string): Promise<ExtractionDraft> {
  const { pageCount, pages } = await readPdfTextPages(name)
  return buildExtractionDraft({
    projectId,
    baseToken: 'base-v36-evidence',
    source: {
      documentId: `doc-${projectId}`,
      revisionId: `rev-${projectId}`,
      sha256: fixtureSha256(name),
      blobKey: `blob-${projectId}`,
      pageCount,
    },
    pageRange: { from: 1, to: pageCount },
    layer: buildPdfTextLayer(pages),
  })
}

it('记录 V3.6 固定样例与坏样例证据', async () => {
  mkdirSync(OUT_DIR, { recursive: true })
  const fixed = await extract('taskbook-TB-2026-1110.pdf', 'fixed-1110')
  writeFileSync(
    `${OUT_DIR}/1110-extraction.json`,
    serializeEvidence({
      fixture: fixturePath('taskbook-TB-2026-1110.pdf'),
      sha256: fixtureSha256('taskbook-TB-2026-1110.pdf'),
      draft: fixed,
    }),
  )

  const badNames = ['bad-no-text-layer.pdf', 'bad-formula-conflict.pdf', 'bad-inch-unit.pdf']
  const bad = []
  for (const name of badNames) {
    const draft = await extract(name, name.replace(/\.pdf$/u, ''))
    bad.push({
      fixture: name,
      sha256: createHash('sha256').update(readFileSync(fixturePath(name))).digest('hex'),
      candidates: draft.candidates.map((candidate) => ({
        kind: candidate.kind,
        page: candidate.page,
        status: candidate.status,
        reasonCodes: candidate.reasonCodes,
        data: candidate.data,
      })),
      issues: draft.issues,
    })
  }
  writeFileSync(`${OUT_DIR}/bad-samples.json`, JSON.stringify(bad, null, 2))
})
