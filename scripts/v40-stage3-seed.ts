/**
 * V4.0 阶段 3 打包走查夹具（显式运行，不进入常规测试）。
 *
 * 生成含隔套三参数 + 参数绑定 + 待复核图纸 + 真实任务书 PDF 附件的 schema8 项目，
 * 供打包应用通过 open-file 打开后运行离线演示侧栏。
 *
 * 用法：
 *   V40S3_SEED_OUT=<path.cunlian> npx vitest run --config vitest.v40stage3fixture.config.ts
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSpacerSnapshot } from '../src/project-file/__fixtures__/spacerProjectFile'
import { encodeProjectFile } from '../src/project-file/codec'
import type { ProjectFileSnapshot } from '../src/project-file/types'
import { fixtureBytes, fixtureSha256 } from '../src/document-extraction/__tests__/helpers/pdfFixture'

const OUT = process.env.V40S3_SEED_OUT
const PDF_NAME = 'taskbook-TB-2026-1110.pdf'

describe('V4.0 阶段3 证据夹具', () => {
  it.skipIf(!OUT)('生成含隔套参数与真实 PDF 附件的项目文件', async () => {
    const base = await createSpacerSnapshot({ confirmed: true })
    const pdf = fixtureBytes(PDF_NAME)
    const sha = fixtureSha256(PDF_NAME)
    const snapshot: ProjectFileSnapshot = {
      ...base,
      project: {
        ...base.project,
        name: '隔套 · 阶段3 侧栏走查',
        extractionDrafts: [],
        requirementRevisions: [],
        activeRequirementRevisionId: null,
        currentRequirementCheck: null,
      },
      documents: [{ ...base.documents[0]!, title: PDF_NAME }],
      revisions: [{ ...base.revisions[0]!, fileName: PDF_NAME, sha256: sha, byteSize: pdf.byteLength, pageCount: 2 }],
      blobs: [{ ...base.blobs[0]!, sha256: sha, byteSize: pdf.byteLength }],
      attachments: [{ blobKey: base.blobs[0]!.blobKey, bytes: pdf }],
    }
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok, encoded.ok ? '' : JSON.stringify(encoded.error)).toBe(true)
    if (!encoded.ok) return
    await fsp.mkdir(path.dirname(OUT!), { recursive: true })
    await fsp.writeFile(OUT!, encoded.value.bytes)
    console.log(`SEED_WRITTEN ${OUT}`)
  }, 120_000)
})
