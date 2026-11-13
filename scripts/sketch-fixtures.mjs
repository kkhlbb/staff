#!/usr/bin/env node
/**
 * 合成夹具生成：现有图纸 PDF → PNG → JPEG → 注入 EXIF Orientation（1/3/6/8）。
 *
 * 这不是手绘照片，也不是任何真实用户样本；文件名一律带 synthetic。
 * 只改文件头的 APP1 段（Orientation 标签），不旋转像素——模拟手机拍照的
 * “原始像素 + 方向标记”，正是框选坐标换算要处理的输入。
 *
 * 运行：node scripts/sketch-fixtures.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const out = path.join(root, 'docs/evidence/sketch-input/fixtures')
const pdf = path.join(root, 'docs/evidence/V3-C/spacer-a4-1to1.pdf')
const base = path.join(out, 'sketch-synthetic-base.png')
const baseJpeg = path.join(out, 'sketch-synthetic-base.jpg')

await fs.mkdir(out, { recursive: true })
if (!(await fs.stat(pdf).catch(() => null))) throw new Error(`缺少图纸 PDF：${pdf}`)
execFileSync('sips', ['-s', 'format', 'png', '-Z', '2400', pdf, '--out', base], { stdio: 'inherit' })
execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', base, '--out', baseJpeg], { stdio: 'inherit' })

const source = await fs.readFile(baseJpeg)
/** 在 SOI 之后插入 APP1(Exif) 段：一条 IFD0 Orientation。 */
function withOrientation(bytes, orientation) {
  const tiff = []
  const u16 = (value) => tiff.push(value & 0xff, (value >> 8) & 0xff)
  const u32 = (value) => tiff.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff)
  u16(0x4949); u16(42); u32(8)
  u16(1)
  u16(0x0112); u16(3); u32(1); u16(orientation); u16(0)
  u32(0)
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]
  const length = payload.length + 2
  return Buffer.concat([
    Buffer.from(bytes.subarray(0, 2)),
    Buffer.from([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload]),
    Buffer.from(bytes.subarray(2)),
  ])
}

const results = []
for (const orientation of [1, 3, 6, 8]) {
  const file = path.join(out, `sketch-synthetic-o${orientation}.jpg`)
  const bytes = withOrientation(source, orientation)
  await fs.writeFile(file, bytes)
  results.push({
    file: path.relative(root, file),
    orientation,
    byteSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
}
const pngBytes = await fs.readFile(base)
console.log(JSON.stringify({
  note: '合成夹具，非真实手绘照片：现有产品导出图纸 PDF 经 sips 转 PNG，再转 JPEG 并注入 EXIF 方向。',
  base: { file: path.relative(root, base), width: 2400, height: 1696,
    sha256: createHash('sha256').update(pngBytes).digest('hex') },
  oriented: results,
}, null, 2))
