/** 经校验的安全整数，单位 0.0001 mm（1 q = 0.0001 mm）。 */
export type Q = number

export const Q_PER_MM = 10000
export const MAX_ABS_MM = 1_000_000
/** 10^10，远小于 Number.MAX_SAFE_INTEGER（2^53 - 1），所以 Q 用 number 即可，不需要 BigInt。 */
export const MAX_ABS_Q = MAX_ABS_MM * Q_PER_MM

/** 项目 JSON 与项目记录的结构版本。数据库版本（storage/db.ts）与它是两回事。 */
export const PROJECT_SCHEMA_VERSION = 2

export interface DimensionTerm {
  provenance?: readonly import('../document-extraction/types').EvidenceRef[]
  id: string
  symbol: string
  name: string
  nominalQ: Q
  lowerDeviationQ: Q
  upperDeviationQ: Q
  sign: 1 | -1
  sourceNote: string
  /**
   * 单调递增的环修订号（正整数，建议从 1 开始）。
   *
   * 只有数值（基本尺寸/上下偏差）或作用方向变化时递增；改代号、名称、备注
   * 或行顺序都不改变它。来源核对凭据记录核对时的 termRevision，二者不一致
   * 即表示该环的数值来源核对已失效；即使改回原值，修订号也不会回退。
   */
  termRevision: number
}

export interface ChainDefinition {
  terms: DimensionTerm[]
  target: { minQ: Q; maxQ: Q } | null
  assumptions: string
}

/**
 * 关系确认凭据（唯一真相）。
 *
 * 不再持久化“已确认”布尔：是否已确认由 relation.ts 的派生选择器根据
 * relationRevision、指纹和当前环数据实时判定。任何影响关系的操作递增
 * relationRevision，因此改回原值不会恢复旧确认。
 */
export interface RelationReview {
  /** 确认时的工作台关系修订号。 */
  relationRevision: number
  /** 环身份、代号、数值、方向的稳定指纹（非密码学哈希，只用于一致性判定）。 */
  fingerprint: string
  /** ISO 8601 时间戳。 */
  confirmedAt: string
}

/** 本地 V1 项目首次升级留下的记录；指向 migrationBackups 中的原始 V1 记录。 */
export interface ProjectMigration {
  fromSchemaVersion: number
  migratedAt: string
  /** migrationBackups store 中的备份 ID。 */
  backupId: string
}

export interface Project {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  engineVersion: string
  id: string
  name: string
  createdAt: string // ISO 8601
  updatedAt: string
  working: ChainDefinition
  /** 当前工作方案的关系修订号；影响关系的操作递增，改回原值也不回退。 */
  relationRevision: number
  /** 当前工作方案的关系确认凭据；null 表示从未确认或已取消。 */
  relationReview: RelationReview | null
  /** 仅本机 V1 升级产生的项目非 null；外部导入的 v2 项目为 null。 */
  migration: ProjectMigration | null
  baseline: {
    savedAt: string
    definition: ChainDefinition
  } | null
}

export interface ChainResult {
  nominalQ: Q
  minQ: Q
  maxQ: Q
  lowerDeviationQ: Q
  upperDeviationQ: Q
  toleranceQ: Q
  status: 'within' | 'outside' | 'no-target'
  lowerMarginQ: Q | null
  upperMarginQ: Q | null
  contributions: { termId: string; toleranceQ: Q }[]
}
