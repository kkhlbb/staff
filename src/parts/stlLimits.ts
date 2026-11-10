/**
 * STL 导入的产品限额（V3-B2，任务卡 §2/§6/§8）。
 *
 * 计量口径（与任务卡 §1.3 一致，不混用 MB 与 MiB）：
 * - 单文件原字节上限 10 MiB = 10 × 1024 × 1024 = 10,485,760 字节；
 * - 三角面上限 200,000（独立执行，不因另一上限先触发而跳过）；
 * - 项目附件唯一 blob 总上限沿用 100 MiB = 104,857,600 字节，
 *   B2 起覆盖 PDF + 模型；不改为十进制 100 MB。
 *
 * 本模块只有常量与字节换算，不 import three、fs 或 Electron；main / renderer /
 * 单测必须共用这一个来源，禁止各抄一份不同上限。
 */

export const STL_MAX_BYTES = 10 * 1024 * 1024
export const STL_MAX_TRIANGLES = 200_000
/** 项目附件唯一 blob 总上限（PDF + 模型）。沿用既有 100 MiB 口径。 */
export const PROJECT_ASSETS_MAX_BYTES = 100 * 1024 * 1024

/** 二进制 STL 固定头部（80 字节头 + 4 字节面数）。 */
export const STL_BINARY_HEADER_BYTES = 84
/** 每个二进制三角面固定 50 字节（12×Float32 + 2 字节属性）。 */
export const STL_BINARY_FACET_BYTES = 50

export interface StlLimits {
  maxBytes: number
  maxTriangles: number
}

export const DEFAULT_STL_LIMITS: StlLimits = {
  maxBytes: STL_MAX_BYTES,
  maxTriangles: STL_MAX_TRIANGLES,
}

/** 唯一 blob 总字节；调用方必须先按 blobKey 或 sha256 去重。 */
export function sumUniqueBlobBytes(
  blobs: readonly { blobKey: string; byteSize: number }[],
): number {
  const seen = new Set<string>()
  let total = 0
  for (const blob of blobs) {
    if (seen.has(blob.blobKey)) continue
    seen.add(blob.blobKey)
    total += blob.byteSize
  }
  return total
}

/** 加上候选新增字节（未复用已有 blob）后是否超过项目附件总额度。 */
export function exceedsProjectAssets(
  usedUniqueBytes: number,
  addedBytes: number,
  maxBytes: number = PROJECT_ASSETS_MAX_BYTES,
): boolean {
  return usedUniqueBytes + addedBytes > maxBytes
}
