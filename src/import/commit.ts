import { calculateChain } from '../domain/calculate'
import type { ChainDefinition, ChainResult, Project } from '../domain/types'
import {
  createProject,
  saveDraft as persistDraft,
  type ImportSnapshot,
  type SaveDraftResult,
  type StorageError,
  type StorageResult,
} from '../storage/projects'
import {
  draftToChain,
  type TermDraft,
  type WorkspaceDraft,
} from '../workspace/draft'
import {
  importCellKey,
  termToDraftValues,
  type ImportCellErrors,
  type ImportTerm,
} from './validateImport'
import type { ImportField } from './mapColumns'
import { MAX_IMPORT_TERMS } from './parseTable'

export type ImportCommitMode = 'new' | 'append' | 'replace'

export interface ImportCommitPlanInput {
  mode: ImportCommitMode
  /** append / replace 时必填。 */
  baseDraft: WorkspaceDraft | null
  terms: ImportTerm[]
}

export interface ImportCommitPlan {
  mode: ImportCommitMode
  draft: WorkspaceDraft
  chain: ChainDefinition
  result: ChainResult
  addedCount: number
}

export type ImportCommitPlanResult =
  | { ok: true; plan: ImportCommitPlan }
  | { ok: false; message: string; cellErrors: ImportCellErrors }

export interface CommitImportInput extends ImportCommitPlanInput {
  projectId?: string
  projectName?: string
}

export interface CommitImportSuccess {
  project: Project
  draft: WorkspaceDraft
  chain: ChainDefinition
  result: ChainResult
  /** 替换模式下与本次写入同事务保存的“操作前快照”。 */
  importSnapshot?: ImportSnapshot | null
}

export type CommitImportResult =
  | { ok: true; value: CommitImportSuccess }
  | { ok: false; error: StorageError; cellErrors: ImportCellErrors }

export interface CommitImportDependencies {
  createProject: typeof createProject
  saveDraft: typeof persistDraft
}

function failureMessage(error: StorageError): string {
  return error.details.length > 0
    ? `${error.message}：${error.details.map((detail) => detail.message).join('；')}`
    : error.message
}

function emptyDraftFromTerms(terms: TermDraft[]): WorkspaceDraft {
  return {
    terms,
    targetMin: '',
    targetMax: '',
    assumptions: '',
    // 新建 / 替换 / 追加都必须重新建立人工确认。
    relationConfirmed: false,
  }
}

function importDraftTerm(
  term: ImportTerm,
  index: number,
  usedIds: Set<string>,
): TermDraft {
  const base = `import-${term.rowNumber}-${index + 1}`
  let id = base
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  usedIds.add(id)
  return { id, ...termToDraftValues(term) }
}

function translateCellErrors(
  cellErrors: ImportCellErrors,
  rowNumberById: Map<string, number>,
): ImportCellErrors {
  const translated: ImportCellErrors = {}
  for (const [key, message] of Object.entries(cellErrors)) {
    const dot = key.indexOf('.')
    if (dot === -1) {
      continue
    }
    const id = key.slice(0, dot)
    const field = key.slice(dot + 1)
    const rowNumber = rowNumberById.get(id)
    if (rowNumber === undefined) {
      continue
    }
    translated[importCellKey(rowNumber, field as ImportField)] = message
  }
  return translated
}

export function planImportCommit(
  input: ImportCommitPlanInput,
): ImportCommitPlanResult {
  const cellErrors: ImportCellErrors = {}
  const baseDraft = input.mode === 'new' ? null : input.baseDraft

  if (input.mode !== 'new' && baseDraft === null) {
    return { ok: false, message: '追加或替换必须从已有项目发起', cellErrors }
  }
  if (input.terms.length === 0) {
    return { ok: false, message: '没有可提交的组成环', cellErrors }
  }

  const existingTerms = baseDraft?.terms ?? []
  const existingIds = new Set(existingTerms.map((term) => term.id))
  const rowNumberById = new Map<string, number>()
  const importedTerms = input.terms.map((term, index) => {
    const draft = importDraftTerm(term, index, existingIds)
    const id = draft.id
    rowNumberById.set(id, term.rowNumber)
    if (input.mode === 'append') {
      const conflict = existingTerms.find(
        (existing) => existing.symbol.trim() === term.symbol.trim(),
      )
      if (conflict !== undefined) {
        cellErrors[importCellKey(term.rowNumber, 'symbol')] =
          `代号「${term.symbol}」与现有组成环「${conflict.symbol.trim()}」重复`
      }
    }
    return draft
  })

  // 预览已检查一次重复；这里再按提交实际使用的 term 顺序检查，
  // 防止调用方绕过预览直接提交。
  const importedSymbols = new Map<string, number>()
  for (const term of input.terms) {
    const symbol = term.symbol.trim()
    const first = importedSymbols.get(symbol)
    if (first === undefined) {
      importedSymbols.set(symbol, term.rowNumber)
    } else {
      cellErrors[importCellKey(term.rowNumber, 'symbol')] =
        `代号「${symbol}」与第 ${first} 行重复`
    }
  }

  let draft: WorkspaceDraft
  if (input.mode === 'new') {
    draft = emptyDraftFromTerms(importedTerms)
  } else if (baseDraft !== null) {
    draft =
      input.mode === 'append'
        ? {
            ...baseDraft,
            terms: [...baseDraft.terms, ...importedTerms],
            relationConfirmed: false,
          }
        : {
            ...baseDraft,
            terms: importedTerms,
            relationConfirmed: false,
          }
  } else {
    return { ok: false, message: '追加或替换必须从已有项目发起', cellErrors }
  }

  if (draft.terms.length > MAX_IMPORT_TERMS) {
    return {
      ok: false,
      message:
        input.mode === 'append'
          ? `追加后组成环为 ${draft.terms.length} 项，超过上限 ${MAX_IMPORT_TERMS} 项。原项目未改变。`
          : `替换后组成环为 ${draft.terms.length} 项，超过上限 ${MAX_IMPORT_TERMS} 项。`,
      cellErrors,
    }
  }

  if (Object.keys(cellErrors).length > 0) {
    return {
      ok: false,
      message: '代号与已有组成环冲突，不能提交。原项目未改变。',
      cellErrors,
    }
  }

  const conversion = draftToChain(draft)
  if (!conversion.ok) {
    return {
      ok: false,
      message: '提交后的尺寸链未通过领域校验，不能提交。',
      cellErrors: {
        ...translateCellErrors(conversion.cellErrors, rowNumberById),
        ...cellErrors,
      },
    }
  }

  let result: ChainResult
  try {
    result = calculateChain(conversion.chain)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      message: `提交后重新计算失败：${message}`,
      cellErrors,
    }
  }

  return {
    ok: true,
    plan: {
      mode: input.mode,
      draft,
      chain: conversion.chain,
      result,
      addedCount: importedTerms.length,
    },
  }
}

/**
 * 导入提交入口。
 *
 * 新建走 createProject（单事务 add）；追加 / 替换走现有 saveDraft（同一事务写
 * projects.working 与 drafts），因此写入失败时项目与草稿都保持原状。
 * 两条路径都只写入 draftToChain / validateChain / calculateChain 的结果。
 */
export async function commitImport(
  input: CommitImportInput,
  dependencies: CommitImportDependencies = {
    createProject,
    saveDraft: persistDraft,
  },
): Promise<CommitImportResult> {
  const planned = planImportCommit(input)
  if (!planned.ok) {
    return {
      ok: false,
      error: {
        code: 'invalid_import',
        message: planned.message,
        details: [
          ...Object.entries(planned.cellErrors).map(([key, message]) => ({
            path: [key],
            code: 'import_conflict',
            message,
          })),
        ],
      },
      cellErrors: planned.cellErrors,
    }
  }

  if (input.mode === 'new') {
    const created = await dependencies.createProject({
      name: input.projectName?.trim() || undefined,
      working: planned.plan.chain,
    })
    if (!created.ok) {
      return { ok: false, error: created.error, cellErrors: {} }
    }
    return {
      ok: true,
      value: {
        project: created.value,
        draft: planned.plan.draft,
        chain: planned.plan.chain,
        result: planned.plan.result,
      },
    }
  }

  if (input.projectId === undefined) {
    return {
      ok: false,
      error: {
        code: 'invalid_project',
        message: '追加或替换必须指定项目',
        details: [],
      },
      cellErrors: {},
    }
  }

  let saved: StorageResult<SaveDraftResult>
  try {
    // 替换全部组成环时，storage 会在同一事务内先备份当前 working 再覆盖；
    // 快照不是项目基线，不会覆盖已有 baseline。
    saved = await dependencies.saveDraft(
      input.projectId,
      planned.plan.draft,
      input.mode === 'replace' ? { snapshotBefore: 'replace' } : {},
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: {
        code: 'storage_failure',
        message: `写入失败，原项目未改变：${detail}`,
        details: [],
      },
      cellErrors: {},
    }
  }

  if (!saved.ok) {
    return {
      ok: false,
      error: {
        ...saved.error,
        message: `写入失败，原项目未改变：${failureMessage(saved.error)}`,
      },
      cellErrors: {},
    }
  }

  return {
    ok: true,
    value: {
      project: saved.value.project,
      draft: planned.plan.draft,
      chain: planned.plan.chain,
      result: planned.plan.result,
      importSnapshot: saved.value.importSnapshot,
    },
  }
}
