import { describe, expect, it } from 'vitest'
import {
  checkSketchImage,
  heicConversionHint,
  SKETCH_IMAGE_MAX_BYTES,
  SKETCH_NO_MEASURE_NOTICE,
  sniffImageFormat,
} from '../imageFormat'
import { readJpegOrientation, orientedSize, orientationHint } from '../orientation'
import {
  displayedToSource,
  displayedToView,
  selectionToSourceRect,
  sourceRectToViewRect,
  sourceToDisplayed,
  sketchRegionLabel,
  viewToDisplayed,
  UNSELECTED_PLACEHOLDER,
} from '../selection'

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

function png(): Uint8Array {
  return bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13)
}

function jpeg(): Uint8Array {
  return bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9)
}

function heic(): Uint8Array {
  return bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0)
}

/** 最小 JPEG：SOI + APP1(Exif, IFD0 一条 Orientation) + EOI。 */
function jpegWithOrientation(raw: number, littleEndian = true): Uint8Array {
  const tiff: number[] = []
  tiff.push(littleEndian ? 0x49 : 0x4d, littleEndian ? 0x49 : 0x4d)
  const push16 = (value: number): void => {
    tiff.push(...(littleEndian ? [value & 0xff, (value >> 8) & 0xff] : [(value >> 8) & 0xff, value & 0xff]))
  }
  const push32 = (value: number): void => {
    const parts = [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]
    tiff.push(...(littleEndian ? parts : parts.reverse()))
  }
  push16(42)
  push32(8) // IFD0 偏移
  push16(1) // 一个条目
  push16(0x0112)
  push16(3) // SHORT
  push32(1)
  push16(raw)
  push16(0)
  push32(0) // 下一个 IFD
  const exifLength = tiff.length + 6
  const segmentLength = exifLength + 2
  const out = [0xff, 0xd8, 0xff, 0xe1, (segmentLength >> 8) & 0xff, segmentLength & 0xff,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff, 0xff, 0xd9]
  return new Uint8Array(out)
}

describe('图片格式与限额（不做识别）', () => {
  it('按文件头认 PNG / JPEG，HEIC 与未知格式分开', () => {
    expect(sniffImageFormat(png())).toBe('png')
    expect(sniffImageFormat(jpeg())).toBe('jpeg')
    expect(sniffImageFormat(heic())).toBe('heic')
    expect(sniffImageFormat(bytes(1, 2, 3, 4))).toBe('unknown')
  })

  it('21 MiB 图片被拒绝并说明上限', () => {
    const oversized = new Uint8Array(SKETCH_IMAGE_MAX_BYTES + 1)
    oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    const result = checkSketchImage(oversized, 'huge.png')
    expect(result?.code).toBe('TOO_LARGE')
    expect(result?.message).toContain('20.0 MiB')
    // 恰好 20 MiB 不拒绝（边界含等号）。
    const exact = new Uint8Array(SKETCH_IMAGE_MAX_BYTES)
    exact.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    expect(checkSketchImage(exact, 'exact.png')).toBeNull()
  })

  it('HEIC 明确拒绝并给出可执行的转换命令', () => {
    const result = checkSketchImage(heic(), 'IMG_0001.HEIC')
    expect(result?.code).toBe('UNSUPPORTED_FORMAT')
    expect(result?.message).toContain('sips -s format jpeg')
    expect(result?.message).toContain('IMG_0001.HEIC')
    expect(heicConversionHint('x.heic')).toContain('x.jpg')
  })

  it('空文件与伪扩展名（扩展名是 .png 但字节不是）都拒绝', () => {
    expect(checkSketchImage(new Uint8Array(), 'empty.png')?.code).toBe('EMPTY_FILE')
    const fake = new TextEncoder().encode('not really a png')
    expect(checkSketchImage(fake, 'fake.png')?.code).toBe('UNSUPPORTED_FORMAT')
  })

  it('界面固定声明：图上不测量', () => {
    expect(SKETCH_NO_MEASURE_NOTICE).toContain('图上不测量')
    expect(SKETCH_NO_MEASURE_NOTICE).toContain('尺寸由你输入')
  })
})

describe('EXIF 方向读取', () => {
  it.each([1, 3, 6, 8])('小端 EXIF orientation=%i 读出支持方向', (raw) => {
    const state = readJpegOrientation(jpegWithOrientation(raw, true))
    expect(state).toEqual({ kind: 'supported', value: raw })
  })

  it('大端 EXIF 同样读出', () => {
    expect(readJpegOrientation(jpegWithOrientation(6, false))).toEqual({ kind: 'supported', value: 6 })
  })

  it('镜像方向明确报不支持，不猜成最近似方向', () => {
    expect(readJpegOrientation(jpegWithOrientation(2, true))).toEqual({ kind: 'mirrored', raw: 2 })
    expect(orientationHint('a.jpg')).toContain('镜像方向')
  })

  it('无 EXIF 的 JPEG 与 PNG 按 1（没有方向信息 = 不旋转），非法值才报 unreadable', () => {
    expect(readJpegOrientation(jpeg())).toEqual({ kind: 'supported', value: 1 })
    expect(readJpegOrientation(png())).toEqual({ kind: 'supported', value: 1 })
    expect(readJpegOrientation(jpegWithOrientation(9, true))).toEqual({ kind: 'unreadable', raw: 9 })
  })

  it('旋转 90/270 时显示尺寸互换', () => {
    expect(orientedSize(1, 1200, 800)).toEqual({ width: 1200, height: 800 })
    expect(orientedSize(3, 1200, 800)).toEqual({ width: 1200, height: 800 })
    expect(orientedSize(6, 1200, 800)).toEqual({ width: 800, height: 1200 })
    expect(orientedSize(8, 1200, 800)).toEqual({ width: 800, height: 1200 })
  })
})

describe('框选坐标：显示 → 原图（四向）', () => {
  const width = 1200
  const height = 800

  it.each([1, 3, 6, 8] as const)('orientation=%i：显示→原图→显示 往返一致', (orientation) => {
    const view = { zoom: 0.75, panX: -37, panY: 21 }
    const sample = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: width - 1, y: 0 },
      { x: 0, y: height - 1 },
      { x: width - 1, y: height - 1 },
      { x: 123.5, y: 456.25 },
    ]
    for (const point of sample) {
      const displayed = sourceToDisplayed(orientation, width, height, point)
      const viewPoint = displayedToView(view, displayed)
      const back = displayedToSource(orientation, width, height, viewToDisplayed(view, viewPoint))
      expect(back.x).toBeCloseTo(point.x, 9)
      expect(back.y).toBeCloseTo(point.y, 9)
    }
  })

  it.each([
    { orientation: 1 as const, start: { x: 100, y: 60 }, end: { x: 340, y: 200 }, expected: { x: 100, y: 60, width: 240, height: 140 } },
    { orientation: 3 as const, start: { x: 100, y: 60 }, end: { x: 340, y: 200 }, expected: { x: 860, y: 600, width: 240, height: 140 } },
    { orientation: 6 as const, start: { x: 100, y: 60 }, end: { x: 340, y: 200 }, expected: { x: 60, y: 460, width: 140, height: 240 } },
    { orientation: 8 as const, start: { x: 100, y: 60 }, end: { x: 340, y: 200 }, expected: { x: 1000, y: 100, width: 140, height: 240 } },
  ])('orientation=$orientation 的屏幕框换算成原图 rect', ({ orientation, start, end, expected }) => {
    const rect = selectionToSourceRect({ orientation, sourceWidth: width, sourceHeight: height,
      view: { zoom: 1, panX: 0, panY: 0 }, start, end })
    expect(rect).toEqual(expected)
  })

  it('缩放与平移同时生效时，屏幕框仍换算到同一原图位置（反向拖动也成立）', () => {
    const view = { zoom: 1.6, panX: -220, panY: -90 }
    const start = { x: 480, y: 300 }
    const end = { x: 720, y: 420 }
    const rect = selectionToSourceRect({ orientation: 6, sourceWidth: width, sourceHeight: height, view, start, end })
    expect(rect).not.toBeNull()
    // 逆算回显：把 rect 画回屏幕，应与拖出的两点包围盒重合（整数像素误差 < 2 CSS px）。
    const drawn = sourceRectToViewRect({ orientation: 6, sourceWidth: width, sourceHeight: height, view, rect: rect! })
    expect(Math.abs(drawn.left - 480)).toBeLessThanOrEqual(2)
    expect(Math.abs(drawn.top - 300)).toBeLessThanOrEqual(2)
    expect(Math.abs(drawn.left + drawn.width - 720)).toBeLessThanOrEqual(2)
    expect(Math.abs(drawn.top + drawn.height - 420)).toBeLessThanOrEqual(2)
  })

  it('反向拖动（从右下拖到左上）取包围盒，不产生负宽', () => {
    const rect = selectionToSourceRect({ orientation: 1, sourceWidth: width, sourceHeight: height,
      view: { zoom: 1, panX: 0, panY: 0 }, start: { x: 340, y: 200 }, end: { x: 100, y: 60 } })
    expect(rect).toEqual({ x: 100, y: 60, width: 240, height: 140 })
  })

  it('拖出图外被夹紧；一个点（无可测区域）返回 null', () => {
    const rect = selectionToSourceRect({ orientation: 1, sourceWidth: width, sourceHeight: height,
      view: { zoom: 1, panX: 0, panY: 0 }, start: { x: -100, y: -50 }, end: { x: 5000, y: 5000 } })
    expect(rect).toEqual({ x: 0, y: 0, width, height })
    expect(selectionToSourceRect({ orientation: 1, sourceWidth: width, sourceHeight: height,
      view: { zoom: 1, panX: 0, panY: 0 }, start: { x: 10, y: 10 }, end: { x: 10, y: 10 } })).toBeNull()
  })

  it('未框选固定说明与第 N 个框选标记', () => {
    expect(sketchRegionLabel(2)).toBe('来源：图片，第 2 个框选')
    expect(sketchRegionLabel(null)).toContain(UNSELECTED_PLACEHOLDER)
  })
})
