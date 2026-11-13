import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  MAPPING_TEMPLATES_EXCLUDED_NOTE,
  createProjectBundle,
} from '../backup/projectBundle'
import { inspectBackup, restoreBackup, type BackupInspection } from '../backup/restore'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { uiDiagnosticText } from '../components/uiIdentity'
import { ImportWizard } from '../components/ImportWizard'
import type { Project } from '../domain/types'
import {
  DEMO_CASES,
  DEMO_DISCLAIMER,
  createDemoChain,
  demoCaseName,
  type DemoCaseId,
} from '../fixtures/demo'
import {
  createEmptyProject,
  createProject,
  deleteProject,
  exportLegacyBackup,
  exportProjectJson,
  importProject,
  inspectLegacyProjects,
  LEGACY_SCHEMA_VERSION,
  listDrafts,
  listProjects,
  migrateLegacyProjectsNow,
  restoreLegacyBackup,
  updateProject,
  type LegacyImpactReport,
  type StorageError,
  type StorageResult,
} from '../storage/projects'
import type { CommitImportSuccess } from '../import/commit'
import { useDatabaseStaleVersion } from '../storage/databaseStale'
import type { WorkspaceDraft } from '../workspace/draft'
import { resolveStoredWorkspaceStatus } from '../workspace/status'
import './ProjectList.css'

export interface ProjectListProps {
  /** 进入工作台；未提供时使用 location.hash 路由。 */
  onOpenProject?: (projectId: string) => void
}

interface UiError {
  message: string
  reasons: string[]
}

type StatusTone = 'done' | 'pending' | 'invalid' | 'outside'

interface ProjectStatus {
  label: string
  tone: StatusTone
}

function workspaceHash(projectId: string): string {
  return `#/projects/${encodeURIComponent(projectId)}`
}

/**
 * 项目列表中的“当前计算状态”与工作台共用同一份判定：
 * 有效草稿（或工作方案）的领域结果 + relationConfirmed + 草稿是否有效。
 * 列表只负责把共享状态映射成徽标文案和颜色，不重新计算尺寸或判定。
 */
function projectStatus(
  project: Project,
  draft: WorkspaceDraft | null,
): ProjectStatus {
  const status = resolveStoredWorkspaceStatus({
    working: project.working,
    draft,
    relationRevision: project.relationRevision,
    relationReview: project.relationReview,
  })

  if (status.kind === 'no-result') {
    const hasDraftTerms = draft !== null && draft.terms.length > 0
    return project.working.terms.length === 0 && !hasDraftTerms
      ? { label: '未完成', tone: 'pending' }
      : { label: '输入有误', tone: 'invalid' }
  }

  switch (status.kind) {
    case 'within':
      return { label: status.label, tone: 'done' }
    case 'outside':
      return { label: status.label, tone: 'outside' }
    case 'pending':
      return { label: status.label, tone: 'pending' }
    case 'no-target':
      return { label: status.label, tone: 'pending' }
  }
}

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt)
  return Number.isNaN(date.getTime()) ? updatedAt : date.toLocaleString('zh-CN')
}

/**
 * listProjects({migrate:false}) 可能返回尚未迁移的 V1 原始记录；它们没有
 * relationRevision 等 v2 字段，必须先分流到迁移面板，不能进入正常状态计算。
 */
function isLegacyProjectRecord(project: Project): boolean {
  return (
    (project as { schemaVersion?: number }).schemaVersion === LEGACY_SCHEMA_VERSION
  )
}

function toUiError(error: StorageError): UiError {
  // 存储层常把同一句话同时放在 message 与 details 里；界面不要重复显示。
  const reasons = Array.from(
    new Set(
      error.details
        .map((detail) => detail.message)
        .filter((message) => message.trim() !== '' && message !== error.message),
    ),
  )
  return {
    message: error.message,
    reasons,
  }
}

function unexpectedError(error: unknown): UiError {
  const message = error instanceof Error ? error.message : String(error)
  return { message, reasons: [message] }
}

function readFileText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('读取项目文件失败'))
    }
    reader.readAsText(file)
  })
}

function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result))
        return
      }
      reject(new Error('读取备份文件失败：未得到二进制内容'))
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('读取备份文件失败'))
    }
    reader.readAsArrayBuffer(file)
  })
}

function downloadBinaryFile(fileName: string, bytes: Uint8Array): void {
  if (typeof URL.createObjectURL !== 'function') {
    return
  }
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

interface ProjectListSnapshot {
  /** 可能含尚未迁移的 V1 原始记录（migrate:false 读取）。 */
  projects: Project[]
  drafts: ReadonlyMap<string, WorkspaceDraft>
  legacy: LegacyImpactReport
}

/**
 * 项目列表与草稿分开存储；展示状态前必须同时读取两者。
 * 这里刻意不自动迁移：先拿到迁移前影响报告，让用户能导出原始备份后再决定。
 */
async function loadProjectList(): Promise<StorageResult<ProjectListSnapshot>> {
  const [listed, storedDrafts, legacy] = await Promise.all([
    listProjects({ migrate: false }),
    listDrafts(),
    inspectLegacyProjects(),
  ])
  if (!listed.ok) {
    return listed
  }
  if (!storedDrafts.ok) {
    return storedDrafts
  }
  if (!legacy.ok) {
    return legacy
  }
  return {
    ok: true,
    value: {
      projects: listed.value,
      drafts: new Map(
        storedDrafts.value.map((stored) => [stored.projectId, stored.draft]),
      ),
      legacy: legacy.value,
    },
  }
}

/** 浏览器下载一段文本文件；jsdom 没有 Blob URL 时静默跳过。 */
function downloadTextFile(fileName: string, text: string): void {
  if (typeof URL.createObjectURL !== 'function') {
    return
  }
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * 项目首页。
 *
 * 列表只显示项目元数据和领域层算出的当前状态；新建、复制、删除都把持久化
 * 交给 storage/projects.ts。导入被拒时只展示原因，不修改列表里的已有项目。
 */
export function ProjectList({ onOpenProject }: ProjectListProps = {}) {
  const editingDisabled = useDatabaseStaleVersion() !== null
  const [projects, setProjects] = useState<Project[]>([])
  const [drafts, setDrafts] = useState<ReadonlyMap<string, WorkspaceDraft>>(
    () => new Map(),
  )
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [retryingLoad, setRetryingLoad] = useState(false)
  const [listError, setListError] = useState<UiError | null>(null)
  const [actionError, setActionError] = useState<UiError | null>(null)
  const [importError, setImportError] = useState<UiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null)
  const [tableImportOpen, setTableImportOpen] = useState(false)
  const [demoCase, setDemoCase] = useState<DemoCaseId>('A')
  const [legacy, setLegacy] = useState<LegacyImpactReport | null>(null)
  const [legacyNotice, setLegacyNotice] = useState<string | null>(null)
  const [legacyError, setLegacyError] = useState<string | null>(null)
  const [legacyBusy, setLegacyBusy] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupError, setBackupError] = useState<UiError | null>(null)
  const [pendingRestore, setPendingRestore] = useState<{
    fileName: string
    bytes: Uint8Array
    inspection: BackupInspection
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const legacyRestoreInputRef = useRef<HTMLInputElement>(null)
  const backupRestoreInputRef = useRef<HTMLInputElement>(null)

  const openProject = useCallback(
    (projectId: string) => {
      if (onOpenProject !== undefined) {
        onOpenProject(projectId)
        return
      }
      window.location.hash = workspaceHash(projectId)
    },
    [onOpenProject],
  )

  const refresh = useCallback(async (): Promise<boolean> => {
    const snapshot = await loadProjectList()
    if (!snapshot.ok) {
      setListError(toUiError(snapshot.error))
      return false
    }
    setProjects(snapshot.value.projects)
    setDrafts(snapshot.value.drafts)
    setLegacy(snapshot.value.legacy)
    setListError(null)
    return true
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const snapshot = await loadProjectList()
      if (cancelled) {
        return
      }
      if (!snapshot.ok) {
        setListError(toUiError(snapshot.error))
        setLoading(false)
        return
      }
      setProjects(snapshot.value.projects)
      setDrafts(snapshot.value.drafts)
      setLegacy(snapshot.value.legacy)
      setLoading(false)
    }

    void load().catch((error: unknown) => {
      if (!cancelled) {
        setListError(unexpectedError(error))
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  /** 项目列表读取失败时重新打开 IndexedDB，而不是只清掉错误文案。 */
  const handleRetryLoad = (): void => {
    void (async () => {
      setRetryingLoad(true)
      await refresh()
      setRetryingLoad(false)
    })()
  }

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setActionError(null)
    setImportError(null)
    setBackupError(null)
    setNotice(null)
    try {
      await action()
    } catch (error) {
      setActionError(unexpectedError(error))
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = (): void => {
    void runAction(async () => {
      const created = await createEmptyProject()
      if (!created.ok) {
        setActionError(toUiError(created.error))
        return
      }
      await refresh()
      openProject(created.value.id)
    })
  }

  /**
   * 演示案例每次都用 createProject 新建项目：storage 生成新 ID，已有项目不受影响。
   * fixture 只提供文档第 8 节的数值，尺寸链计算仍由工作台调用统一计算内核完成。
   */
  const handleOpenDemo = (): void => {
    void runAction(async () => {
      const created = await createProject({
        name: demoCaseName(demoCase),
        working: createDemoChain(demoCase),
      })
      if (!created.ok) {
        setActionError(toUiError(created.error))
        return
      }
      await refresh()
      setNotice(`已打开${created.value.name}（新建项目，未覆盖已有项目）`)
      openProject(created.value.id)
    })
  }

  const handleTableImported = (result: CommitImportSuccess): void => {
    setNotice(
      `已从表格新建项目「${result.project.name}」；请在工作台核对关系并重新确认。`,
    )
    void refresh()
    openProject(result.project.id)
  }

  const handleImport = (file: File): void => {
    void runAction(async () => {
      const json = await readFileText(file)
      const imported = await importProject(json)
      if (!imported.ok) {
        setImportError(toUiError(imported.error))
        return
      }
      await refresh()
      setNotice(
        imported.value.idChanged
          ? `已导入项目「${imported.value.project.name}」（项目 ID 冲突，已生成新 ID）`
          : `已导入项目「${imported.value.project.name}」`,
      )
    })
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    // 允许用户连续选择同一个文件再次导入。
    event.target.value = ''
    if (file !== undefined) {
      handleImport(file)
    }
  }

  /** 迁移前导出：原始 V1 项目与草稿，文件落在用户本机，而不是只在库里。 */
  const handleExportLegacyBackup = (): void => {
    void (async () => {
      setLegacyBusy(true)
      setLegacyError(null)
      setLegacyNotice(null)
      const exported = await exportLegacyBackup()
      setLegacyBusy(false)
      if (!exported.ok) {
        setLegacyError(exported.error.message)
        return
      }
      const stamp = new Date().toISOString().slice(0, 10)
      downloadTextFile(`迁移前原始备份-${stamp}.json`, exported.value.json)
      setLegacyNotice(
        `已导出迁移前原始备份：${exported.value.projectCount} 个项目、${exported.value.draftCount} 份草稿。` +
          '文件保存在本机，含原始 V1 记录与无效草稿输入；恢复方式见下方“迁移与恢复步骤”。',
      )
    })()
  }

  const handleMigrateLegacy = (): void => {
    void (async () => {
      setLegacyBusy(true)
      setLegacyError(null)
      setLegacyNotice(null)
      const migrated = await migrateLegacyProjectsNow()
      if (!migrated.ok) {
        setLegacyError(migrated.error.message)
        await refresh()
        setLegacyBusy(false)
        return
      }
      await refresh()
      setLegacyBusy(false)
      setLegacyNotice(
        `已迁移 ${migrated.value.length} 个旧版项目：数值、方向、基线与无效草稿输入保留；` +
          '旧的人工确认已清除，需要重新确认。原始记录已写入 migrationBackups。',
      )
    })()
  }

  const handleRestoreLegacyFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) {
      return
    }
    void (async () => {
      setLegacyBusy(true)
      setLegacyError(null)
      setLegacyNotice(null)
      try {
        const text = await readFileText(file)
        const restored = await restoreLegacyBackup(text)
        if (!restored.ok) {
          setLegacyError(restored.error.message)
          setLegacyBusy(false)
          return
        }
        await refresh()
        setLegacyBusy(false)
        const names = restored.value.restored
          .slice(0, 5)
          .map((item) => `「${item.name}」（新 ID ${item.newProjectId.slice(0, 8)}…）`)
          .join('、')
        setLegacyNotice(
          `已从迁移前备份恢复 ${restored.value.restored.length} 个项目为新项目：${names}` +
            (restored.value.restored.length > 5 ? ' 等' : '') +
            '。原有项目未被覆盖，数据库版本未降级；请重新确认关系。' +
            (restored.value.failed.length > 0
              ? ` 有 ${restored.value.failed.length} 个项目恢复失败。`
              : ''),
        )
      } catch (error) {
        setLegacyBusy(false)
        setLegacyError(unexpectedError(error).message)
      }
    })()
  }

  const handleCopy = (project: Project): void => {
    void runAction(async () => {
      const imported = await importProject(exportProjectJson(project))
      if (!imported.ok) {
        setActionError(toUiError(imported.error))
        return
      }

      const copyName = `${project.name}（副本）`
      const renamed = await updateProject(imported.value.project.id, {
        name: copyName,
      })
      await refresh()
      setNotice(
        renamed.ok
          ? `已复制项目「${project.name}」，副本使用新 ID`
          : `已复制项目「${project.name}」，但副本改名失败：${renamed.error.message}`,
      )
    })
  }

  const handleConfirmDelete = (): void => {
    const target = pendingDelete
    setPendingDelete(null)
    if (target === null) {
      return
    }

    void runAction(async () => {
      const deleted = await deleteProject(target.id)
      if (!deleted.ok) {
        setActionError(toUiError(deleted.error))
        return
      }
      await refresh()
      setNotice(`已删除项目「${target.name}」`)
    })
  }

  /** 完整备份：读取全部业务 store，生成 .cunlian.zip 并交给浏览器下载。 */
  const handleExportBundle = (): void => {
    void (async () => {
      setBackupBusy(true)
      setBackupError(null)
      setNotice(null)
      const bundle = await createProjectBundle()
      setBackupBusy(false)
      if (!bundle.ok) {
        setBackupError({
          message: bundle.error.message,
          reasons: bundle.error.detail === undefined ? [] : [bundle.error.detail],
        })
        return
      }
      downloadBinaryFile(bundle.value.fileName, bundle.value.bytes)
      setNotice(
        `已导出完整备份「${bundle.value.fileName}」：${bundle.value.manifest.counts.projects} 个项目、` +
          `${bundle.value.manifest.counts.revisions} 个来源版本、` +
          `${bundle.value.manifest.counts.snapshots} 份分析快照。` +
          MAPPING_TEMPLATES_EXCLUDED_NOTE,
      )
    })()
  }

  const handleRestoreFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    // 允许用户连续选择同一个文件再次校验。
    event.target.value = ''
    if (file === undefined) {
      return
    }
    void (async () => {
      setBackupBusy(true)
      setBackupError(null)
      setNotice(null)
      try {
        const bytes = await readFileBytes(file)
        const inspected = await inspectBackup(bytes)
        setBackupBusy(false)
        if (!inspected.ok) {
          setBackupError({
            message: inspected.error.message,
            reasons:
              inspected.error.detail === undefined ? [] : [inspected.error.detail],
          })
          return
        }
        setPendingRestore({
          fileName: file.name,
          bytes,
          inspection: inspected.value,
        })
      } catch (error) {
        setBackupBusy(false)
        setBackupError(unexpectedError(error))
      }
    })()
  }

  const handleConfirmRestore = (): void => {
    const pending = pendingRestore
    setPendingRestore(null)
    if (pending === null) {
      return
    }
    void (async () => {
      setBackupBusy(true)
      setBackupError(null)
      setNotice(null)
      const restored = await restoreBackup(pending.bytes)
      setBackupBusy(false)
      if (!restored.ok) {
        setBackupError({
          message: restored.error.message,
          reasons:
            restored.error.detail === undefined ? [] : [restored.error.detail],
        })
        return
      }
      await refresh()
      setNotice(
        `已从「${pending.fileName}」恢复 ${restored.value.projects.length} 个项目：` +
          `${restored.value.projects
            .slice(0, 3)
            .map((project) => `「${project.name}」`)
            .join('、')}${restored.value.projects.length > 3 ? ' 等' : ''}。` +
          '数值、来源文件哈希、绑定坐标与历史已恢复；人工确认已清除，需要重新核对。' +
          '全局映射模板未包含在备份中。',
      )
    })()
  }

  const legacyProjects = projects.filter(isLegacyProjectRecord)
  const activeProjects = projects.filter((project) => !isLegacyProjectRecord(project))
  const errors = [listError, actionError, importError, backupError].filter(
    (error): error is UiError => error !== null,
  )

  return (
    <main className="project-list">
      <header className="project-list__header">
        <div>
          <h1 className="project-list__title">项目列表</h1>
          <p className="project-list__subtitle">
            项目资料只保存在本机浏览器。打开项目进行分析，或通过 JSON 文件备份和迁移。
          </p>
        </div>
      </header>

      <div className="project-list__toolbar">
        <button
          type="button"
          className="project-list__create"
          onClick={handleCreate}
          disabled={busy || editingDisabled}
        >
          新建
        </button>
        <button
          type="button"
          className="project-list__table-import"
          onClick={() => setTableImportOpen(true)}
          disabled={busy || editingDisabled}
        >
          从表格导入
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || editingDisabled}
        >
          导入 JSON
        </button>
        <input
          ref={fileInputRef}
          className="project-list__file-input"
          type="file"
          accept=".json,application/json"
          aria-label="导入 JSON 文件"
          onChange={handleFileChange}
          disabled={busy || editingDisabled}
        />
        <button
          type="button"
          onClick={handleExportBundle}
          disabled={busy || backupBusy || editingDisabled}
        >
          {backupBusy ? '处理中…' : '导出完整备份'}
        </button>
        <button
          type="button"
          onClick={() => backupRestoreInputRef.current?.click()}
          disabled={busy || backupBusy || editingDisabled}
        >
          从完整备份恢复
        </button>
        <input
          ref={backupRestoreInputRef}
          className="project-list__file-input"
          type="file"
          accept=".zip,application/zip"
          aria-label="导入完整备份文件"
          onChange={handleRestoreFileChange}
          disabled={busy || backupBusy || editingDisabled}
        />
        <label className="project-list__demo-label" htmlFor="demo-case-select">
          演示案例
        </label>
        <select
          id="demo-case-select"
          className="project-list__demo-select"
          value={demoCase}
          onChange={(event) => setDemoCase(event.target.value as DemoCaseId)}
          disabled={busy || editingDisabled}
        >
          {DEMO_CASES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="project-list__demo-open"
          onClick={handleOpenDemo}
          disabled={busy || editingDisabled}
        >
          打开演示案例
        </button>
      </div>

      <p className="project-list__demo-note" role="note">
        {DEMO_DISCLAIMER}
      </p>

      {legacyNotice !== null ? (
        <p className="project-list__migration-notice" role="status">
          {legacyNotice}
        </p>
      ) : null}
      {legacyError !== null ? (
        <p className="project-list__migration-error" role="alert">
          {uiDiagnosticText(legacyError)}
        </p>
      ) : null}

      {legacyProjects.length > 0 && legacy !== null ? (
        <section
          className="project-list__migration"
          aria-labelledby="legacy-migration-heading"
          data-testid="legacy-migration-panel"
        >
          <h2 id="legacy-migration-heading" className="project-list__migration-title">
            检测到 {legacyProjects.length} 个旧版（V1）项目，尚未迁移
          </h2>
          <p>
            迁移会在本地数据库内把项目升级到 v2：数值、方向、基线与未通过的草稿输入都保留；
            旧的人工确认没有版本凭据，会被清除并要求重新确认。原始记录同时写入
            migrationBackups。
          </p>
          <p>
            <strong>建议先导出“迁移前原始备份”保存到本机</strong>
            （含全部 V1 项目与草稿的原始记录；V1 没有 PDF 来源，因此不含附件），再开始迁移。
          </p>
          <ul className="project-list__migration-list">
            {legacy.projects.map((project) => (
              <li key={project.id} data-testid={`legacy-project-${project.id}`}>
                <span className="project-list__migration-name">{project.name}</span>
                <span className="project-list__migration-meta">
                  {project.termCount} 个组成环 ·{' '}
                  {project.baselineTermCount === null
                    ? '无基线'
                    : `基线 ${project.baselineTermCount} 个环`}{' '}
                  ·{' '}
                  {project.draftPresent
                    ? project.draftInvalid
                      ? '草稿（含无效输入，将保留）'
                      : '草稿'
                    : '无草稿'}{' '}
                  ·{' '}
                  {project.workingConfirmationWillClear ||
                  project.baselineConfirmationWillClear
                    ? '旧人工确认将被清除'
                    : '无旧人工确认'}
                </span>
                {project.migrationError !== null ? (
                  <span className="project-list__migration-blocker">
                    无法迁移：{project.migrationError}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="project-list__migration-actions">
            <button
              type="button"
              onClick={handleExportLegacyBackup}
              disabled={legacyBusy}
            >
              导出迁移前原始备份（{legacyProjects.length} 个项目）
            </button>
            <button
              type="button"
              className="project-list__migration-start"
              onClick={handleMigrateLegacy}
              disabled={legacyBusy || legacy.blocking > 0 || editingDisabled}
            >
              {legacyBusy ? '处理中…' : `开始迁移（${legacyProjects.length} 个项目）`}
            </button>
          </div>
          {legacy.blocking > 0 ? (
            <p className="project-list__migration-blocker" role="alert">
              有 {legacy.blocking} 个项目会让整批迁移失败；“开始迁移”已禁用。
              迁移失败会整批回滚，原始 V1 记录仍在，可修正后重试。
            </p>
          ) : null}
        </section>
      ) : null}

      <details className="project-list__migration-help" data-testid="legacy-migration-help">
        <summary>迁移与恢复步骤</summary>
        <ol>
          <li>
            <strong>迁移前：</strong>在上面的“旧版项目”提示里点“导出迁移前原始备份”，
            文件会下载到本机（含全部 V1 项目与草稿原始记录，不含 PDF 附件）。
          </li>
          <li>
            <strong>迁移：</strong>点“开始迁移”。整批迁移在同一个数据库事务内完成；
            任一步失败都会整体回滚，原始 V1 记录仍在，可重试，不会留下半迁移项目。
          </li>
          <li>
            <strong>恢复：</strong>点下面的“导入迁移前原始备份”并选择该文件。
            恢复会把原始记录重新导入为<strong>新项目（新 ID）</strong>，保留数值、基线与草稿输入；
            不覆盖现有项目，也不会把数据库降级。恢复后需要重新确认关系。
          </li>
          <li>
            <strong>版本提示：</strong>若页面提示“本地数据库版本高于当前页面”，刷新到最新页面；
            不要删除浏览器数据或降级数据库，仅回退前端打不开已升级的库。
          </li>
        </ol>
        <div className="project-list__migration-actions">
          <button
            type="button"
            onClick={() => legacyRestoreInputRef.current?.click()}
            disabled={legacyBusy || editingDisabled}
          >
            导入迁移前原始备份
          </button>
          <input
            ref={legacyRestoreInputRef}
            className="project-list__file-input"
            type="file"
            accept=".json,application/json"
            aria-label="迁移前原始备份文件"
            onChange={handleRestoreLegacyFile}
            disabled={legacyBusy || editingDisabled}
          />
        </div>
      </details>

      {errors.length > 0 ? (
        <div className="project-list__errors" role="alert">
          {errors.map((error, index) => (
            <div key={`${error.message}-${index}`} className="project-list__error">
              <p>{uiDiagnosticText(error.message)}</p>
              {error.reasons.map((reason, reasonIndex) => (
                <p
                  key={`${reason}-${reasonIndex}`}
                  className="project-list__reason"
                >
                  {uiDiagnosticText(reason)}
                </p>
              ))}
            </div>
          ))}
          {listError !== null ? (
            <div className="project-list__error-next">
              <p>
                发生了什么：无法打开本地数据库，项目列表与草稿状态可能没有读取成功。
              </p>
              <p>
                接下来：点“重试”重新打开本地数据库；如果仍然失败，请检查浏览器存储权限。
              </p>
              <button
                type="button"
                onClick={handleRetryLoad}
                disabled={retryingLoad}
              >
                {retryingLoad ? '重试中…' : '重试'}
              </button>
            </div>
          ) : null}
          {importError !== null ? (
            <p className="project-list__error-next">
              发生了什么：本次导入未成功，未写入任何数据。
              接下来：请按上面的原因修正文件后重新导入；如果是本地存储问题，
              请检查浏览器存储后再试。现有项目不会被覆盖或删除。
            </p>
          ) : null}
          {backupError !== null ? (
            <p className="project-list__error-next">
              发生了什么：本次完整备份操作未完成；恢复失败时数据库未写入任何数据。
              接下来：请按上面的原因检查 ZIP 文件或先确认目标数据库为空，再重试。
              现有项目不会被部分覆盖。
            </p>
          ) : null}
        </div>
      ) : null}

      {notice !== null ? (
        <p className="project-list__notice" role="status">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="project-list__loading" role="status">
          正在加载项目…
        </p>
      ) : activeProjects.length === 0 ? (
        <div className="project-list__empty">
          <p>还没有项目。点击“新建”开始，打开内置演示案例，或导入一个 JSON 项目文件。</p>
        </div>
      ) : (
        <ul className="project-list__items" aria-label="项目列表">
          {activeProjects.map((project) => {
            const status = projectStatus(project, drafts.get(project.id) ?? null)
            return (
              <li
                key={project.id}
                className="project-list__item"
                data-testid={`project-${project.id}`}
              >
                <div className="project-list__main">
                  <a
                    className="project-list__name"
                    href={workspaceHash(project.id)}
                    onClick={(event) => {
                      event.preventDefault()
                      openProject(project.id)
                    }}
                  >
                    {project.name}
                  </a>
                  <p className="project-list__updated">
                    更新时间：
                    <time dateTime={project.updatedAt}>
                      {formatUpdatedAt(project.updatedAt)}
                    </time>
                  </p>
                </div>

                <span
                  className={`project-list__status project-list__status--${status.tone}`}
                  data-testid={`project-status-${project.id}`}
                >
                  {status.label}
                </span>

                <div className="project-list__actions">
                  <button
                    type="button"
                    onClick={() => openProject(project.id)}
                    disabled={busy}
                  >
                    打开
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(project)}
                    disabled={busy || editingDisabled}
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    className="project-list__delete"
                    onClick={() => setPendingDelete(project)}
                    disabled={busy || editingDisabled}
                  >
                    删除
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {pendingDelete !== null ? (
        <ConfirmDialog
          title="删除项目？"
          message={`项目「${pendingDelete.name}」将被永久删除，该项目的工作方案、草稿和基线都会移除，操作不能撤销。`}
          confirmLabel="确认删除"
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}

      {pendingRestore !== null ? (
        <ConfirmDialog
          title="从完整备份恢复？"
          message={
            <>
              <p>
                文件「{pendingRestore.fileName}」包含{' '}
                {pendingRestore.inspection.counts.projects} 个项目、{' '}
                {pendingRestore.inspection.counts.revisions} 个来源版本、{' '}
                {pendingRestore.inspection.counts.snapshots} 份分析快照。
              </p>
              <p>
                恢复只允许写入空数据库；如果当前已有任何项目或历史记录，会整体拒绝。
                恢复会保留数值、来源文件哈希、绑定坐标、历史与草稿，但会清除人工确认
                （关系确认、来源数值核对与历史来源接受），需要重新核对。
              </p>
              <p>
                完整备份不包含全局映射模板，恢复后需要重新建立或导入模板。
              </p>
            </>
          }
          confirmLabel="确认恢复到空库"
          onConfirm={handleConfirmRestore}
          onCancel={() => setPendingRestore(null)}
        />
      ) : null}

      {tableImportOpen ? (
        <ImportWizard
          onClose={() => setTableImportOpen(false)}
          onImported={handleTableImported}
        />
      ) : null}
    </main>
  )
}
