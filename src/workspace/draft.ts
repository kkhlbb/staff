import type { ChainDefinition, DimensionTerm, Q } from '../domain/types'
import { formatMm, tryParseMm } from '../domain/units'
import { validateChain } from '../domain/validation'

/**
 * 工作台输入草稿。所有尺寸和偏差保持用户输入的十进制字符串，
 * 只有 draftToChain 校验通过后才转换成领域层的整数 q。
 */
export interface TermDraft {
  id: string
  symbol: string
  name: string
  nominal: string
  lower: string
  upper: string
  sign: 1 | -1
  sourceNote: string
}

export interface WorkspaceDraft {
  terms: TermDraft[]
  /** 空字符串表示未设置目标区间。 */
  targetMin: string
  targetMax: string
  assumptions: string
  relationConfirmed: boolean
}

/** 键为 `${termId}.${field}`、`target.min` 或 `target.max`。 */
export type CellErrors = Record<string, string>

export type DraftToChainResult =
  | { ok: true; chain: ChainDefinition }
  | { ok: false; cellErrors: CellErrors }

export type UpdateFieldAction =
  | {
      type: 'updateField'
      termId: string
      field: 'symbol' | 'name' | 'nominal' | 'lower' | 'upper' | 'sourceNote'
      value: string
    }
  | { type: 'updateField'; termId: string; field: 'sign'; value: 1 | -1 }

export type WorkspaceAction =
  | { type: 'addTerm'; term: TermDraft }
  | { type: 'removeTerm'; termId: string }
  | { type: 'moveTerm'; termId: string; direction: 'up' | 'down' }
  | UpdateFieldAction
  | { type: 'setTarget'; targetMin: string; targetMax: string }
  | { type: 'setAssumptions'; assumptions: string }
  | { type: 'setConfirmed'; confirmed: boolean }

export const emptyDraft: WorkspaceDraft = {
  terms: [],
  targetMin: '',
  targetMax: '',
  assumptions: '',
  relationConfirmed: false,
}

/**
 * 把已校验的领域链还原为输入草稿。
 *
 * 只在没有草稿缓存时用于打开项目（例如导入的旧项目）。所有数值按领域层的
 * formatMm 输出为十进制字符串，不经过浮点缩放；确认状态原样保留。
 */
export function chainToDraft(chain: ChainDefinition): WorkspaceDraft {
  return {
    terms: chain.terms.map((term) => ({
      id: term.id,
      symbol: term.symbol,
      name: term.name,
      nominal: formatMm(term.nominalQ),
      lower: formatMm(term.lowerDeviationQ),
      upper: formatMm(term.upperDeviationQ),
      sign: term.sign,
      sourceNote: term.sourceNote,
    })),
    targetMin: chain.target === null ? '' : formatMm(chain.target.minQ),
    targetMax: chain.target === null ? '' : formatMm(chain.target.maxQ),
    assumptions: chain.assumptions,
    relationConfirmed: chain.relationConfirmed,
  }
}

const TERM_PATH_FIELDS: Record<string, string> = {
  id: 'id',
  symbol: 'symbol',
  name: 'name',
  nominalQ: 'nominal',
  lowerDeviationQ: 'lower',
  upperDeviationQ: 'upper',
  sign: 'sign',
  sourceNote: 'sourceNote',
}

function cellKey(termId: string, field: string): string {
  return `${termId}.${field}`
}

function parseNumericField(
  value: string,
  key: string,
  cellErrors: CellErrors,
): Q | undefined {
  const parsed = tryParseMm(value)
  if (!parsed.ok) {
    cellErrors[key] = parsed.message
    return undefined
  }
  return parsed.value
}

function mapValidationPath(
  path: (string | number)[],
  terms: TermDraft[],
): string | null {
  if (path[0] !== 'terms' || typeof path[1] !== 'number') {
    if (path[0] === 'target' && path[1] === 'minQ') {
      return 'target.min'
    }
    if (path[0] === 'target' && path[1] === 'maxQ') {
      return 'target.max'
    }
    return null
  }

  const term = terms[path[1]]
  const field = path[2]
  if (term === undefined || typeof field !== 'string') {
    return null
  }

  const draftField = TERM_PATH_FIELDS[field]
  return draftField === undefined ? null : cellKey(term.id, draftField)
}

/**
 * 将字符串草稿转换为领域尺寸链。
 *
 * 数值字段先逐个用 tryParseMm 精确转换，再把转换结果交给 validateChain。
 * 两层错误按单元格合并；同一单元格优先保留更具体的 tryParseMm 提示。
 * 组成环数量等没有对应单元格的错误不会生成 cellErrors 键，但函数仍返回失败。
 */
export function draftToChain(draft: WorkspaceDraft): DraftToChainResult {
  const cellErrors: CellErrors = {}
  const terms: DimensionTerm[] = draft.terms.map((term) => ({
    id: term.id,
    symbol: term.symbol,
    name: term.name,
    nominalQ:
      parseNumericField(term.nominal, cellKey(term.id, 'nominal'), cellErrors) ??
      Number.NaN,
    lowerDeviationQ:
      parseNumericField(term.lower, cellKey(term.id, 'lower'), cellErrors) ?? Number.NaN,
    upperDeviationQ:
      parseNumericField(term.upper, cellKey(term.id, 'upper'), cellErrors) ?? Number.NaN,
    sign: term.sign,
    sourceNote: term.sourceNote,
  }))

  let target: ChainDefinition['target'] = null
  if (!(draft.targetMin.trim() === '' && draft.targetMax.trim() === '')) {
    const minQ = parseNumericField(draft.targetMin, 'target.min', cellErrors)
    const maxQ = parseNumericField(draft.targetMax, 'target.max', cellErrors)
    target = { minQ: minQ ?? Number.NaN, maxQ: maxQ ?? Number.NaN }
  }

  const validation = validateChain({
    terms,
    target,
    assumptions: draft.assumptions,
    relationConfirmed: draft.relationConfirmed,
  })

  if (!validation.ok) {
    for (const error of validation.errors) {
      const key = mapValidationPath(error.path, draft.terms)
      if (key !== null && cellErrors[key] === undefined) {
        cellErrors[key] = error.message
      }
    }
    return { ok: false, cellErrors }
  }

  if (Object.keys(cellErrors).length > 0) {
    return { ok: false, cellErrors }
  }

  return { ok: true, chain: validation.value }
}

function isConfirmationClearingField(
  field: UpdateFieldAction['field'],
): boolean {
  return (
    field === 'symbol' ||
    field === 'sign' ||
    field === 'nominal' ||
    field === 'lower' ||
    field === 'upper'
  )
}

function replaceTerm(
  draft: WorkspaceDraft,
  termIndex: number,
  term: TermDraft,
): WorkspaceDraft {
  const terms = draft.terms.slice()
  terms[termIndex] = term
  return { ...draft, terms }
}

export function workspaceReducer(
  draft: WorkspaceDraft,
  action: WorkspaceAction,
): WorkspaceDraft {
  switch (action.type) {
    case 'addTerm':
      return {
        ...draft,
        terms: [...draft.terms, { ...action.term }],
        relationConfirmed: false,
      }

    case 'removeTerm': {
      const terms = draft.terms.filter((term) => term.id !== action.termId)
      if (terms.length === draft.terms.length) {
        return draft
      }
      return { ...draft, terms, relationConfirmed: false }
    }

    case 'moveTerm': {
      const index = draft.terms.findIndex((term) => term.id === action.termId)
      if (index === -1) {
        return draft
      }
      const targetIndex = action.direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= draft.terms.length) {
        return draft
      }
      const terms = draft.terms.slice()
      const [moved] = terms.splice(index, 1)
      terms.splice(targetIndex, 0, moved)
      return { ...draft, terms }
    }

    case 'updateField': {
      const index = draft.terms.findIndex((term) => term.id === action.termId)
      if (index === -1) {
        return draft
      }
      const term = draft.terms[index]

      if (action.field === 'sign') {
        if (term.sign === action.value) {
          return draft
        }
        return {
          ...replaceTerm(draft, index, { ...term, sign: action.value }),
          relationConfirmed: false,
        }
      }

      if (term[action.field] === action.value) {
        return draft
      }
      const next = replaceTerm(draft, index, {
        ...term,
        [action.field]: action.value,
      })
      return isConfirmationClearingField(action.field)
        ? { ...next, relationConfirmed: false }
        : next
    }

    case 'setTarget':
      if (
        draft.targetMin === action.targetMin &&
        draft.targetMax === action.targetMax
      ) {
        return draft
      }
      return {
        ...draft,
        targetMin: action.targetMin,
        targetMax: action.targetMax,
      }

    case 'setAssumptions':
      if (draft.assumptions === action.assumptions) {
        return draft
      }
      return { ...draft, assumptions: action.assumptions }

    case 'setConfirmed':
      if (draft.relationConfirmed === action.confirmed) {
        return draft
      }
      return { ...draft, relationConfirmed: action.confirmed }
  }
}
