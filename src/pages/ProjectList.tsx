import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { calculateChain } from '../domain/calculate'
import type { Project } from '../domain/types'
import { validateChain } from '../domain/validation'
import {
  createEmptyProject,
  deleteProject,
  exportProjectJson,
  importProject,
  listProjects,
  updateProject,
  type StorageError,
} from '../storage/projects'
import './ProjectList.css'

export interface ProjectListProps {
  /** 进入工作台；未提供时使用 location.hash 路由。 */
  onOpenProject?: (projectId: string) => void
}

interface UiError {
  message: string
  reasons: string[]
}

const STATUS_LABEL = {
  within: '满足',
  outside: '不满足',
  'no-target': '未设置目标',
} as const

type StatusTone = 'done' | 'pending' | 'invalid' | 'outside'

interface ProjectStatus {
  label: string
  tone: StatusTone
}

function workspaceHash(projectId: string): string {
  return `#/projects/${encodeURIComponent(projectId)}`
}

/**
 * 项目列表中的“当前计算状态”只读取领域层结果。
 * 空项目还没有有效尺寸链，单独标为“未完成”；1 项等非法链标为“输入有误”。
 */
function projectStatus(project: Project): ProjectStatus {
  if (project.working.terms.length === 0) {
    return { label: '未完成', tone: 'pending' }
  }

  const validation = validateChain(project.working)
  if (!validation.ok) {
    return { label: '输入有误', tone: 'invalid' }
  }

  try {
    const result = calculateChain(project.working)
    return {
      label: STATUS_LABEL[result.status],
      tone: result.status === 'within' ? 'done' : result.status === 'outside' ? 'outside' : 'pending',
    }
  } catch {
    return { label: '计算失败', tone: 'invalid' }
  }
}

function formatUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt)
  return Number.isNaN(date.getTime()) ? updatedAt : date.toLocaleString('zh-CN')
}

function toUiError(error: StorageError): UiError {
  const reasons = error.details
    .map((detail) => detail.message)
    .filter((message) => message.trim() !== '')
  return {
    message: error.message,
    reasons: reasons.length > 0 ? reasons : [error.message],
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

/**
 * 项目首页。
 *
 * 列表只显示项目元数据和领域层算出的当前状态；新建、复制、删除都把持久化
 * 交给 storage/projects.ts。导入被拒时只展示原因，不修改列表里的已有项目。
 */
export function ProjectList({ onOpenProject }: ProjectListProps = {}) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [listError, setListError] = useState<UiError | null>(null)
  const [actionError, setActionError] = useState<UiError | null>(null)
  const [importError, setImportError] = useState<UiError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    const listed = await listProjects()
    if (!listed.ok) {
      setListError(toUiError(listed.error))
      return false
    }
    setProjects(listed.value)
    setListError(null)
    return true
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const listed = await listProjects()
      if (cancelled) {
        return
      }
      if (!listed.ok) {
        setListError(toUiError(listed.error))
        setLoading(false)
        return
      }
      setProjects(listed.value)
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

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setActionError(null)
    setImportError(null)
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

  const errors = [listError, actionError, importError].filter(
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
          disabled={busy}
        >
          新建
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
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
          disabled={busy}
        />
      </div>

      {errors.length > 0 ? (
        <div className="project-list__errors" role="alert">
          {errors.map((error, index) => (
            <div key={`${error.message}-${index}`} className="project-list__error">
              <p>{error.message}</p>
              {error.reasons.map((reason, reasonIndex) => (
                <p
                  key={`${reason}-${reasonIndex}`}
                  className="project-list__reason"
                >
                  {reason}
                </p>
              ))}
            </div>
          ))}
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
      ) : projects.length === 0 ? (
        <div className="project-list__empty">
          <p>还没有项目。点击“新建”开始，或导入一个 JSON 项目文件。</p>
        </div>
      ) : (
        <ul className="project-list__items" aria-label="项目列表">
          {projects.map((project) => {
            const status = projectStatus(project)
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
                    disabled={busy}
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    className="project-list__delete"
                    onClick={() => setPendingDelete(project)}
                    disabled={busy}
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
    </main>
  )
}
