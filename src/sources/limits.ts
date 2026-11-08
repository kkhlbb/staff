/**
 * 来源附件的产品限额（规格 §5.1）。
 *
 * 计量口径：
 * - 单文件：PDF 字节数上限 20 MiB（20 × 1024 × 1024 字节）。
 * - 单文档：任何一个 revision 的页数上限 100 页。
 * - 单项目：该项目保留的全部 revision 的字节数之和上限 100 MiB；
 *   旧版本不删除，所以替换导入会继续占用额度。
 *
 * 这些是初始产品限制，可配置，不代表性能验证已完成。
 */

export const SOURCE_FILE_MAX_BYTES = 20 * 1024 * 1024
export const SOURCE_PAGE_MAX = 100
export const SOURCE_PROJECT_MAX_BYTES = 100 * 1024 * 1024

export interface SourceLimits {
  maxFileBytes: number
  maxPages: number
  maxProjectBytes: number
}

export const DEFAULT_SOURCE_LIMITS: SourceLimits = {
  maxFileBytes: SOURCE_FILE_MAX_BYTES,
  maxPages: SOURCE_PAGE_MAX,
  maxProjectBytes: SOURCE_PROJECT_MAX_BYTES,
}

/** 把字节数格式化为便于提示的 MiB 文本。 */
export function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function exceedsFileLimit(
  byteSize: number,
  limits: SourceLimits = DEFAULT_SOURCE_LIMITS,
): boolean {
  return byteSize > limits.maxFileBytes
}

export function exceedsPageLimit(
  pageCount: number,
  limits: SourceLimits = DEFAULT_SOURCE_LIMITS,
): boolean {
  return pageCount > limits.maxPages
}

/** 加上本次字节数后是否超过项目总额度。 */
export function exceedsProjectLimit(
  usedBytes: number,
  addedBytes: number,
  limits: SourceLimits = DEFAULT_SOURCE_LIMITS,
): boolean {
  return usedBytes + addedBytes > limits.maxProjectBytes
}
