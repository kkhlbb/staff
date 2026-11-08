/**
 * 报告打印页脚使用的快照短 ID。
 *
 * 只保留字母数字并截断，避免把备份里的任意字符串直接拼进 CSS content；
 * 完整 ID 仍然显示在报告页眉与页脚正文中。
 */
export function snapshotShortId(id: string): string {
  const withoutPrefix = id.startsWith('snapshot-')
    ? id.slice('snapshot-'.length)
    : id
  const safe = withoutPrefix.replace(/[^0-9A-Za-z]/g, '')
  return safe.slice(0, 8) === '' ? 'unknown' : safe.slice(0, 8)
}
