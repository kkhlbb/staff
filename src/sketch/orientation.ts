/**
 * EXIF 方向：只读取字节里的 Orientation 标签，不识别图像内容。
 *
 * 支持的显示旋转：1（0°）、3（180°）、6（顺时针 90°）、8（顺时针 270°）。
 * 2/4/5/7 是镜像方向；本版不实现镜像显示，明确报“不支持”，
 * 由界面提示用户先用 sips 转正，而不是猜一个近似方向。
 */

export type SketchOrientation = 1 | 3 | 6 | 8

export type OrientationState =
  | { readonly kind: 'supported'; readonly value: SketchOrientation }
  | { readonly kind: 'mirrored'; readonly raw: 2 | 4 | 5 | 7 }
  | { readonly kind: 'unreadable'; readonly raw: number | null }

function isMirrored(raw: number): raw is 2 | 4 | 5 | 7 {
  return raw === 2 || raw === 4 || raw === 5 || raw === 7
}

function toState(raw: number | null): OrientationState {
  if (raw === null) return { kind: 'unreadable', raw: null }
  if (raw === 1 || raw === 3 || raw === 6 || raw === 8) return { kind: 'supported', value: raw }
  if (isMirrored(raw)) return { kind: 'mirrored', raw }
  return { kind: 'unreadable', raw }
}

/**
 * 读 JPEG 的 EXIF Orientation。非 JPEG、无 EXIF、缺标签一律按 1（正常方向），
 * 这是文件的事实缺省，不是猜测。
 */
export function readJpegOrientation(bytes: Uint8Array): OrientationState {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return toState(1)
  let offset = 2
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === undefined) break
    // 填充字节与无长度标记。
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) break
    const length = (bytes[offset + 2] ?? 0) * 256 + (bytes[offset + 3] ?? 0)
    if (length < 2 || offset + 2 + length > bytes.byteLength) break
    const segmentStart = offset + 4
    const segmentEnd = offset + 2 + length
    if (marker === 0xe1) {
      const exif = readExifOrientation(bytes, segmentStart, segmentEnd)
      if (exif !== null) return toState(exif)
    }
    offset += 2 + length
  }
  return toState(1)
}

function readExifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (start + 6 > end) return null
  // "Exif\0\0"
  if (bytes[start] !== 0x45 || bytes[start + 1] !== 0x78 || bytes[start + 2] !== 0x69 ||
    bytes[start + 3] !== 0x66 || bytes[start + 4] !== 0x00 || bytes[start + 5] !== 0x00) {
    return null
  }
  const tiff = start + 6
  if (tiff + 8 > end) return null
  const byteOrder = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49 ? 'le'
    : bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d ? 'be' : null
  if (byteOrder === null) return null
  const little = byteOrder === 'le'
  const u16 = (at: number): number => {
    if (at + 2 > end) return -1
    const a = bytes[at] ?? 0
    const b = bytes[at + 1] ?? 0
    return little ? a | (b << 8) : (a << 8) | b
  }
  const u32 = (at: number): number => {
    if (at + 4 > end) return -1
    const a = bytes[at] ?? 0
    const b = bytes[at + 1] ?? 0
    const c = bytes[at + 2] ?? 0
    const d = bytes[at + 3] ?? 0
    return little
      ? (a | (b << 8) | (c << 16) | (d << 24)) >>> 0
      : ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
  }
  if (u16(tiff + 2) !== 42) return null
  const ifdOffset = u32(tiff + 4)
  if (ifdOffset < 8 || ifdOffset > end - tiff) return null
  const ifd = tiff + ifdOffset
  const count = u16(ifd)
  if (count < 0 || count > 512) return null
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > end) return null
    if (u16(entry) !== 0x0112) continue
    const type = u16(entry + 2)
    if (type !== 3) return null
    const value = u16(entry + 8)
    return value > 0 ? value : null
  }
  return null
}

/** 显示方向下的图像像素尺寸（旋转 90/270 时宽高互换）。 */
export function orientedSize(
  orientation: SketchOrientation,
  width: number,
  height: number,
): { width: number; height: number } {
  return orientation === 6 || orientation === 8
    ? { width: height, height: width }
    : { width, height }
}

/** 统一提示文案：不支持的镜像方向要先转正。 */
export function orientationHint(fileName: string): string {
  return `这张 JPEG 的 EXIF 方向是镜像方向（2/4/5/7），本版不实现镜像显示。请先转正：sips -r 0 "${fileName}" --out "${fileName.replace(/\.[^.]+$/u, '')}-upright.jpg"`
}
