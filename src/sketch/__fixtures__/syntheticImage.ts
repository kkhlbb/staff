/**
 * 合成图片夹具（不是手绘照片，也不是任何真实样本）。
 *
 * 只用于通道/坐标用例：PNG 头声明像素尺寸；JPEG 带最小 EXIF Orientation。
 * 这些字节不能当“可看的草图”，证据里也明写“合成夹具”。
 */

/** PNG 签名 + IHDR（声明 width×height）+ 填充；足够让文件头读尺寸。 */
export function syntheticPng(width: number, height: number, padding = 64): Uint8Array {
  const out = new Uint8Array(8 + 8 + 13 + padding)
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(out.buffer)
  view.setUint32(8, 13) // IHDR 长度
  out.set([0x49, 0x48, 0x44, 0x52], 12) // 'IHDR'
  view.setUint32(16, width)
  view.setUint32(20, height)
  out[24] = 8 // bit depth
  out[25] = 6 // RGBA
  return out
}

/** 最小 JPEG：SOI + APP1(Exif, IFD0 一条 Orientation) + EOI。 */
export function syntheticJpeg(width: number, height: number, orientation: number,
  littleEndian = true): Uint8Array {
  const tiff: number[] = [littleEndian ? 0x49 : 0x4d, littleEndian ? 0x49 : 0x4d]
  const push16 = (value: number): void => {
    tiff.push(...(littleEndian ? [value & 0xff, (value >> 8) & 0xff] : [(value >> 8) & 0xff, value & 0xff]))
  }
  const push32 = (value: number): void => {
    const parts = [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]
    tiff.push(...(littleEndian ? parts : parts.reverse()))
  }
  push16(42)
  push32(8)
  push16(1)
  push16(0x0112)
  push16(3)
  push32(1)
  push16(orientation)
  push16(0)
  push32(0)
  const exifLength = tiff.length + 6
  const segmentLength = exifLength + 2
  // SOF0：让 imagePixelSize 能读到宽高。
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (segmentLength >> 8) & 0xff, segmentLength & 0xff,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff, ...sof, 0xff, 0xd9])
}

/** HEIC/HEIF 主品牌（只用于“明确拒绝”用例）。 */
export function syntheticHeic(): Uint8Array {
  return new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0, 0, 0, 0])
}
