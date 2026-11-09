import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STL_LIMITS,
  PROJECT_ASSETS_MAX_BYTES,
  STL_MAX_BYTES,
  STL_MAX_TRIANGLES,
  exceedsProjectAssets,
  sumUniqueBlobBytes,
} from './stlLimits'
import { parseStl } from './stlValidation'

const encoder = new TextEncoder()

type Vertex = readonly [number, number, number]
type Face = readonly Vertex[]

/** 合法非退化三角面：v=(0,0,0),(1,0,0),(0,1,0)，法线 +z。 */
const TRIANGLE: Face = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
]

function binaryStl(
  triangles: readonly Face[],
  options: { header?: string; declaredCount?: number; trailingBytes?: number; mutate?: (view: DataView, index: number) => void } = {},
): Uint8Array {
  const count = options.declaredCount ?? triangles.length
  const bytes = new Uint8Array(84 + triangles.length * 50 + (options.trailingBytes ?? 0))
  const view = new DataView(bytes.buffer)
  if (options.header !== undefined) {
    const header = encoder.encode(options.header.slice(0, 80))
    bytes.set(header, 0)
  }
  view.setUint32(80, count, true)
  triangles.forEach((triangle, index) => {
    const base = 84 + index * 50
    view.setFloat32(base, 0, true)
    view.setFloat32(base + 4, 0, true)
    view.setFloat32(base + 8, 1, true)
    triangle.forEach((vertex, v) => {
      view.setFloat32(base + 12 + v * 12, vertex[0], true)
      view.setFloat32(base + 16 + v * 12, vertex[1], true)
      view.setFloat32(base + 20 + v * 12, vertex[2], true)
    })
    options.mutate?.(view, index)
  })
  return bytes
}

function asciiStl(facets: readonly Face[], options: { solids?: number; name?: string } = {}): Uint8Array {
  const lines: string[] = []
  const solids = options.solids ?? 1
  for (let solid = 0; solid < solids; solid += 1) {
    lines.push(`solid ${options.name ?? 'test'}`)
    facets.forEach((triangle) => {
      lines.push('  facet normal 0 0 1')
      lines.push('    outer loop')
      triangle.forEach((vertex) => lines.push(`      vertex ${vertex[0]} ${vertex[1]} ${vertex[2]}`))
      lines.push('    endloop')
      lines.push('  endfacet')
    })
    lines.push('endsolid')
  }
  return encoder.encode(lines.join('\n'))
}

describe('B2-01 STL 限额常量', () => {
  it('10 MiB / 200000 面 / 100 MiB 项目附件均按二进制 MiB 计', () => {
    expect(STL_MAX_BYTES).toBe(10_485_760)
    expect(STL_MAX_TRIANGLES).toBe(200_000)
    expect(PROJECT_ASSETS_MAX_BYTES).toBe(104_857_600)
    expect(DEFAULT_STL_LIMITS).toEqual({ maxBytes: STL_MAX_BYTES, maxTriangles: STL_MAX_TRIANGLES })
  })

  it('唯一 blob 去重后才计入项目额度', () => {
    expect(
      sumUniqueBlobBytes([
        { blobKey: 'a', byteSize: 10 },
        { blobKey: 'a', byteSize: 10 },
        { blobKey: 'b', byteSize: 5 },
      ]),
    ).toBe(15)
    expect(exceedsProjectAssets(104_857_600 - 10, 10)).toBe(false)
    expect(exceedsProjectAssets(104_857_600 - 10, 11)).toBe(true)
  })
})

describe('B2-01 二进制 STL', () => {
  it('解析固定四面体：面数、包围盒、编码', () => {
    const tetra = [
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[0, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[0, 0, 0], [0, 0, 1], [1, 0, 0]],
      [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
    ] as const
    const result = parseStl(binaryStl(tetra))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.encoding).toBe('binary')
    expect(result.value.triangleCount).toBe(4)
    expect(result.value.positions).toHaveLength(4 * 9)
    expect(result.value.normals).toHaveLength(4 * 9)
    expect(result.value.bounds.min).toEqual([0, 0, 0])
    expect(result.value.bounds.max).toEqual([1, 1, 1])
    expect(result.value.radius).toBeGreaterThan(0)
  })

  it('80 字节头以 solid 开头且长度精确匹配时仍按二进制解析', () => {
    const result = parseStl(binaryStl([TRIANGLE], { header: 'solid not ascii header' }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.encoding).toBe('binary')
  })

  it('声明 0 面（长度 84）报 STL_EMPTY', () => {
    const result = parseStl(binaryStl([], { declaredCount: 0 }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('STL_EMPTY')
      expect(result.error.message).toContain('0 个三角面')
    }
  })

  it('声明面数与实际长度不符：报长度不匹配并附声明/期望/实际字节', () => {
    const result = parseStl(binaryStl([TRIANGLE, TRIANGLE], { declaredCount: 2, trailingBytes: 0 }).slice(0, 84 + 50))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('STL_BINARY_LENGTH_MISMATCH')
      expect(result.error.detail).toContain('声明 2 面')
      expect(result.error.detail).toContain('期望 184 字节')
      expect(result.error.detail).toContain('实际 134 字节')
    }
  })

  it('二进制尾随垃圾不被接受', () => {
    const result = parseStl(binaryStl([TRIANGLE], { trailingBytes: 3 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STL_BINARY_LENGTH_MISMATCH')
  })

  it('NaN 顶点报 STL_NON_FINITE 并带面号', () => {
    const bytes = binaryStl([TRIANGLE], {
      mutate: (view, index) => view.setFloat32(84 + index * 50 + 12, Number.NaN, true),
    })
    const result = parseStl(bytes)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('STL_NON_FINITE')
      expect(result.error.detail).toContain('面 1')
    }
  })

  it('重复顶点报 STL_DEGENERATE_TRIANGLE', () => {
    const result = parseStl(binaryStl([[[0, 0, 0], [0, 0, 0], [1, 1, 1]]]))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('STL_DEGENERATE_TRIANGLE')
      expect(result.error.message).toContain('重复顶点')
    }
  })

  it('共线零面积报 STL_DEGENERATE_TRIANGLE（不静默删面）', () => {
    const result = parseStl(binaryStl([[[0, 0, 0], [1, 0, 0], [2, 0, 0]]]))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('STL_DEGENERATE_TRIANGLE')
      expect(result.error.message).toContain('共线')
    }
  })

  it('200000 面（等于上限）可解析且字节低于 10 MiB', () => {
    const triangles = Array.from({ length: STL_MAX_TRIANGLES }, () => TRIANGLE)
    const bytes = binaryStl(triangles)
    expect(bytes.byteLength).toBe(84 + STL_MAX_TRIANGLES * 50)
    expect(bytes.byteLength).toBeLessThanOrEqual(STL_MAX_BYTES)
    const result = parseStl(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.triangleCount).toBe(STL_MAX_TRIANGLES)
  })

  it('200001 面：在分配几何数组前报 STL_TOO_MANY_TRIANGLES', () => {
    const triangles = Array.from({ length: STL_MAX_TRIANGLES + 1 }, () => TRIANGLE)
    const bytes = binaryStl(triangles)
    const started = Date.now()
    const result = parseStl(bytes)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('STL_TOO_MANY_TRIANGLES')
      expect(result.error.detail).toContain('200001')
    }
    // 预检路径不应遍历/分配 200001 面（经验阈值，只作守卫，不作性能承诺）。
    expect(Date.now() - started).toBeLessThan(200)
  })
})

describe('B2-01 ASCII STL', () => {
  it('支持 BOM、CRLF、科学计数法与多 solid', () => {
    const base = asciiStl([TRIANGLE, [[0, 0, 0], [1e0, 0, 0], [0, 1.5e-1, 0]]], { solids: 2 })
    const text = `\uFEFF${new TextDecoder().decode(base).replace(/\n/g, '\r\n')}`
    const result = parseStl(encoder.encode(text))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.encoding).toBe('ascii')
      expect(result.value.triangleCount).toBe(4)
      expect(Array.from(result.value.positions).some((value) => Math.abs(value - 0.15) < 1e-6)).toBe(true)
    }
  })

  it('零法线允许（显示法线可重算，不改原字节）', () => {
    const text = `solid z
facet normal 0 0 0
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid`
    const result = parseStl(encoder.encode(text))
    expect(result.ok).toBe(true)
    if (result.ok) expect(Array.from(result.value.normals.slice(0, 3))).toEqual([0, 0, 0])
  })

  it('缺 endfacet 报行号与面号', () => {
    const text = `solid a
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endsolid`
    const result = parseStl(encoder.encode(text))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('STL_INVALID_ASCII')
      expect(result.error.message).toContain('第 8 行')
      expect(result.error.message).toContain('endfacet')
    }
  })

  it('空 solid（零面）报 STL_EMPTY', () => {
    const result = parseStl(encoder.encode('solid empty\nendsolid empty\n'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STL_EMPTY')
  })

  it('非 STL 文本 / PDF 改名一律拒绝', () => {
    const pdf = encoder.encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n')
    const pdfResult = parseStl(pdf)
    expect(pdfResult.ok).toBe(false)
    const textResult = parseStl(encoder.encode('hello world\n'))
    expect(textResult.ok).toBe(false)
  })

  it('ASCII 数值转 float32 溢出报 STL_NON_FINITE', () => {
    const text = `solid a
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1e39 0 0
vertex 0 1 0
endloop
endfacet
endsolid`
    const result = parseStl(encoder.encode(text))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STL_NON_FINITE')
  })

  it('ASCII 200001 面：用放大的字节额度单独命中面数上限', () => {
    const facets = Array.from({ length: STL_MAX_TRIANGLES + 1 }, () => TRIANGLE)
    const bytes = asciiStl(facets)
    const result = parseStl(bytes, { maxBytes: 64 * 1024 * 1024, maxTriangles: STL_MAX_TRIANGLES })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STL_TOO_MANY_TRIANGLES')
  })

  it('ASCII 在达到面数上限前先撞 10 MiB 字节上限', () => {
    const facets = Array.from({ length: STL_MAX_TRIANGLES }, () => TRIANGLE)
    const bytes = asciiStl(facets)
    expect(bytes.byteLength).toBeGreaterThan(STL_MAX_BYTES)
    const result = parseStl(bytes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STL_TOO_LARGE')
  })
})

describe('B2-01 字节边界', () => {
  it('恰好 10 MiB 的合法 ASCII（尾部空白）可通过；多 1 字节拒绝', () => {
    const solid = new TextDecoder().decode(asciiStl([TRIANGLE]))
    const padded = solid + ' '.repeat(STL_MAX_BYTES - solid.length)
    expect(padded.length).toBe(STL_MAX_BYTES)
    const exact = parseStl(encoder.encode(padded))
    expect(exact.ok).toBe(true)
    const over = new Uint8Array(STL_MAX_BYTES + 1)
    over.set(encoder.encode(padded))
    over[STL_MAX_BYTES] = 0x20
    const rejected = parseStl(over)
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.error.code).toBe('STL_TOO_LARGE')
      expect(rejected.error.detail).toContain(`${STL_MAX_BYTES + 1}`)
    }
  })

  it('0 字节与不足 84 字节的文本分别拒绝', () => {
    const empty = parseStl(new Uint8Array(0))
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.error.code).toBe('STL_EMPTY')
    const tiny = parseStl(encoder.encode('solid'))
    expect(tiny.ok).toBe(false)
    if (!tiny.ok) expect(tiny.error.code).toBe('STL_INVALID_ASCII')
  })
})
