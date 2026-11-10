/**
 * V3.6 第 2 阶段证据生成器（显式运行，不进入 npm test / test:desktop）。
 *
 * 生成：含真实 TB-2026-1110 两页任务书附件的 schema8 项目文件，供打包应用
 * 通过 LaunchServices open-file 打开并截图。
 *
 * 用法：
 *   V36_SEED_OUT=<path.cunlian> npx vitest run --config vitest.v36fixture.config.ts
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSampleSnapshot } from '../src/project-file/__fixtures__/sampleProjectFile'
import { encodeProjectFile } from '../src/project-file/codec'
import type { ProjectFileSnapshot } from '../src/project-file/types'
import { fixtureBytes, fixtureSha256 } from '../src/document-extraction/__tests__/helpers/pdfFixture'

const OUT = process.env.V36_SEED_OUT
const PDF_NAME = 'taskbook-TB-2026-1110.pdf'

describe('V3.6 证据夹具', () => {
  it.skipIf(!OUT)('生成含 1110 PDF 附件、提取草稿为空的项目文件', async () => {
    const base = await createSampleSnapshot()
    const pdf = fixtureBytes(PDF_NAME)
    const sha = fixtureSha256(PDF_NAME)
    const snapshot: ProjectFileSnapshot = {
      ...base,
      project: { ...base.project, extractionDrafts: [] },
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
    console.log(`SEED_WRITTEN ${OUT}`)
  }, 120_000)
})
