/**
 * V3.5 补缺：条款版本历史的来源解析。
 *
 * 重点不是“有没有列表”，而是每个历史版本必须按自己的 revisionId 解析到
 * 确认当时的 PDF 版本、页码与选区；重新序列化后仍然如此。
 */
import { describe, expect, it } from 'vitest'
import { decodeProjectFile, encodeProjectFile } from '../project-file/codec'
import { createTwoVersionRequirementProject } from './__fixtures__/requirementFixture'
import {
  listRequirementRevisionHistory,
  resolveRequirementRevisionSource,
} from './history'

describe('V3.5 历史条款版本：按 revisionId 解析各自来源', () => {
  it('列出两个版本，旧版本仍指向首版 PDF/页码/选区，活动标记只属于新版', async () => {
    const project = await createTwoVersionRequirementProject()
    const history = listRequirementRevisionHistory(project.snapshot)

    expect(history.map((item) => item.revisionId)).toEqual(['reqrev-1', 'reqrev-2'])
    expect(history[0]).toMatchObject({
      parentRevisionId: null,
      sourceRevisionId: 'sr-1',
      sourcePage: 2,
      sourceRectPdf: [10, 10, 110, 30],
      isActive: false,
      issue: null,
    })
    expect(history[1]).toMatchObject({
      parentRevisionId: 'reqrev-1',
      sourceRevisionId: 'sr-taskbook-2',
      sourcePage: 1,
      sourceRectPdf: [20, 40, 220, 80],
      isActive: true,
      issue: null,
    })
  })

  it('两个版本的 pdfRevisionId/页码/rect 不同时，定位结果分别取各自值', async () => {
    const project = await createTwoVersionRequirementProject()
    const oldSource = resolveRequirementRevisionSource(project.snapshot, 'reqrev-1')
    const newSource = resolveRequirementRevisionSource(project.snapshot, 'reqrev-2')

    expect(oldSource.location).toMatchObject({
      requirementRevisionId: 'reqrev-1',
      revisionId: 'sr-1',
      page: 2,
      rectPdf: [10, 10, 110, 30],
    })
    expect(newSource.location).toMatchObject({
      requirementRevisionId: 'reqrev-2',
      revisionId: 'sr-taskbook-2',
      page: 1,
      rectPdf: [20, 40, 220, 80],
    })
    // 不允许两个版本都落到活动版本。
    expect(oldSource.location?.revisionId).not.toBe(newSource.location?.revisionId)
    expect(oldSource.location?.page).not.toBe(newSource.location?.page)
    expect(oldSource.location?.rectPdf).not.toEqual(newSource.location?.rectPdf)
  })

  it('编码/解码往返后，历史版本仍解析到同一来源与选区', async () => {
    const project = await createTwoVersionRequirementProject()
    const encoded = await encodeProjectFile(project.snapshot)
    expect(encoded.ok, encoded.ok ? '' : `${encoded.error.code}: ${encoded.error.message}`).toBe(
      true,
    )
    if (!encoded.ok) return

    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok, decoded.ok ? '' : `${decoded.error.code}: ${decoded.error.message}`).toBe(
      true,
    )
    if (!decoded.ok) return

    const history = listRequirementRevisionHistory(decoded.value.snapshot)
    expect(history.map((item) => item.sourceRevisionId)).toEqual([
      'sr-1',
      'sr-taskbook-2',
    ])
    const oldSource = resolveRequirementRevisionSource(
      decoded.value.snapshot,
      'reqrev-1',
    )
    expect(oldSource.location).toMatchObject({
      revisionId: 'sr-1',
      page: 2,
      rectPdf: [10, 10, 110, 30],
    })
    expect(oldSource.issue).toBeNull()
  })

  it('旧版本来源 PDF 被删时给出明确原因，不返回可打开的位置', async () => {
    const project = await createTwoVersionRequirementProject()
    const missing = {
      ...project.snapshot,
      revisions: project.snapshot.revisions.filter((item) => item.id !== 'sr-1'),
    }
    const oldSource = resolveRequirementRevisionSource(missing, 'reqrev-1')
    const history = listRequirementRevisionHistory(missing)

    expect(oldSource.location).not.toBeNull()
    expect(oldSource.location?.revisionId).toBe('sr-1')
    expect(oldSource.issue?.code).toBe('SOURCE_REVISION_MISSING')
    expect(oldSource.issue?.message).toContain('reqrev-1')
    expect(oldSource.issue?.message).toContain('sr-1')
    expect(oldSource.issue?.message).toContain('不在项目文件中')
    expect(history[0]?.issue?.code).toBe('SOURCE_REVISION_MISSING')
    // 活动版本仍然可用，但不能拿它顶替旧版本。
    expect(history[1]?.issue).toBeNull()
    expect(history[1]?.sourceRevisionId).toBe('sr-taskbook-2')
  })
})
