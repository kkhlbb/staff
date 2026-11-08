import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChainDefinition, Project, RelationReview } from '../domain/types'
import { validateChain } from '../domain/validation'
import {
  createEmptyProject,
  exportProjectJson,
  getDraft,
  getProject,
  listProjects,
  loadProjectSources,
  saveDraft as persistDraft,
  updateProject,
  type ParsedProjectSources,
  type SaveDraftResult,
  type StorageError,
  type StorageResult,
} from '../storage/projects'
import {
  chainToDraft,
  type WorkspaceDraft,
} from './draft'
import { createRelationReview, type RelationState } from './relation'
import { useWorkspace, type UseWorkspaceResult } from './useWorkspace'

/** 文档第 7 节要求自动保存防抖约 500 ms。 */
export const AUTO_SAVE_DEBOUNCE_MS = 500

export type SaveStatus = 'saving' | 'saved' | 'failed'

export interface SaveState {
  status: SaveStatus
  error: StorageError | null
}

export type SaveDraftFn = (
  projectId: string,
  draft: WorkspaceDraft,
) => Promise<StorageResult<SaveDraftResult>>

interface BootstrapLoading {
  status: 'loading'
}

interface BootstrapError {
  status: 'error'
  error: StorageError
}

interface BootstrapReady {
  status: 'ready'
  project: Project
  initialDraft: WorkspaceDraft
  /**
   * 项目里最后一个有效领域链；草稿缓存无效时作为“上次有效结果”的初始值。
   * 空白项目和从未保存过有效方案的项目为 null。
   */
  initialValidChain: ChainDefinition | null
  /** 本地 V1 项目刚升级时的提示；未迁移为 null。 */
  migrationNotice: string | null
}

type BootstrapState = BootstrapLoading | BootstrapError | BootstrapReady

export type WorkspaceBootstrap = BootstrapState & { retry: () => void }

function emptyBootstrapError(): StorageError {
  return {
    code: 'bootstrap_failed',
    message: '无法加载本地项目',
    details: [],
  }
}

/**
 * 打开工作台的引导流程：
 * 1. 指定 projectId 时只打开该项目；未指定时读取本地项目，没有项目时创建一个
 *    空白项目，有项目时使用 updatedAt 最新的那个（listProjects 已按该顺序排序）；
 * 2. 读取该项目草稿；没有草稿时从最后一个有效方案还原输入。
 *
 * 只有全部读取完成后才返回 ready。页面在 ready 之前只渲染加载状态，
 * 不会先渲染空项目再被恢复的数据覆盖。
 *
 * 本地 V1 项目由 storage 在读取时升级；升级后的项目带 migration 标记，
 * 这里据此给出“旧确认已清除，需要重新确认”的明确提示。
 */
export function useWorkspaceBootstrap(projectId?: string): WorkspaceBootstrap {
  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState<BootstrapState>({ status: 'loading' })

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setReloadToken((token) => token + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async (): Promise<void> => {
      let project: Project

      if (projectId !== undefined) {
        const loaded = await getProject(projectId)
        if (cancelled) {
          return
        }
        if (!loaded.ok) {
          setState({ status: 'error', error: loaded.error })
          return
        }
        if (loaded.value === null) {
          setState({
            status: 'error',
            error: {
              code: 'not_found',
              message: `项目不存在：${projectId}`,
              details: [],
            },
          })
          return
        }
        project = loaded.value
      } else {
        const listed = await listProjects()
        if (cancelled) {
          return
        }
        if (!listed.ok) {
          setState({ status: 'error', error: listed.error })
          return
        }

        if (listed.value.length === 0) {
          const created = await createEmptyProject()
          if (cancelled) {
            return
          }
          if (!created.ok) {
            setState({ status: 'error', error: created.error })
            return
          }
          project = created.value
        } else {
          project = listed.value[0]
        }
      }

      const storedDraft = await getDraft(project.id)
      if (cancelled) {
        return
      }
      if (!storedDraft.ok) {
        setState({ status: 'error', error: storedDraft.error })
        return
      }

      const workingDraft = chainToDraft(project.working)
      const workingValidation = validateChain(project.working)
      // 草稿优先于项目里的最后一个有效方案；无效草稿也要原样恢复。
      const restoredDraft = storedDraft.value === null ? workingDraft : storedDraft.value.draft
      setState({
        status: 'ready',
        project,
        initialDraft: {
          ...restoredDraft,
          // 项目记录是关系修订号的权威；草稿可能停在上一次保存。
          relationRevision: Math.max(
            project.relationRevision,
            restoredDraft.relationRevision,
          ),
        },
        initialValidChain: workingValidation.ok ? workingValidation.value : null,
        migrationNotice:
          project.migration === null
            ? null
            : '此项目从旧版本（V1）升级。旧的人工确认没有版本凭据，已清除；请重新核对尺寸关系与作用方向。项目、基线与未通过的草稿输入均已保留。',
      })
    }

    void load().catch(() => {
      if (!cancelled) {
        setState({ status: 'error', error: emptyBootstrapError() })
      }
    })

    return () => {
      cancelled = true
    }
  }, [reloadToken, projectId])

  return { ...state, retry }
}

export interface PersistedWorkspaceOptions {
  /** 测试或特殊场景可注入保存函数；默认使用 storage/projects.ts 的 saveDraft。 */
  saveDraft?: SaveDraftFn
  debounceMs?: number
  initialValidChain?: ChainDefinition | null
}

export interface UsePersistedWorkspaceResult extends UseWorkspaceResult {
  saveStatus: SaveStatus
  saveError: StorageError | null
  /** 最近一次成功保存后的项目快照，保存失败时用于导出 JSON 备份。 */
  lastSavedProject: Project
  /** 项目当前唯一的不可变基线；自动保存工作方案不会改变它。 */
  baseline: Project['baseline']
  /** 把当前有效链保存为基线（覆盖由调用方先确认）。 */
  saveBaseline: () => Promise<StorageResult<Project>>
  /** 恢复基线到工作方案并清除关系确认；基线本身保持不变。 */
  restoreBaseline: () => Promise<StorageResult<SaveDraftResult>>
  /** 保存失败后立即重新保存当前草稿，不再等待防抖。 */
  retrySave: () => Promise<void>
  /** 导出项目 JSON（含来源元数据与绑定，但不含附件）；返回来源版本数，失败为 null。 */
  exportBackup: () => Promise<number | null>
  /**
   * 唯一的确认命令：写入或清除关系确认凭据。
   * 确认状态本身不写入草稿布尔，判定始终由 relation.ts 派生。
   */
  setRelationConfirmed: (confirmed: boolean) => Promise<StorageResult<Project>>
}

function saveFailure(error: unknown): { ok: false; error: StorageError } {
  return {
    ok: false,
    error: {
      code: 'storage_failure',
      message: `保存草稿失败：${error instanceof Error ? error.message : String(error)}`,
      details: [],
    },
  }
}

function invalidChainFailure(): { ok: false; error: StorageError } {
  return {
    ok: false,
    error: {
      code: 'invalid_chain',
      message: '当前草稿未通过校验，不能保存为基线',
      details: [],
    },
  }
}

function missingBaselineFailure(): { ok: false; error: StorageError } {
  return {
    ok: false,
    error: {
      code: 'baseline_missing',
      message: '项目还没有基线，无法恢复',
      details: [],
    },
  }
}

function unconfirmedFailure(): { ok: false; error: StorageError } {
  return {
    ok: false,
    error: {
      code: 'invalid_chain',
      message: '当前输入未通过校验，不能确认尺寸关系',
      details: [],
    },
  }
}

/** 用浏览器下载导出项目 JSON；存储失败和引导失败时共用。 */
export function downloadProjectBackup(
  project: Project,
  sources: ParsedProjectSources | null = null,
): void {
  const json = exportProjectJson(project, sources)
  // jsdom 等测试环境没有 Blob URL；浏览器中正常下载，测试环境无操作即可。
  if (typeof URL.createObjectURL !== 'function') {
    return
  }
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${project.name.trim() || 'project'}-backup.json`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * 工作台编辑状态 + 自动保存 + 关系确认。
 *
 * 草稿每次变化后先显示“保存中”，500 ms 内没有新变化才写入 IndexedDB。
 * 关系修订号变化时不等防抖，立即写入项目记录，保证“改成非法再改回”
 * 或短时间刷新也不会保留旧确认。
 */
export function usePersistedWorkspace(
  project: Project,
  initialDraft: WorkspaceDraft,
  options: PersistedWorkspaceOptions = {},
): UsePersistedWorkspaceResult {
  const [relationState, setRelationState] = useState<RelationState>({
    relationRevision: project.relationRevision,
    relationReview: project.relationReview,
  })
  // 当前生效修订号取草稿与已确认状态的最大值：编辑会先递增草稿修订号，
  // 首帧即可让旧凭据失效，不需要在 effect 里补一次 setState。
  const workspace = useWorkspace(initialDraft, options.initialValidChain, relationState)
  const { draft, dispatch, chain, lastValidChain } = workspace
  const debounceMs = options.debounceMs ?? AUTO_SAVE_DEBOUNCE_MS
  const saveRef = useRef<SaveDraftFn | null>(options.saveDraft ?? null)
  const generationRef = useRef(0)
  const isInitialRenderRef = useRef(true)
  const relationStateRef = useRef<RelationState>(relationState)
  /** 已经写入项目记录的关系修订号，避免重复持久化同一次编辑。 */
  const persistedRevisionRef = useRef(project.relationRevision)
  const [saveState, setSaveState] = useState<SaveState>({
    status: 'saved',
    error: null,
  })
  const [lastSavedProject, setLastSavedProject] = useState<Project>(project)
  const [baseline, setBaseline] = useState<Project['baseline']>(project.baseline)

  useEffect(() => {
    saveRef.current = options.saveDraft ?? null
  }, [options.saveDraft])

  /** 只更新关系修订号与凭据的小事务；失败时明确显示保存失败。 */
  const persistRelationState = useCallback(
    async (next: RelationState): Promise<StorageResult<Project>> => {
      let result: StorageResult<Project>
      try {
        result = await updateProject(project.id, {
          relationRevision: next.relationRevision,
          relationReview: next.relationReview,
        })
      } catch (error) {
        result = saveFailure(error)
      }
      if (result.ok) {
        setLastSavedProject(result.value)
        // 立即同步 ref：后续草稿保存与最后一次确认比较时不能再用旧修订号。
        relationStateRef.current = next
        // 保存状态由草稿防抖路径负责：关系修订号的立即落库不应把
        // “草稿仍在防抖”误显示成已保存。
      } else {
        setSaveState({ status: 'failed', error: result.error })
      }
      return result
    },
    [project.id],
  )

  /**
   * 编辑使关系修订号递增时立即落库，不等待 500 ms 防抖。
   * 这里只写关系字段，草稿与 working 仍按原防抖路径保存。
   */
  useEffect(() => {
    if (draft.relationRevision <= relationState.relationRevision) {
      return
    }
    if (draft.relationRevision <= persistedRevisionRef.current) {
      return
    }
    const next: RelationState = {
      relationRevision: draft.relationRevision,
      relationReview: relationState.relationReview,
    }
    // 先记下已提交的修订号，避免同一次编辑触发重复写入；失效判定本身由
    // useWorkspace 按草稿修订号即时完成，不依赖这次 setState。
    persistedRevisionRef.current = next.relationRevision
    void persistRelationState(next)
  }, [
    draft.relationRevision,
    relationState.relationReview,
    relationState.relationRevision,
    persistRelationState,
  ])

  /**
   * 写入一次草稿，并只在这次写入仍是最新代数时更新保存状态。
   * 自动保存与保存失败后的手动重试都走这里，避免两处对状态解释不一致。
   */
  const persistDraftWithState = useCallback(
    async (
      draftToSave: WorkspaceDraft,
      generation: number,
    ): Promise<StorageResult<SaveDraftResult>> => {
      let result: StorageResult<SaveDraftResult>
      try {
        // 默认直接调用 storage 模块的 saveDraft，便于测试 spy；只有显式注入时才走 ref。
        result = await (saveRef.current ?? persistDraft)(project.id, draftToSave)
        // 注入实现（测试）不接收 relationState；真实 storage 路径需要它把修订号
        // 与凭据和草稿写在同一事务里。
        if (result.ok && result.value.project.relationRevision !== relationStateRef.current.relationRevision) {
          await persistRelationState(relationStateRef.current)
        }
      } catch (error) {
        result = saveFailure(error)
      }

      // 期间又有编辑时，旧请求的结果不能把状态改回“已保存”。
      if (generation !== generationRef.current) {
        return result
      }

      if (result.ok) {
        setLastSavedProject(result.value.project)
        setSaveState({ status: 'saved', error: null })
      } else {
        setSaveState({ status: 'failed', error: result.error })
      }
      return result
    },
    [persistRelationState, project.id],
  )

  useEffect(() => {
    if (isInitialRenderRef.current) {
      isInitialRenderRef.current = false
      return
    }

    const generation = generationRef.current + 1
    generationRef.current = generation
    setSaveState({ status: 'saving', error: null })

    const draftToSave = draft
    let started = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const performSave = async (): Promise<void> => {
      await persistDraftWithState(draftToSave, generation)
    }

    /** 防抖到点或页面切到 hidden 时只触发一次保存。 */
    const flush = (): void => {
      if (started) {
        return
      }
      started = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      void performSave()
    }

    timer = setTimeout(flush, debounceMs)

    // 文档第 7 节：页面不可见时立即保存待保存草稿，不再等待防抖。
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        flush()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (timer !== null) {
        clearTimeout(timer)
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [draft, project.id, debounceMs, persistDraftWithState])

  /**
   * 保存失败后的“重试”：立即重新写入当前草稿。
   * 进入新的代数后，之前遗留的写入结果不能再覆盖本次重试的状态。
   */
  const retrySave = useCallback(async (): Promise<void> => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    setSaveState({ status: 'saving', error: null })
    await persistDraftWithState(draft, generation)
  }, [draft, persistDraftWithState])

  const saveBaseline = useCallback(async (): Promise<StorageResult<Project>> => {
    if (chain === null) {
      return invalidChainFailure()
    }
    const result = await updateProject(project.id, {
      baseline: {
        savedAt: new Date().toISOString(),
        definition: chain,
      },
    })
    if (result.ok) {
      setBaseline(result.value.baseline)
      setLastSavedProject(result.value)
    }
    return result
  }, [chain, project.id])

  const restoreBaseline = useCallback(async (): Promise<
    StorageResult<SaveDraftResult>
  > => {
    if (baseline === null) {
      return missingBaselineFailure()
    }

    // 恢复的是基线的工程输入；关系确认必须重新由用户核对。
    const revision = Math.max(draft.relationRevision, relationState.relationRevision) + 1
    const restoredDraft: WorkspaceDraft = {
      ...chainToDraft(baseline.definition),
      relationRevision: revision,
    }
    const nextRelationState: RelationState = {
      relationRevision: revision,
      relationReview: null,
    }
    setRelationState(nextRelationState)
    dispatch({ type: 'replaceDraft', draft: restoredDraft })
    await persistRelationState(nextRelationState)

    // 立即写入一次，避免恢复后在防抖窗口内刷新或关闭页面丢失工作方案。
    let result: StorageResult<SaveDraftResult>
    try {
      result = await (saveRef.current ?? persistDraft)(project.id, restoredDraft)
    } catch (error) {
      result = saveFailure(error)
    }

    if (result.ok) {
      setLastSavedProject(result.value.project)
      setSaveState({ status: 'saved', error: null })
    } else {
      setSaveState({ status: 'failed', error: result.error })
    }
    return result
  }, [baseline, dispatch, draft.relationRevision, persistRelationState, project.id, relationState.relationRevision])

  const exportBackup = useCallback(async (): Promise<number | null> => {
    // 当前草稿有效时导出当前有效链；无效时导出内存中最后一次有效链
    // （保存失败期间它可能比 lastSavedProject.working 更新），都没有才回退到已保存版本。
    const working = chain ?? lastValidChain ?? lastSavedProject.working
    const projectForExport: Project = {
      ...lastSavedProject,
      working,
      baseline,
      relationRevision: relationState.relationRevision,
      relationReview: relationState.relationReview,
    }
    const sources = await loadProjectSources(project.id)
    if (!sources.ok) {
      setSaveState({ status: 'failed', error: sources.error })
      return null
    }
    downloadProjectBackup(projectForExport, sources.value)
    return sources.value.revisions.length
  }, [
    baseline,
    chain,
    lastValidChain,
    lastSavedProject,
    project.id,
    relationState.relationRevision,
    relationState.relationReview,
  ])

  const setRelationConfirmed = useCallback(
    async (confirmed: boolean): Promise<StorageResult<Project>> => {
      const revision = Math.max(draft.relationRevision, relationState.relationRevision)
      let next: RelationState
      if (confirmed) {
        if (chain === null) {
          return unconfirmedFailure()
        }
        const review: RelationReview = createRelationReview(
          chain,
          revision,
          new Date().toISOString(),
        )
        next = { relationRevision: revision, relationReview: review }
      } else {
        next = { relationRevision: revision, relationReview: null }
      }
      setRelationState(next)
      relationStateRef.current = next
      persistedRevisionRef.current = revision
      // 确认/取消本身也是一次持久化：先显示保存中，写入完成后再回到已保存。
      setSaveState({ status: 'saving', error: null })
      const result = await persistRelationState(next)
      if (!result.ok) {
        setSaveState({ status: 'failed', error: result.error })
        return result
      }
      // 确认后立即把当前草稿也写入（不等 500 ms 防抖），避免“确认已保存、
      // 草稿却还在内存里”。同一份草稿同时更新 working 与 drafts。
      const generation = generationRef.current + 1
      generationRef.current = generation
      await persistDraftWithState(draft, generation)
      setSaveState({ status: 'saved', error: null })
      return result
    },
    [chain, draft, persistDraftWithState, persistRelationState, relationState.relationRevision],
  )

  return {
    ...workspace,
    saveStatus: saveState.status,
    saveError: saveState.error,
    lastSavedProject,
    baseline,
    saveBaseline,
    restoreBaseline,
    retrySave,
    exportBackup,
    setRelationConfirmed,
  }
}
