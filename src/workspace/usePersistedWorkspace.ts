import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChainDefinition, Project } from '../domain/types'
import { validateChain } from '../domain/validation'
import {
  createEmptyProject,
  exportProjectJson,
  getDraft,
  listProjects,
  saveDraft as persistDraft,
  updateProject,
  type SaveDraftResult,
  type StorageError,
  type StorageResult,
} from '../storage/projects'
import {
  chainToDraft,
  type WorkspaceDraft,
} from './draft'
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
 * 1. 读取本地项目，没有项目时创建一个空白项目（不建设项目列表页）；
 * 2. 有项目时使用 updatedAt 最新的那个（listProjects 已按该顺序排序）；
 * 3. 读取该项目草稿；没有草稿时从最后一个有效方案还原输入。
 *
 * 只有全部读取完成后才返回 ready。页面在 ready 之前只渲染加载状态，
 * 不会先渲染空项目再被恢复的数据覆盖。
 */
export function useWorkspaceBootstrap(): WorkspaceBootstrap {
  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState<BootstrapState>({ status: 'loading' })

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setReloadToken((token) => token + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async (): Promise<void> => {
      const listed = await listProjects()
      if (cancelled) {
        return
      }
      if (!listed.ok) {
        setState({ status: 'error', error: listed.error })
        return
      }

      let project: Project
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
      setState({
        status: 'ready',
        project,
        // 草稿优先于项目里的最后一个有效方案；无效草稿也要原样恢复。
        initialDraft:
          storedDraft.value === null ? workingDraft : storedDraft.value.draft,
        initialValidChain: workingValidation.ok ? workingValidation.value : null,
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
  }, [reloadToken])

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
  exportBackup: () => void
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

function downloadProjectBackup(project: Project): void {
  const json = exportProjectJson(project)
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
 * 工作台编辑状态 + 自动保存。
 *
 * 草稿每次变化后先显示“保存中”，500 ms 内没有新变化才写入 IndexedDB。
 * 保存失败始终进入 failed，绝不显示“已保存”；并发保存用代数计数防止
 * 旧请求覆盖新状态。
 */
export function usePersistedWorkspace(
  project: Project,
  initialDraft: WorkspaceDraft,
  options: PersistedWorkspaceOptions = {},
): UsePersistedWorkspaceResult {
  const workspace = useWorkspace(initialDraft, options.initialValidChain)
  const { draft, dispatch, chain, lastValidChain } = workspace
  const debounceMs = options.debounceMs ?? AUTO_SAVE_DEBOUNCE_MS
  const saveRef = useRef<SaveDraftFn | null>(options.saveDraft ?? null)
  const generationRef = useRef(0)
  const isInitialRenderRef = useRef(true)
  const [saveState, setSaveState] = useState<SaveState>({
    status: 'saved',
    error: null,
  })
  const [lastSavedProject, setLastSavedProject] = useState<Project>(project)
  const [baseline, setBaseline] = useState<Project['baseline']>(project.baseline)

  useEffect(() => {
    saveRef.current = options.saveDraft ?? null
  }, [options.saveDraft])

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
      let result: StorageResult<SaveDraftResult>
      try {
        // 默认直接调用 storage 模块的 saveDraft，便于测试 spy；只有显式注入时才走 ref。
        result = await (saveRef.current ?? persistDraft)(project.id, draftToSave)
      } catch (error) {
        result = saveFailure(error)
      }

      // 期间又有编辑时，旧请求的结果不能把状态改回“已保存”。
      if (generation !== generationRef.current) {
        return
      }

      if (result.ok) {
        setLastSavedProject(result.value.project)
        setSaveState({ status: 'saved', error: null })
      } else {
        setSaveState({ status: 'failed', error: result.error })
      }
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
  }, [draft, project.id, debounceMs])

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
    const restoredDraft: WorkspaceDraft = {
      ...chainToDraft(baseline.definition),
      relationConfirmed: false,
    }
    dispatch({ type: 'replaceDraft', draft: restoredDraft })

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
  }, [baseline, dispatch, project.id])

  const exportBackup = useCallback(() => {
    // 当前草稿有效时导出当前有效链；无效时导出内存中最后一次有效链
    // （保存失败期间它可能比 lastSavedProject.working 更新），都没有才回退到已保存版本。
    const working = chain ?? lastValidChain ?? lastSavedProject.working
    const projectForExport: Project = { ...lastSavedProject, working, baseline }
    downloadProjectBackup(projectForExport)
  }, [baseline, chain, lastValidChain, lastSavedProject])

  return {
    ...workspace,
    saveStatus: saveState.status,
    saveError: saveState.error,
    lastSavedProject,
    baseline,
    saveBaseline,
    restoreBaseline,
    exportBackup,
  }
}
