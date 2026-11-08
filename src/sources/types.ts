/**
 * V2.1 本地 PDF 来源的领域类型（规格 §7）。
 *
 * 与规格示意类型的差异只有一处：SourceDocument / SourceRevision 额外保存
 * projectId。数据库里多个项目共用同一批 store，项目总量限额与“只列出本项目
 * 文档”都需要它；没有 projectId 就只能靠全表扫描推断归属。
 */

export interface SourceDocument {
  id: string
  projectId: string
  /** 用户可见标题；默认取首次导入的文件名。文件名本身不承担唯一标识。 */
  title: string
  /** 指向 sourceRevisions.id；同一文档可保留多个不可变 revision。 */
  latestRevisionId: string
}

/** 每次导入生成一条不可变记录；替换只新增 revision，不修改旧记录。 */
export interface SourceRevision {
  id: string
  projectId: string
  documentId: string
  fileName: string
  /** 小写十六进制 SHA-256，用于文件标识与一致性检查，不代表真实性或批准。 */
  sha256: string
  byteSize: number
  pageCount: number
  createdAt: string
  /** sourceBlobs 的键；与 revision 一一对应，不复用旧 Blob。 */
  blobKey: string
}

export interface SourceBlobRecord {
  blobKey: string
  projectId: string
  sha256: string
  byteSize: number
  blob: Blob
}

export interface SourceImportValue {
  document: SourceDocument
  revision: SourceRevision
  /** 导入前对浏览器可用空间的估算；不支持时为 supported=false。 */
  storageCapacity: StorageCapacity
}

export interface StorageCapacity {
  supported: boolean
  usageBytes: number | null
  quotaBytes: number | null
  availableBytes: number | null
  /** 面向用户的说明，不承诺空间一定足够。 */
  note: string
}
