import { buildDxfDocument, type DxfVersion } from './dxfExport.ts'
import { renderDrawingSvg } from './renderDrawingSvg.ts'
import type { DrawingData } from './types.ts'

export function exportHeadlessDrawing(drawing: DrawingData, dxfVersion: DxfVersion = 'r12') {
  return { svg: renderDrawingSvg(drawing), dxf: buildDxfDocument(drawing, dxfVersion) }
}
