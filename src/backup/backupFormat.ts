/**
 * V2 完整备份的格式常量与路径编码（纯模块，A-03 从 projectBundle.ts 抽出）。
 *
 * 抽取原因：V3 迁移的纯解析管道需要这些常量，但不应通过 projectBundle.ts
 * 间接把 storage/db（IndexedDB 模块）拉进主进程迁移图。projectBundle.ts 继续
 * 原样导出这些名字，既有调用方无需改动。
 */
export const BACKUP_FORMAT = 'cunlian-backup'
export const BACKUP_FORMAT_VERSION = 1
export const BACKUP_FILE_SUFFIX = '.cunlian.zip'
export const MANIFEST_PATH = 'manifest.json'

export const MAPPING_TEMPLATES_EXCLUDED_NOTE =
  '本备份不包含全局映射模板（mappingTemplates）。映射模板属于本机全局设置，不随项目备份；恢复到新浏览器后需要重新建立或重新导入模板。'

export const BACKUP_PATH_PREFIX = {
  projects: 'projects/',
  drafts: 'drafts/',
  documents: 'sourceDocuments/',
  revisions: 'sourceRevisions/',
  blobs: 'sourceBlobs/',
  files: 'sourceFiles/',
  bindings: 'bindings/',
  events: 'events/',
  snapshots: 'snapshots/',
  importSnapshots: 'importSnapshots/',
  migrationBackups: 'migrationBackups/',
} as const

function encodeId(value: string): string {
  return encodeURIComponent(value)
}

export function backupPath(
  kind: keyof typeof BACKUP_PATH_PREFIX,
  id: string,
  extension = 'json',
): string {
  return `${BACKUP_PATH_PREFIX[kind]}${encodeId(id)}.${extension}`
}
