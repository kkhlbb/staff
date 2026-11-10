/**
 * V3.6 体验补丁证据生成器（显式运行，不进入 npm test / test:desktop）。
 *
 * 生成一个 schema8 项目文件，供打包应用通过 LaunchServices open-file 打开后：
 * - 「任务书提取」入口有未决角标（4 待确认 + 1 阻塞，来自项目文件里的 extractionDrafts）；
 * - 复核区的「条款版本历史」有 5 个版本（4 行以上），用于量默认高度。
 *
 * 所有条款版本走真实 confirmOrUpdateRequirement 路径；提取草稿走真实
 * buildPdfTextLayer → buildExtractionDraft 路径（合成文本层，不读 PDF）。
 *
 * 用法：
 *   V36_UI_SEED_OUT=/abs/path/UI-V36.cunlian npx vitest run --config vitest.v36fixture.config.ts
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectFileSnapshot } from '../src/project-file/types'
import { encodeProjectFile } from '../src/project-file/codec'
import {
  createTwoVersionRequirementProject,
  REQUIREMENT_SOURCE,
} from '../src/requirements/__fixtures__/requirementFixture'
import { confirmOrUpdateRequirement } from '../src/requirements/confirm'
import { SAMPLE_PROJECT_ID } from '../src/project-file/__fixtures__/sampleProjectFile'
import { buildSyntheticExtractionDraft } from '../src/document-extraction/__fixtures__/draftFixture'

const OUT = process.env.V36_UI_SEED_OUT

/** 在第 2 版之后继续建第 3、4、5 版（每次换页码/选区，来源仍指同一确切 PDF 版本）。 */
async function addVersions(snapshot: ProjectFileSnapshot, count: number): Promise<ProjectFileSnapshot> {
  let current = snapshot
  for (let index = 0; index < count; index += 1) {
    const version = index + 3
    const previous = current.project.requirementRevisions.at(-1)
    if (previous === undefined) throw new Error('缺少上一版条款')
    const confirmed = await confirmOrUpdateRequirement({
      snapshot: current,
      expectedBaseToken: 'base-1',
      currentBaseToken: 'base-1',
      expectedActiveRequirementRevisionId: previous.revisionId,
      requirementId: 'req-1',
      newRequirementId: 'req-1',
      newRevisionId: `reqrev-${version}`,
      newCheckId: `check-base-${version}`,
      newConfigRevisionId: `rev-cfg-${version}`,
      source: {
        ...REQUIREMENT_SOURCE,
        page: 1 + (version % 2),
        rectPdf: [10 + version * 10, 20 + version * 10, 110 + version * 10, 40 + version * 10],
      },
      confirmedText: `轴向装配间隙 C 应为 0.1000～0.3000 mm，含两端（第 ${version} 版任务书）`,
      lowerText: '0.1000',
      upperText: '0.3000',
      chainRef: { projectId: SAMPLE_PROJECT_ID, kind: 'project-dimension-chain' },
      confirmed: true,
      changeReason: `第 ${version} 版任务书重新核对间隙条款`,
      confirmedAt: `2026-11-1${version}T09:00:00.000Z`,
    })
    if (!confirmed.ok) {
      throw new Error(`建立第 ${version} 版失败：${confirmed.error.code}: ${confirmed.error.message}`)
    }
    current = confirmed.value.snapshot
  }
  return current
}

describe('V3.6 体验补丁证据夹具', () => {
  it.skipIf(!OUT)('生成含 5 个条款版本与未决提取草稿的项目文件', async () => {
    const two = await createTwoVersionRequirementProject()
    let snapshot: ProjectFileSnapshot = await addVersions(two.snapshot, 3)

    const revision = snapshot.revisions[0]!
    const draft = buildSyntheticExtractionDraft({
      projectId: snapshot.project.id,
      baseToken: `base-${snapshot.project.id}`,
      source: {
        documentId: revision.documentId,
        revisionId: revision.id,
        sha256: revision.sha256,
        blobKey: revision.blobKey,
        pageCount: revision.pageCount,
      },
    })
    expect(draft.candidates.filter((candidate) => candidate.status === 'pending')).toHaveLength(4)
    expect(draft.candidates.filter((candidate) => candidate.status === 'blocked')).toHaveLength(1)

    snapshot = {
      ...snapshot,
      project: { ...snapshot.project, extractionDrafts: [draft] },
    }
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok, encoded.ok ? '' : JSON.stringify(encoded.error)).toBe(true)
    if (!encoded.ok) return
    await fsp.mkdir(path.dirname(OUT!), { recursive: true })
    await fsp.writeFile(OUT!, encoded.value.bytes)
    console.log(`UI_SEED_WRITTEN ${OUT}`)
    console.log(`REVISIONS ${snapshot.project.requirementRevisions.length}`)
  }, 120_000)
})
