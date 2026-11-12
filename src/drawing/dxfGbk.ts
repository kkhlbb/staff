/**
 * DXF 文本的 GBK 编码（纯 TS，无原生模块、不联网）。
 *
 * DXF R12 / 2000 没有 Unicode：中文靠 `$DWGCODEPAGE = ANSI_936` + GBK 字节
 * 才能在中文 CAD 里显示。表由 `scripts/gen-dxf-gbk-table.py` 从 GB2312
 * 生成并提交（见 `dxfGbkTable.ts`），运行时只做查表。
 *
 * 边界：表外字符（生僻字、emoji、其它文字）**抛错**，绝不写 `?` 或乱码——
 * 导出失败比给车间一份显示错字的图更安全。ASCII 0x20–0x7E 原样单字节。
 */
import {
  DXF_GBK_ASCII_RANGE,
  DXF_GBK_BYTES_BASE64,
  DXF_GBK_CODEPOINTS_BASE64,
  DXF_GBK_ENTRY_COUNT,
} from './dxfGbkTable'

export class DxfEncodingError extends Error {
  readonly code = 'DXF_TEXT_UNENCODABLE' as const
  readonly character: string
  readonly index: number

  constructor(character: string, index: number) {
    super(`DXF 文本含 GB2312 表外字符「${character}」（第 ${index} 个字符），已拒绝导出而不是写乱码`)
    this.name = 'DxfEncodingError'
    this.character = character
    this.index = index
  }
}

function decodeBase64(input: readonly string[]): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const text = input.join('')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const character of text) {
    if (character === '=') break
    const value = alphabet.indexOf(character)
    if (value < 0) throw new Error(`GBK 表 base64 非法字符：${character}`)
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return Uint8Array.from(bytes)
}

interface GbkTable {
  codepoints: Uint16Array
  pairs: Uint8Array
}

let cached: GbkTable | null = null

function table(): GbkTable {
  if (cached !== null) return cached
  const codepointBytes = decodeBase64(DXF_GBK_CODEPOINTS_BASE64)
  const pairBytes = decodeBase64(DXF_GBK_BYTES_BASE64)
  if (codepointBytes.byteLength !== DXF_GBK_ENTRY_COUNT * 2) {
    throw new Error('GBK 表码位长度与条目数不一致（生成文件损坏）')
  }
  if (pairBytes.byteLength !== DXF_GBK_ENTRY_COUNT * 2) {
    throw new Error('GBK 表字节长度与条目数不一致（生成文件损坏）')
  }
  const codepoints = new Uint16Array(DXF_GBK_ENTRY_COUNT)
  for (let index = 0; index < DXF_GBK_ENTRY_COUNT; index += 1) {
    codepoints[index] = codepointBytes[index * 2] | (codepointBytes[index * 2 + 1] << 8)
  }
  cached = { codepoints, pairs: pairBytes }
  return cached
}

function lookup(codePoint: number): [number, number] | null {
  const { codepoints, pairs } = table()
  let low = 0
  let high = codepoints.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const value = codepoints[middle]
    if (value === codePoint) {
      return [pairs[middle * 2], pairs[middle * 2 + 1]]
    }
    if (value < codePoint) low = middle + 1
    else high = middle - 1
  }
  return null
}

/** 把一条 DXF 字符串编码为 GBK 字节；表外字符抛 DxfEncodingError。 */
export function encodeDxfText(text: string): Uint8Array {
  const [asciiLow, asciiHigh] = DXF_GBK_ASCII_RANGE
  const bytes: number[] = []
  let index = 0
  for (const character of text) {
    const codePoint = character.codePointAt(0) as number
    if (codePoint >= asciiLow && codePoint <= asciiHigh) {
      bytes.push(codePoint)
    } else if (codePoint === 0x0a || codePoint === 0x0d) {
      // DXF 的分组分隔符（CRLF）是单字节控制字符，不是文本内容。
      bytes.push(codePoint)
    } else if (codePoint > 0xffff) {
      throw new DxfEncodingError(character, index)
    } else {
      const pair = lookup(codePoint)
      if (pair === null) throw new DxfEncodingError(character, index)
      bytes.push(pair[0], pair[1])
    }
    index += 1
  }
  return Uint8Array.from(bytes)
}

/** 测试/证据用：本表能否编码该字符（不抛错）。 */
export function canEncodeDxfText(text: string): boolean {
  try {
    encodeDxfText(text)
    return true
  } catch {
    return false
  }
}
