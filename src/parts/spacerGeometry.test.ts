import { describe, expect, it } from 'vitest'
import { createDemoAssembly, assemblyPart } from './shaftDemoGeometry'

describe('D-3D：隔套示意几何随参数更新（只替换网格）', () => {
  it('长度 12→14、内外径同步变化；其他部件与选择/爆炸语义不变', () => {
    const assembly = createDemoAssembly()
    expect(assembly.parts).toHaveLength(5)
    expect(assembly.spacerLengthMm()).toBeCloseTo(12, 4)

    const otherBefore = assembly.parts
      .filter((part) => part.id !== 'builtin:shaft-demo:spacer')
      .map((part) => [part.id, part.group.position.toArray(), part.geometry.boundingBox?.max.toArray()])

    assembly.setSpacerDimensions({ innerRadius: 10, outerRadius: 16, length: 14 })
    expect(assembly.spacerLengthMm()).toBeCloseTo(14, 4)
    const spacer = assemblyPart(assembly, 'builtin:shaft-demo:spacer')
    spacer.geometry.computeBoundingBox()
    expect(spacer.geometry.boundingBox!.max.y).toBeCloseTo(16, 4)
    expect(spacer.geometry.boundingBox!.min.y).toBeCloseTo(-16, 4)

    // 其他部件几何与位置未变；装配/爆炸仍然只改 Group.position。
    const otherAfter = assembly.parts
      .filter((part) => part.id !== 'builtin:shaft-demo:spacer')
      .map((part) => [part.id, part.group.position.toArray(), part.geometry.boundingBox?.max.toArray()])
    expect(otherAfter).toEqual(otherBefore)
    assembly.setExplodeT(0)
    expect(assemblyPart(assembly, 'builtin:shaft-demo:bearing-left').group.position.x).toBeLessThan(0)
    assembly.setExplodeT(1)
    expect(assemblyPart(assembly, 'builtin:shaft-demo:bearing-left').group.position.x).toBeCloseTo(-40, 4)
    assembly.dispose()
    assembly.dispose()
  })

  it('创建时直接按参数构造（草稿/正式同源）', () => {
    const assembly = createDemoAssembly({ innerRadius: 9, outerRadius: 15, length: 16 })
    expect(assembly.spacerLengthMm()).toBeCloseTo(16, 4)
    assembly.dispose()
  })
})
