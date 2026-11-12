/**
 * DXF 字节 → 文本。只依赖 `TextDecoder`（运行时自带，无原生模块、不联网）。
 *
 * 规则（任务卡 §3）：
 * - `$DWGCODEPAGE=ANSI_936` → GBK；UTF-8 声明 / DXF 2007+（AC1021+）→ UTF-8；
 * - 解码失败不能装作没事：退回 Latin-1/Windows-1252 时 `warning=true`，
 *   界面必须显示「本文件编码未识别，文字可能不正确」。
 *
 * 不按「字节看起来像 UTF-8」去推翻文件里的 936 声明：GBK 的双字节序列有相当一部分
 * 恰好也是合法 UTF-8，猜错会把中文静默变成希伯来字母。声明优先，失败才换。
 */
import type { DxfEncodingInfo } from './types'

const LATIN1 = new TextDecoder('latin1')

export interface DecodedDxf {
  text: string
  encoding: DxfEncodingInfo
}

function tryDecode(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function asciiLines(bytes: Uint8Array): string[] {
  return LATIN1.decode(bytes).replace(/\r\n?/g, '\n').split('\n')
}

/**
 * 读 HEADER 段的变量值：变量名行（`$...`）后第一组「组码 + 值」。
 * 只用于 ASCII 的版本/代码页声明，不依赖正文编码。
 */
export function rawHeaderVariable(bytes: Uint8Array, variable: string): string | null {
  const lines = asciiLines(bytes)
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (lines[index].trim() !== variable) continue
    // 变量名后面的两行是组码与值；跳过空行，但组码必须是数字。
    for (let cursor = index + 1; cursor < Math.min(lines.length - 1, index + 6); cursor += 1) {
      const code = lines[cursor].trim()
      if (/^\d+$/.test(code)) {
        return lines[cursor + 1].replace(/\r$/, '').trim()
      }
    }
  }
  return null
}

function hasNonAscii(bytes: Uint8Array, start: number): boolean {
  for (let index = start; index < bytes.length; index += 1) {
    if (bytes[index] > 0x7f) return true
  }
  return false
}

function utf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

function declaredCharset(codepage: string, acadVersion: string): 'gbk' | 'utf-8' | 'windows-1252' | null {
  const upper = codepage.toUpperCase()
  if (upper.includes('936') || upper.includes('GB2312') || upper.includes('GBK')) return 'gbk'
  if (upper.includes('65001') || upper.includes('UTF-8') || upper.includes('UTF8')) return 'utf-8'
  // DXF 2007 起正文就是 UTF-8，和代码页无关。
  const match = /^AC(\d{4})$/.exec(acadVersion.toUpperCase())
  if (match !== null && Number(match[1]) >= 1021) return 'utf-8'
  if (upper.startsWith('ANSI_')) return 'windows-1252'
  return null
}

export function decodeDxfBytes(bytes: Uint8Array): DecodedDxf {
  const codepage = rawHeaderVariable(bytes, '$DWGCODEPAGE') ?? ''
  const acadVersion = rawHeaderVariable(bytes, '$ACADVER') ?? ''

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    const text = tryDecode(bytes.subarray(2), 'utf-16le')
    if (text !== null) {
      return {
        text,
        encoding: {
          charset: 'utf-16le',
          codepage: codepage || 'UTF-16LE',
          warning: false,
          detail: '文件带 UTF-16LE BOM，按 UTF-16LE 解码。',
        },
      }
    }
  }

  const bom = utf8Bom(bytes)
  const body = bom ? bytes.subarray(3) : bytes
  const declared = bom ? 'utf-8' : declaredCharset(codepage, acadVersion)

  if (declared === 'gbk') {
    const text = tryDecode(body, 'gbk')
    if (text !== null) {
      return {
        text,
        encoding: {
          charset: 'gbk',
          codepage: codepage || 'ANSI_936',
          warning: false,
          detail: `按文件头 $DWGCODEPAGE=${codepage || 'ANSI_936'} 用 GBK 解码。`,
        },
      }
    }
    // 936 声明但 GBK 解不开（例如实际是 UTF-8 或字节损坏）：换 UTF-8 再试。
    const utf8 = tryDecode(body, 'utf-8')
    if (utf8 !== null) {
      return {
        text: utf8,
        encoding: {
          charset: 'utf-8',
          codepage: codepage || 'ANSI_936',
          warning: true,
          detail: `文件头声明 ${codepage}，但 GBK 解码失败；已按 UTF-8 显示，文字可能不正确。`,
        },
      }
    }
  } else if (declared === 'utf-8' || (declared === null && hasNonAscii(body, 0))) {
    const text = tryDecode(body, 'utf-8')
    if (text !== null) {
      return {
        text,
        encoding: {
          charset: 'utf-8',
          codepage: codepage || 'UTF-8',
          warning: false,
          detail:
            declared === 'utf-8'
              ? `按 ${codepage || 'UTF-8'} 声明用 UTF-8 解码。`
              : '文件未声明代码页，字节是合法 UTF-8，按 UTF-8 解码。',
        },
      }
    }
    if (declared === 'utf-8') {
      const gbk = tryDecode(body, 'gbk')
      if (gbk !== null) {
        return {
          text: gbk,
          encoding: {
            charset: 'gbk',
            codepage: codepage || 'UTF-8',
            warning: true,
            detail: `文件声明 UTF-8，但按 UTF-8 解码失败；已按 GBK 显示，文字可能不正确。`,
          },
        }
      }
    }
  } else if (declared === 'windows-1252') {
    const text = tryDecode(body, 'windows-1252')
    if (text !== null) {
      return {
        text,
        encoding: {
          charset: 'windows-1252',
          codepage,
          warning: true,
          detail: `按文件头 ${codepage} 用 Windows-1252 解码；本工具只保证 GBK / UTF-8 中文正确。`,
        },
      }
    }
  }

  // 兜底：Latin-1 永不失败，但必须明确告诉用户文字可能不对。
  return {
    text: LATIN1.decode(body),
    encoding: {
      charset: 'unknown',
      codepage: codepage || '未声明',
      warning: true,
      detail: `文件编码未识别（代码页 ${codepage || '未声明'}）；已按单字节兜底显示，文字可能不正确。`,
    },
  }
}
