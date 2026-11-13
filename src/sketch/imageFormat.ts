/**
 * 手绘草图入口：图片字节的格式判定与限额。
 *
 * 边界（本模块只做“能不能导入”的判断，不读像素内容、不做任何识别）：
 * - 只支持 PNG / JPEG；按文件头判真格式，不信扩展名；
 * - HEIC/HEIF 明确拒绝，并给出用户可执行的转换命令，绝不静默失败；
 * - 单张上限 20 MiB（20 × 1024 × 1024 字节），超限拒绝；
 * - 不解析图像尺寸、不采样、不推断尺寸数值。
 */

export const SKETCH_IMAGE_MAX_BYTES = 20 * 1024 * 1024

/** 图片格式判定结果；`heic` 用于给出明确提示，不是支持格式。 */
export type SketchImageFormat = 'png' | 'jpeg' | 'heic' | 'unknown'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/** HEIF/HEIC 的品牌码（`ftyp` 之后的 4 字节）。 */
const HEIC_BRANDS = new Set([
  'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1',
])

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let text = ''
  for (let index = 0; index < length; index += 1) {
    const value = bytes[start + index]
    if (value === undefined) return ''
    text += String.fromCharCode(value)
  }
  return text
}

/** 按文件头判定格式；不足以判定时返回 `unknown`（不猜）。 */
export function sniffImageFormat(bytes: Uint8Array): SketchImageFormat {
  if (bytes.byteLength >= 8 && PNG_MAGIC.every((value, index) => bytes[index] === value)) {
    return 'png'
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }
  // ISO-BMFF：偏移 4..7 是 'ftyp'，随后是主品牌。
  if (bytes.byteLength >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4).toLowerCase()
    if (HEIC_BRANDS.has(brand)) return 'heic'
  }
  return 'unknown'
}

/** HEIC 拒绝时给用户的可执行转换命令（sips 在本机可用；不自动执行）。 */
export function heicConversionHint(fileName: string): string {
  const safeName = fileName.replace(/[\r\n]/gu, ' ').trim() || 'sketch.heic'
  const base = safeName.replace(/\.(heic|heif)$/iu, '')
  return `HEIC/HEIF 暂不支持导入。请先在终端转换：sips -s format jpeg "${safeName}" --out "${base}.jpg"`
}

export type SketchImageRejection = {
  readonly code: 'TOO_LARGE' | 'UNSUPPORTED_FORMAT' | 'EMPTY_FILE'
  readonly message: string
}

/**
 * 导入前的格式/大小判定；通过返回 null。
 * 顺序：空文件 → 超限 → 格式（HEIC 在格式分支给出转换命令）。
 */
export function checkSketchImage(
  bytes: Uint8Array,
  fileName: string,
  maxBytes: number = SKETCH_IMAGE_MAX_BYTES,
): SketchImageRejection | null {
  if (bytes.byteLength === 0) {
    return { code: 'EMPTY_FILE', message: '图片为空（0 字节），没有可导入的内容' }
  }
  if (bytes.byteLength > maxBytes) {
    const mib = (value: number): string => (value / (1024 * 1024)).toFixed(1)
    return {
      code: 'TOO_LARGE',
      message: `图片 ${mib(bytes.byteLength)} MiB，超过单张上限 ${mib(maxBytes)} MiB；请压缩或缩小后再导入`,
    }
  }
  const format = sniffImageFormat(bytes)
  if (format === 'heic') {
    return { code: 'UNSUPPORTED_FORMAT', message: heicConversionHint(fileName) }
  }
  if (format === 'unknown') {
    return {
      code: 'UNSUPPORTED_FORMAT',
      message: '只支持 PNG / JPEG 图片；该文件不是可识别的 PNG/JPEG（按文件头判定，不看扩展名）',
    }
  }
  return null
}

/** 面向界面的一句话说明：只说明能做什么，不暗示会读图。 */
export const SKETCH_NO_MEASURE_NOTICE = '图上不测量，尺寸由你输入；框选只用来记住位置'
