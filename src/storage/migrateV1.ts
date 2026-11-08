/**
 * 本地 V1 项目 → v2 的纯迁移函数（V2.1 第三组）。
 *
 * 用户 2026-11-08 批准的本地升级策略：
 * - 保留原始 V1 记录（写入 migrationBackups，不是把旧基线冒充成快照）；
 * - 保留项目、基线、无效草稿与其中全部工程输入；
 * - V1 的 relationConfirmed 布尔没有版本/指纹凭据，无法证明它核对过哪一版
 *   数值，因此升级时一律清除，并要求用户重新确认（界面明确提示）；
 * - 任何校验失败都返回错误，不产生“部分迁移”的项目记录。
 *
 * 这里不访问 IndexedDB：调用方（storage/projects.ts）负责在一个事务里写
 * migrationBackups、projects 与 drafts。
 */
import {
  PROJECT_SCHEMA_VERSION,
  type ChainDefinition,
  type Project,
} from '../domain/types'
import { validateChain } from '../domain/validation'
import type { TermDraft, WorkspaceDraft } from '../workspace/draft'

/** V1 项目 JSON/记录的字段形状；只用于解码，不参与新数据写入。 */
export interface V1DimensionTerm {
  id: string
  symbol: string
  name: string
  nominalQ: number
  lowerDeviationQ: number
  upperDeviationQ: number
  sign: 1 | -1
  sourceNote: string
}

export interface V1ChainDefinition {
  terms: V1DimensionTerm[]
  target: { minQ: number; maxQ: number } | null
  assumptions: string
  relationConfirmed: boolean
}

export interface V1Project {
  schemaVersion: 1
  engineVersion: string
  id: string
  name: string
  createdAt: string
  updatedAt: string
  working: V1ChainDefinition
  baseline: {
    savedAt: string
    definition: V1ChainDefinition
  } | null
}

export interface V1WorkspaceDraft {
  terms: (Omit<TermDraft, 'termRevision'>)[]
  targetMin: string
  targetMax: string
  assumptions: string
  relationConfirmed: boolean
}

export interface V1MigrationOptions {
  migratedAt: string
  backupId: string
}

export interface V1MigrationResult {
  project: Project
  /** V1 记录里确实存在“已确认”，迁移时被清除。 */
  clearedManualConfirmation: boolean
  /** 基线里也存在旧确认（用于界面与测试核对）。 */
  clearedBaselineConfirmation: boolean
}

export type V1MigrationFailure = {
  code: 'invalid_v1_project'
  message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function migrateChain(
  raw: unknown,
  path: string,
): { ok: true; chain: ChainDefinition } | { ok: false; message: string } {
  if (!isRecord(raw)) {
    return { ok: false, message: `${path} 必须是对象` }
  }
  const rawTerms = raw.terms
  if (!Array.isArray(rawTerms)) {
    return { ok: false, message: `${path}.terms 必须是数组` }
  }

  // V1 没有 termRevision：升级时统一初始化为 1，不伪造历史。
  const terms = rawTerms.map((term) =>
    isRecord(term) ? { ...term, termRevision: 1 } : term,
  )

  const validation = validateChain({
    terms,
    target: raw.target ?? null,
    assumptions: raw.assumptions ?? '',
  })
  if (!validation.ok) {
    return {
      ok: false,
      message: `${path} 迁移校验失败：${validation.errors
        .map((error) => error.message)
        .join('；')}`,
    }
  }
  return { ok: true, chain: validation.value }
}

/**
 * 迁移一条 V1 项目记录。失败时返回原因，调用方不得写任何数据。
 */
export function migrateProjectV1(
  raw: unknown,
  options: V1MigrationOptions,
): { ok: true; value: V1MigrationResult } | { ok: false; error: V1MigrationFailure } {
  if (!isRecord(raw) || raw.schemaVersion !== 1) {
    return {
      ok: false,
      error: {
        code: 'invalid_v1_project',
        message: '不是 schemaVersion=1 的项目记录',
      },
    }
  }

  const requiredStrings = ['id', 'name', 'engineVersion', 'createdAt', 'updatedAt'] as const
  for (const field of requiredStrings) {
    if (typeof raw[field] !== 'string' || (raw[field] as string).trim() === '') {
      return {
        ok: false,
        error: {
          code: 'invalid_v1_project',
          message: `V1 项目缺少有效的 ${field}`,
        },
      }
    }
  }

  const working = migrateChain(raw.working, 'working')
  if (!working.ok) {
    return {
      ok: false,
      error: { code: 'invalid_v1_project', message: working.message },
    }
  }

  let baseline: Project['baseline'] = null
  let clearedBaselineConfirmation = false
  if (raw.baseline !== undefined && raw.baseline !== null) {
    if (!isRecord(raw.baseline) || typeof raw.baseline.savedAt !== 'string') {
      return {
        ok: false,
        error: {
          code: 'invalid_v1_project',
          message: 'baseline 必须是 null 或包含 savedAt、definition 的对象',
        },
      }
    }
    const definition = migrateChain(raw.baseline.definition, 'baseline.definition')
    if (!definition.ok) {
      return {
        ok: false,
        error: { code: 'invalid_v1_project', message: definition.message },
      }
    }
    clearedBaselineConfirmation =
      isRecord(raw.baseline.definition) &&
      raw.baseline.definition.relationConfirmed === true
    baseline = {
      savedAt: raw.baseline.savedAt,
      definition: definition.chain,
    }
  }

  const workingConfirmation =
    isRecord(raw.working) && raw.working.relationConfirmed === true

  const project: Project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    engineVersion: raw.engineVersion as string,
    id: raw.id as string,
    name: raw.name as string,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
    working: working.chain,
    // V1 没有任何可验证的确认凭据：修订号从 1 开始，凭据为空。
    relationRevision: 1,
    relationReview: null,
    migration: {
      fromSchemaVersion: 1,
      migratedAt: options.migratedAt,
      backupId: options.backupId,
    },
    baseline,
  }

  return {
    ok: true,
    value: {
      project,
      clearedManualConfirmation: workingConfirmation,
      clearedBaselineConfirmation,
    },
  }
}

/**
 * 迁移同一项目的 V1 草稿。草稿原样保留（包括无效输入），但：
 * - 删除没有凭据的 relationConfirmed；
 * - 所有环补 termRevision=1；
 * - relationRevision 与迁移后的项目一致（1），保证“未确认”。
 *
 * 草稿结构异常（不是对象/terms 不是数组）时返回 null，由调用方决定是否
 * 放弃这条草稿；项目与基线仍完整迁移，不因草稿损坏而阻断。
 */
export function migrateDraftV1(raw: unknown): WorkspaceDraft | null {
  if (!isRecord(raw) || raw.schemaVersion === 2) {
    return null
  }
  const draft = isRecord(raw.draft) ? raw.draft : raw
  if (!Array.isArray(draft.terms)) {
    return null
  }
  const terms: TermDraft[] = draft.terms.map((term) => {
    if (!isRecord(term)) {
      return {
        id: '',
        symbol: '',
        name: '',
        nominal: '',
        lower: '',
        upper: '',
        sign: 1,
        sourceNote: '',
        termRevision: 1,
      }
    }
    return {
      id: String(term.id ?? ''),
      symbol: String(term.symbol ?? ''),
      name: String(term.name ?? ''),
      nominal: String(term.nominal ?? ''),
      lower: String(term.lower ?? ''),
      upper: String(term.upper ?? ''),
      sign: term.sign === -1 ? -1 : 1,
      sourceNote: String(term.sourceNote ?? ''),
      termRevision: 1,
    }
  })
  return {
    terms,
    targetMin: String(draft.targetMin ?? ''),
    targetMax: String(draft.targetMax ?? ''),
    assumptions: String(draft.assumptions ?? ''),
    relationRevision: 1,
  }
}
