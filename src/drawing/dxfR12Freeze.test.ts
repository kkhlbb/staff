/**
 * R12 冻结区：出图加深不许改 R12 输出。
 *
 * 这里的 SHA-256 不是「新算的」，是**先证明过与 main@791483c 逐字节相同**之后记下来的
 * golden 值（对比日志：docs/evidence/dxf-depth/logs/31-r12-byte-identical.log，
 * 做法：把 main 的 dxfExport.ts 原样拷成临时模块，同一份 DrawingData 各生成一次，
 * 比字节数 + SHA-256 + 每个字节）。任何改动让 R12 变一个字节，这些用例就红。
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildSpacerDrawing } from './spacerDrawing'
import { buildDxfDocument } from './dxfExport'
import { USER_INPUT_BASIS, type DrawingData, type DrawingScale, type ParameterSnapshotItem } from './types'

const PARAMS: ParameterSnapshotItem[] = [
  { parameterId: 'param:spacer:inner-diameter', partId: 'builtin:shaft-demo:spacer', key: 'innerDiameter', valueQ: 200000, inputDecimals: 2, reviewStatus: 'confirmed' },
  { parameterId: 'param:spacer:outer-diameter', partId: 'builtin:shaft-demo:spacer', key: 'outerDiameter', valueQ: 320000, inputDecimals: 2, reviewStatus: 'confirmed' },
  { parameterId: 'param:spacer:length', partId: 'builtin:shaft-demo:spacer', key: 'length', valueQ: 120500, inputDecimals: 2, reviewStatus: 'confirmed' },
]

const FRAME = {
  partName: '隔套',
  drawingNumber: 'DEMO-001',
  version: '草稿 v1',
  material: '45 钢',
  tolerance: '未注公差按 IT12',
  surface: 'Ra 1.6',
  drafter: '代达罗斯',
  date: '2026-11-11',
}

function drawingAt(scale: DrawingScale, basis?: string): DrawingData {
  return buildSpacerDrawing({
    projectId: 'project:r12-baseline',
    revisionId: 'rev-cfg-1',
    drawingId: 'drawing:r12-baseline',
    parameters: PARAMS,
    scale,
    frameFields: basis === undefined ? FRAME : { ...FRAME, basis },
  })
}

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** main@791483c 的 R12 输出（已逐字节比过）。 */
const GOLDEN: { name: string; scale: DrawingScale; basis?: string; bytes: number; sha256: string }[] = [
  { name: '1:1', scale: { numerator: 1, denominator: 1 }, bytes: 8676, sha256: 'bdbb9aa9aed11dd43bccbafc3cb303ed9de07b3404c000b90b08fe0955d5624b' },
  { name: '1:2', scale: { numerator: 1, denominator: 2 }, bytes: 8704, sha256: '00e7dc42b424e94bb5be0f3537ad5d7e63561737799b5958dbc2bae7180d252f' },
  { name: '2:1', scale: { numerator: 2, denominator: 1 }, bytes: 8649, sha256: '1880a6d86812f478abf47dbd54fe0c703b31c9686b0acb261d30665b86eab197' },
  { name: '1:1 无来源', scale: { numerator: 1, denominator: 1 }, basis: USER_INPUT_BASIS, bytes: 9242, sha256: '4689af9c56f6053b6a5381d5a8e6662e689fbef200b8c32833376280a7c32794' },
]

describe('R12 冻结：字节数与 SHA-256 与 main@791483c 一致', () => {
  for (const entry of GOLDEN) {
    it(`${entry.name}：${entry.bytes} 字节 / ${entry.sha256.slice(0, 12)}…`, () => {
      const build = buildDxfDocument(drawingAt(entry.scale, entry.basis), 'r12')
      expect(build.bytes.byteLength).toBe(entry.bytes)
      expect(sha(build.bytes)).toBe(entry.sha256)
    })
  }
})
