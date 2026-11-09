/**
 * STL 解析与几何校验（V3-B2 纯模块，任务卡 §6）。
 *
 * 设计约束：
 * - 只接受二进制或严格 ASCII STL；不根据扩展名/文件名判定；
 * - 二进制优先按「84 + 50×N 精确等于长度」判定，短文件不会被当空模型；
 * - 长度不匹配时只尝试严格 ASCII；失败且头声明了面数则报
 *   STL_BINARY_LENGTH_MISMATCH，并附声明/期望/实际字节；
 * - ASCII 逐 facet 计数，到 200001 立即拒绝，不等整个文本解析完；
 * - 每个 normal/vertex 必须是有限值（float32 转换后同样有限）；零法线允许；
 * - 每个三角面在最终 Float32 坐标上用 double 叉积检查零面积/共线/重复顶点，
 *   精确为零才拒绝，不设工程 epsilon、不静默删面；
 * - 原坐标不改、不缩放；只计算包围盒与包围球半径供相机 framing。
 *
 * 本模块不 import three / fs / Electron，main 与 renderer 共用同一实现。
 */
import {
  DEFAULT_STL_LIMITS,
  STL_BINARY_FACET_BYTES,
  STL_BINARY_HEADER_BYTES,
  type StlLimits,
} from './stlLimits'

export type StlErrorCode =
  | 'STL_EMPTY'
  | 'STL_TOO_LARGE'
  | 'STL_TOO_MANY_TRIANGLES'
  | 'STL_BINARY_LENGTH_MISMATCH'
  | 'STL_INVALID_ASCII'
  | 'STL_NON_FINITE'
  | 'STL_DEGENERATE_TRIANGLE'
  | 'STL_GEOMETRY_RANGE'
  | 'STL_INVALID_FORMAT'

export interface StlError {
  code: StlErrorCode
  message: string
  detail?: string
}

export type StlResult<T> = { ok: true; value: T } | { ok: false; error: StlError }

export type StlEncoding = 'binary' | 'ascii'

export interface StlBounds {
  min: [number, number, number]
  max: [number, number, number]
}

export interface StlGeometry {
  encoding: StlEncoding
  triangleCount: number
  /** 每面 9 个坐标（a,b,c），原顶点顺序，float32。 */
  positions: Float32Array
  /** 每面 9 个法线分量（同一面法线重复 3 次），零法线保持为零。 */
  normals: Float32Array
  bounds: StlBounds
  /** 包围球半径（double 计算）；有限且 > 0。 */
  radius: number
}

function error<T>(code: StlErrorCode, message: string, detail?: string): StlResult<T> {
  return detail === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, detail } }
}

const DECODER = new TextDecoder('utf-8', { fatal: true })
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

/** 文件是否像 ASCII STL 文本：可 UTF-8 解码且（忽略 BOM/空白后）以 solid 开头。 */
function looksLikeAsciiText(bytes: Uint8Array): boolean {
  let text: string
  try {
    text = DECODER.decode(bytes)
  } catch {
    return false
  }
  return text.replace(/^\uFEFF/, '').trimStart().startsWith('solid')
}

/** float32 转换后仍有限的数值；否则 null。 */
function finite32(value: number): number | null {
  const rounded = Math.fround(value)
  return Number.isFinite(rounded) ? rounded : null
}

type Xyz = [number, number, number]

interface TriangleSink {
  push(
    normal: Xyz,
    a: Xyz,
    b: Xyz,
    c: Xyz,
  ): StlError | null
  finish(): StlResult<StlGeometry>
}

/** 逐面校验并累积；数组按面数增长（ASCII 预先不知道总面数），上限受 maxTriangles 约束。 */
function createSink(initialCapacity: number, encoding: StlEncoding, maxTriangles: number): TriangleSink {
  let capacity = Math.max(1, Math.min(initialCapacity, maxTriangles))
  let positions = new Float32Array(capacity * 9)
  let normals = new Float32Array(capacity * 9)
  let index = 0
  const min: Xyz = [Infinity, Infinity, Infinity]
  const max: Xyz = [-Infinity, -Infinity, -Infinity]

  const ensure = (faceCount: number): void => {
    if (faceCount <= capacity) return
    let next = capacity
    while (next < faceCount) next = Math.min(maxTriangles, next * 2)
    const nextPositions = new Float32Array(next * 9)
    const nextNormals = new Float32Array(next * 9)
    nextPositions.set(positions)
    nextNormals.set(normals)
    positions = nextPositions
    normals = nextNormals
    capacity = next
  }

  const same = (p: readonly number[], q: readonly number[]): boolean =>
    p[0] === q[0] && p[1] === q[1] && p[2] === q[2]

  return {
    push(normal, a, b, c) {
      const face = index / 9 + 1
      ensure(face)
      if (index + 9 > positions.length) {
        // 上限外的面不应到达这里：调用方必须先在解析阶段按 maxTriangles 拒绝。
        return {
          code: 'STL_TOO_MANY_TRIANGLES',
          message: `STL 三角面数超过上限 ${maxTriangles}`,
          detail: `第 ${face} 个三角面`,
        }
      }
      for (const [label, tri] of [
        ['法线', normal],
        ['顶点', a],
        ['顶点', b],
        ['顶点', c],
      ] as const) {
        for (let axis = 0; axis < 3; axis += 1) {
          if (!Number.isFinite(tri[axis])) {
            return {
              code: 'STL_NON_FINITE',
              message: 'STL 含非有限数值（NaN 或 Infinity）',
              detail: `面 ${face} ${label}分量 ${'xyz'[axis]} = ${String(tri[axis])}`,
            }
          }
        }
      }
      if (same(a, b) || same(a, c) || same(b, c)) {
        return {
          code: 'STL_DEGENERATE_TRIANGLE',
          message: 'STL 含退化三角面（重复顶点）',
          detail: `面 ${face}`,
        }
      }
      const ux = b[0] - a[0]
      const uy = b[1] - a[1]
      const uz = b[2] - a[2]
      const vx = c[0] - a[0]
      const vy = c[1] - a[1]
      const vz = c[2] - a[2]
      const nx = uy * vz - uz * vy
      const ny = uz * vx - ux * vz
      const nz = ux * vy - uy * vx
      if (nx === 0 && ny === 0 && nz === 0) {
        return {
          code: 'STL_DEGENERATE_TRIANGLE',
          message: 'STL 含退化三角面（共线或零面积）',
          detail: `面 ${face}`,
        }
      }
      positions[index] = a[0]
      positions[index + 1] = a[1]
      positions[index + 2] = a[2]
      positions[index + 3] = b[0]
      positions[index + 4] = b[1]
      positions[index + 5] = b[2]
      positions[index + 6] = c[0]
      positions[index + 7] = c[1]
      positions[index + 8] = c[2]
      for (let axis = 0; axis < 3; axis += 1) {
        normals[index + axis] = normal[axis]
        normals[index + 3 + axis] = normal[axis]
        normals[index + 6 + axis] = normal[axis]
      }
      index += 9
      for (const tri of [a, b, c]) {
        for (let axis = 0; axis < 3; axis += 1) {
          if (tri[axis] < min[axis]) min[axis] = tri[axis]
          if (tri[axis] > max[axis]) max[axis] = tri[axis]
        }
      }
      return null
    },
    finish() {
      const triangleCount = index / 9
      const used = triangleCount * 9
      const span: Xyz = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
      if (!span.every((value) => Number.isFinite(value) && value >= 0)) {
        return error('STL_GEOMETRY_RANGE', 'STL 包围盒不可表示')
      }
      if (!span.some((value) => value > 0)) {
        return error('STL_GEOMETRY_RANGE', 'STL 几何范围为零，无法建立可显示的视图')
      }
      const radius = 0.5 * Math.hypot(span[0], span[1], span[2])
      if (!Number.isFinite(radius) || radius <= 0) {
        return error('STL_GEOMETRY_RANGE', 'STL 包围球半径不可表示')
      }
      return {
        ok: true,
        value: {
          encoding,
          triangleCount,
          positions: positions.slice(0, used),
          normals: normals.slice(0, used),
          bounds: { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] },
          radius,
        },
      }
    },
  }
}

function parseBinary(bytes: Uint8Array, count: number, limits: StlLimits): StlResult<StlGeometry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sink = createSink(count, 'binary', limits.maxTriangles)
  let offset = STL_BINARY_HEADER_BYTES
  const read = (at: number): Xyz => [
    view.getFloat32(at, true),
    view.getFloat32(at + 4, true),
    view.getFloat32(at + 8, true),
  ]
  for (let face = 0; face < count; face += 1) {
    const failure = sink.push(
      read(offset),
      read(offset + 12),
      read(offset + 24),
      read(offset + 36),
    )
    if (failure) return { ok: false, error: failure }
    offset += STL_BINARY_FACET_BYTES
  }
  return sink.finish()
}

type State = 'outside' | 'solid' | 'facet' | 'loop' | 'afterLoop'

/**
 * 严格 ASCII 解析（行级状态机，错误带行号/面号）。
 * 允许空行、首尾空白、UTF-8 BOM 与多个 solid；不接受尾随垃圾。
 */
function parseAsciiStrict(bytes: Uint8Array, limits: StlLimits): StlResult<StlGeometry> {
  let text: string
  try {
    text = DECODER.decode(bytes)
  } catch {
    return error('STL_INVALID_ASCII', 'STL 文本不是合法 UTF-8')
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.split(/\r?\n/)

  let state: State = 'outside'
  let lineNo = 0
  let facetCount = 0
  let solidCount = 0
  let normal: Xyz = [0, 0, 0]
  let vertices: Xyz[] = []
  let sink: TriangleSink | null = null

  const readNumbers = (tokens: string[], label: string): StlResult<number[]> => {
    const values: number[] = []
    for (const token of tokens) {
      if (!NUMBER_PATTERN.test(token)) {
        return error('STL_INVALID_ASCII', `ASCII 第 ${lineNo} 行 ${label} 含无法解析的数值`, token)
      }
      values.push(Number(token))
    }
    return { ok: true, value: values }
  }

  const roundTriple = (values: number[], label: string): StlResult<Xyz> => {
    const rounded: Xyz = [0, 0, 0]
    for (let axis = 0; axis < 3; axis += 1) {
      const value = finite32(values[axis] ?? NaN)
      if (value === null) {
        return error(
          'STL_NON_FINITE',
          `STL ${label}含非有限数值（float32 不可表示）`,
          `第 ${lineNo} 行 面 ${facetCount} 分量 ${'xyz'[axis]} = ${String(values[axis])}`,
        )
      }
      rounded[axis] = value
    }
    return { ok: true, value: rounded }
  }

  for (let index = 0; index < lines.length; index += 1) {
    lineNo = index + 1
    const line = (lines[index] ?? '').trim()
    if (line === '') continue
    const tokens = line.split(/\s+/)
    const keyword = tokens[0]

    if (state === 'outside') {
      if (keyword !== 'solid') {
        return error('STL_INVALID_ASCII', `ASCII 第 ${lineNo} 行不是 solid 开头`, line.slice(0, 80))
      }
      state = 'solid'
      solidCount += 1
      if (solidCount > 1000) {
        return error(
          'STL_INVALID_ASCII',
          `ASCII 第 ${lineNo} 行 solid 块数量异常`,
          `已出现 ${solidCount} 个 solid`,
        )
      }
      continue
    }

    if (state === 'solid') {
      if (keyword === 'endsolid') {
        state = 'outside'
        continue
      }
      if (keyword !== 'facet' || tokens[1] !== 'normal') {
        return error(
          'STL_INVALID_ASCII',
          `ASCII 第 ${lineNo} 行应为 facet normal 或 endsolid`,
          line.slice(0, 80),
        )
      }
      facetCount += 1
      if (facetCount > limits.maxTriangles) {
        return error(
          'STL_TOO_MANY_TRIANGLES',
          `STL 三角面数超过上限 ${limits.maxTriangles}`,
          `第 ${lineNo} 行开始第 ${facetCount} 个 facet`,
        )
      }
      if (tokens.length !== 5) {
        return error(
          'STL_INVALID_ASCII',
          `ASCII 第 ${lineNo} 行 facet normal 需要 3 个数值`,
          line.slice(0, 80),
        )
      }
      const parsed = readNumbers(tokens.slice(2), 'facet normal')
      if (!parsed.ok) return parsed
      const rounded = roundTriple(parsed.value, '法线')
      if (!rounded.ok) return rounded
      normal = rounded.value
      state = 'facet'
      continue
    }

    if (state === 'facet') {
      if (keyword !== 'outer' || tokens.length !== 2 || tokens[1] !== 'loop') {
        return error(
          'STL_INVALID_ASCII',
          `ASCII 第 ${lineNo} 行应为 outer loop（面 ${facetCount}）`,
          line.slice(0, 80),
        )
      }
      vertices = []
      state = 'loop'
      continue
    }

    if (state === 'loop') {
      if (vertices.length < 3) {
        if (keyword !== 'vertex' || tokens.length !== 4) {
          return error(
            'STL_INVALID_ASCII',
            `ASCII 第 ${lineNo} 行应为 vertex x y z（面 ${facetCount} 第 ${vertices.length + 1} 个顶点）`,
            line.slice(0, 80),
          )
        }
        const parsed = readNumbers(tokens.slice(1), 'vertex')
        if (!parsed.ok) return parsed
        const rounded = roundTriple(parsed.value, '顶点')
        if (!rounded.ok) return rounded
        vertices.push(rounded.value)
        continue
      }
      if (keyword !== 'endloop' || tokens.length !== 1) {
        return error(
          'STL_INVALID_ASCII',
          `ASCII 第 ${lineNo} 行面 ${facetCount} 已有 3 个顶点，应为 endloop`,
          line.slice(0, 80),
        )
      }
      state = 'afterLoop'
      continue
    }

    if (keyword !== 'endfacet' || tokens.length !== 1) {
      return error(
        'STL_INVALID_ASCII',
        `ASCII 第 ${lineNo} 行缺 endfacet（面 ${facetCount}）`,
        line.slice(0, 80),
      )
    }
    if (sink === null) {
      sink = createSink(1024, 'ascii', limits.maxTriangles)
    }
    const failure = sink.push(
      normal,
      vertices[0] as Xyz,
      vertices[1] as Xyz,
      vertices[2] as Xyz,
    )
    if (failure) return { ok: false, error: failure }
    state = 'solid'
    vertices = []
    normal = [0, 0, 0]
  }

  if (state !== 'outside') {
    const detail =
      state === 'facet' || state === 'loop'
        ? `文件在面 ${facetCount} 未闭合时结束`
        : `文件在 solid 未闭合时结束（第 ${lineNo} 行后）`
    return error('STL_INVALID_ASCII', 'ASCII STL 未完整结束', detail)
  }
  if (solidCount === 0) {
    return error('STL_INVALID_ASCII', '不是 STL：缺少 solid 块')
  }
  if (facetCount === 0 || sink === null) {
    return error('STL_EMPTY', 'STL 不含任何三角面')
  }
  return sink.finish()
}

/**
 * 解析 STL 字节。调用方必须先完成文件大小/存在性检查；本函数仍会复核大小。
 */
export function parseStl(
  bytes: Uint8Array,
  limits: StlLimits = DEFAULT_STL_LIMITS,
): StlResult<StlGeometry> {
  if (bytes.byteLength === 0) {
    return error('STL_EMPTY', 'STL 文件为空（0 字节）')
  }
  if (bytes.byteLength > limits.maxBytes) {
    return error(
      'STL_TOO_LARGE',
      `STL 文件超过单文件上限 ${limits.maxBytes} 字节（10 MiB）`,
      `实际 ${bytes.byteLength} 字节`,
    )
  }

  if (bytes.byteLength >= STL_BINARY_HEADER_BYTES) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const declared = view.getUint32(80, true)
    const expected = STL_BINARY_HEADER_BYTES + declared * STL_BINARY_FACET_BYTES
    if (expected === bytes.byteLength) {
      if (declared === 0) {
        return error('STL_EMPTY', '二进制 STL 声明 0 个三角面')
      }
      if (declared > limits.maxTriangles) {
        return error(
          'STL_TOO_MANY_TRIANGLES',
          `STL 三角面数超过上限 ${limits.maxTriangles}`,
          `声明 ${declared} 面，期望 ${expected} 字节，实际 ${bytes.byteLength} 字节`,
        )
      }
      const binary = parseBinary(bytes, declared, limits)
      if (binary.ok) return binary
      // 长度碰巧匹配但二进制结构不成立：仅当严格 ASCII 也成立时才接受。
      const ascii = parseAsciiStrict(bytes, limits)
      return ascii.ok ? ascii : binary
    }
    // 长度不匹配：只尝试严格 ASCII，ASCII 成立就不按二进制误判。
    const ascii = parseAsciiStrict(bytes, limits)
    if (ascii.ok) return ascii
    // 文本明确以 solid 开头：按 ASCII 结构错误返回（不把偏移 80 的随机字节
    // 当成二进制面数）。只有非文本内容才继续按二进制长度不匹配解释。
    if (looksLikeAsciiText(bytes)) return ascii
    if (declared > limits.maxTriangles) {
      return error(
        'STL_TOO_MANY_TRIANGLES',
        `STL 三角面数超过上限 ${limits.maxTriangles}`,
        `声明 ${declared} 面，期望 ${expected} 字节，实际 ${bytes.byteLength} 字节`,
      )
    }
    if (declared > 0) {
      return error(
        'STL_BINARY_LENGTH_MISMATCH',
        '二进制 STL 长度与声明面数不一致',
        `声明 ${declared} 面，期望 ${expected} 字节，实际 ${bytes.byteLength} 字节`,
      )
    }
    return ascii
  }

  return parseAsciiStrict(bytes, limits)
}
