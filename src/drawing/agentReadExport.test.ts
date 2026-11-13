import { describe, expect, it } from 'vitest'
import DxfParser from 'dxf-parser'
import { buildSpacerDrawing } from './spacerDrawing'
import { renderDrawingSvg } from './renderDrawingSvg'
import { buildDxfDocument } from './dxfExport'
import { SPACER_PARAMETER_IDS, SPACER_PART_ID, type ParameterSnapshotItem } from './types'
import type { EvidenceRef } from '../document-extraction/types'

const reading = {
  kind: 'agent-read', actorId: '张工', at: '2026-11-13T12:00:00Z', sessionSeq: 1,
  turnId: 'turn-1', modelId: null,
  source: { kind: 'pdf-page', revisionId: 'scan-1', sha256: 'a'.repeat(64), page: 2 },
  statement: '用户对照扫描件口述：长度 12 mm',
} as unknown as EvidenceRef
const parameters: ParameterSnapshotItem[] = (['innerDiameter', 'outerDiameter', 'length'] as const).map((key, index) => ({
  parameterId: SPACER_PARAMETER_IDS[key], partId: SPACER_PART_ID, key,
  valueQ: [200000, 320000, 120000][index], inputDecimals: 2, reviewStatus: 'confirmed',
  ...(key === 'length' ? { provenance: [reading] } : {}),
}))
function drawing(sourceProvenance?: readonly unknown[]) {
  return buildSpacerDrawing({ projectId: 'p', revisionId: 'r', drawingId: 'd', parameters,
    scale: { numerator: 1, denominator: 1 }, sourceProvenance,
    frameFields: { partName: '隔套', drawingNumber: '', version: '草稿', material: '', tolerance: '', surface: '', drafter: '', date: '' },
  })
}
describe('agent-read 图纸来源', () => {
  it('参数 provenance 冻结、标题栏和 PDF 共用 SVG 保留提供人/页，不伪装文本出处', () => {
    const data = drawing()
    expect(data.parameterSnapshot[2].provenance).toEqual([reading])
    expect(data.frame.fields.basis).toContain('第 2 页，张工 提供')
    const svg = renderDrawingSvg(data)
    expect(svg).toContain('读数来源：第 2 页，张工 提供')
    expect(svg).not.toContain('pdf-text')
  })
  it.each(['r12', '2000'] as const)('%s 真 DXF 字节读回可见来源', (version) => {
    const text = new TextDecoder('gbk').decode(buildDxfDocument(drawing(), version).bytes)
    const parsed = new DxfParser().parseSync(text)
    expect(parsed).not.toBeNull()
    expect(parsed!.entities.some((entity) => 'text' in entity && String(entity.text).includes('第 2 页，张工 提供'))).toBe(true)
  })
  it('环级 provenance 也进入来源栏，图片不伪造页码', () => {
    const image = { ...reading, kind: 'agent-read', actorId: '李工', source: { kind: 'image', imageId: 'img-1', sha256: 'b'.repeat(64) } }
    expect(drawing([image]).frame.fields.basis).toContain('图片，李工 提供')
  })
})
