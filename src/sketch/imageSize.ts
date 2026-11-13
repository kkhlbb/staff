/**
 * 只读图片文件头里的像素宽高（PNG IHDR / JPEG SOFn），用于校验框选矩形在原图范围内。
 *
 * 不解码像素、不采样、不推断任何毫米值；拿不到就返回 null（宁可拒绝，不猜）。
 */
export interface ImagePixelSize {
  readonly width: number
  readonly height: number
}

export function imagePixelSize(bytes: Uint8Array): ImagePixelSize | null {
  // PNG：8 字节签名 + 长度(4) + 'IHDR'(4) + width(4) + height(4)
  if (bytes.byteLength >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52) {
    const width = readU32Be(bytes, 16)
    const height = readU32Be(bytes, 20)
    return width > 0 && height > 0 ? { width, height } : null
  }
  if (bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 4 <= bytes.byteLength) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      const marker = bytes[offset + 1] ?? 0
      if (marker === 0xff) { offset += 1; continue }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
      if (marker === 0xd9 || marker === 0xda) return null
      const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)
      if (length < 2 || offset + 2 + length > bytes.byteLength) return null
      // SOF0..SOF15，排除 DHT(C4) / JPG(C8) / DAC(CC)。
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (offset + 9 > bytes.byteLength) return null
        const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0)
        const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0)
        return width > 0 && height > 0 ? { width, height } : null
      }
      offset += 2 + length
    }
  }
  return null
}

function readU32Be(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0
}
