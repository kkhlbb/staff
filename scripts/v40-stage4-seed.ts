/**
 * V4.0 阶段 4 打包走查夹具（显式运行，不进入常规测试）。
 *
 * 生成 A40 项目：隔套 20/32/12、尺寸链 H/B1/S/B2、活动条款 [0.1000,0.3000]，
 * 并附带真实两页任务书 PDF（用于来源定位）。
 *
 * 用法：
 *   V40S4_SEED_OUT=<path.cunlian> npx vitest run --config vitest.v40stage4fixture.config.ts
 */
import { readFileSync, promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRequirementProject } from '../src/requirements/__fixtures__/requirementFixture'
import { encodeProjectFile } from '../src/project-file/codec'
import type { ProjectFileSnapshot } from '../src/project-file/types'
import { sha256Hex } from '../src/sources/hash'

const OUT = process.env.V40S4_SEED_OUT
const PDF = 'src/document-extraction/__fixtures__/taskbook-TB-2026-1110.pdf'

describe('V4.0 阶段4 证据夹具', () => {
  it.skipIf(!OUT)('生成 A40 项目（含条款与任务书 PDF）', async () => {
    const base = await createRequirementProject()
    const bytes = new Uint8Array(readFileSync(PDF))
    const sha256 = await sha256Hex(bytes)
    const fileName = path.basename(PDF)
    const snapshot: ProjectFileSnapshot = {
      ...base.snapshot,
      project: {
        ...base.snapshot.project,
        name: 'A40 · 阶段4 真实模型走查',
        extractionDrafts: [],
        requirementRevisions: base.snapshot.project.requirementRevisions.map((revision) => ({
          ...revision,
          source: { ...revision.source, sha256 },
        })),
      },
      documents: base.snapshot.documents.map((document) => ({ ...document, title: fileName })),
      revisions: [{ ...base.snapshot.revisions[0]!, fileName, sha256, byteSize: bytes.byteLength, pageCount: 2 }],
      blobs: [{ ...base.snapshot.blobs[0]!, sha256, byteSize: bytes.byteLength }],
      attachments: [{ blobKey: base.snapshot.blobs[0]!.blobKey, bytes }],
    }
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok, encoded.ok ? '' : JSON.stringify(encoded.error)).toBe(true)
    if (!encoded.ok) return
    await fsp.mkdir(path.dirname(OUT!), { recursive: true })
    await fsp.writeFile(OUT!, encoded.value.bytes)
    console.log(`SEED_WRITTEN ${OUT}`)
  }, 120_000)
})
