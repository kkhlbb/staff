/**
 * 导入 STL 的会话作用域状态（V3-B2 渲染侧编排）。
 *
 * - 选文件/读字节/解析都由 main 授权 + 共享纯解析器复核；renderer 只做候选
 *   准备与显式确认，不直接上传字节；
 * - 失败（取消/读失败/格式/容量/提交）只记录原因，不改变当前快照与旧几何；
 * - 提交成功后用 main 返回的 acceptedSeq + snapshot 重同步，几何按 revision 缓存；
 * - 关联动作只表示外形资料来源，提示文案明确“不改变尺寸链数值、不自动同步”。
 */
/* eslint-disable react-hooks/set-state-in-effect -- 会话/版本切换必须同步清空派生视图状态，避免旧模型串场 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SnapshotDto } from '../../desktop/shared/contracts'
import { parseStl, type StlGeometry } from '../parts/stlValidation'
import { normalizeViewState, type DemoViewState } from '../parts/shaftDemo'
import type { ModelRenderGeometry } from '../components/ModelViewport'

export interface PendingImport {
  candidateToken: string
  fileName: string
  byteSize: number
  replacePartId: string | null
  expectedCurrentModelRevisionId: string | null
  geometry: StlGeometry
}

export interface ModelError {
  code: string
  message: string
  detail?: string
}

interface LinkMutation {
  operation: 'bind' | 'confirm-new'
  linkId?: string
  termId: string
  target: { granularity: 'model' | 'part'; partId: string; modelRevisionId: string | null }
}

export interface ImportedModelApi {
  sessionId: string | null
  acceptedSeq: number
  snapshot: SnapshotDto | null
  apply: (value: {
    acceptedSeq: number
    snapshot: SnapshotDto
    recovery: 'written' | 'unchanged' | 'pending' | 'failed' | 'none'
    warning?: string
  }) => Promise<void>
}

export interface ImportedModelState {
  partId: string | null
  revisionId: string | null
  geometry: ModelRenderGeometry | null
  loading: boolean
  busy: boolean
  error: ModelError | null
  notice: string
  pending: PendingImport | null
  view: DemoViewState | null
  setView: (value: unknown) => void
  beginImport: (replace: boolean) => Promise<void>
  commitPending: (partName: string, unitNote: string) => Promise<void>
  cancelPending: () => Promise<void>
  bindLink: (input: {
    termId: string
    granularity: 'model' | 'part'
    partId: string
    modelRevisionId: string | null
  }) => Promise<boolean>
  confirmLink: (input: {
    linkId: string
    termId: string
    partId: string
    modelRevisionId: string | null
  }) => Promise<boolean>
  clearError: () => void
}

function geometryFrom(
  revisionId: string,
  fileName: string,
  value: StlGeometry,
): ModelRenderGeometry {
  return {
    revisionId,
    fileName,
    encoding: value.encoding,
    triangleCount: value.triangleCount,
    positions: value.positions,
    normals: value.normals,
    bounds: value.bounds,
  }
}

export function useImportedModel(options: ImportedModelApi): ImportedModelState {
  const { sessionId, acceptedSeq, snapshot, apply } = options
  const [geometry, setGeometry] = useState<ModelRenderGeometry | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ModelError | null>(null)
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [view, setViewState] = useState<DemoViewState | null>(null)
  const sessionRef = useRef<string | null>(sessionId)

  const part = snapshot?.project.parts.find((item) => item.currentModelRevisionId !== null) ?? null
  const partId = part?.partId ?? null
  const revisionId = part?.currentModelRevisionId ?? null
  const currentModelRevisionId = part?.currentModelRevisionId ?? null

  // 会话切换：清空所有模型 UI 状态，避免串场。
  useEffect(() => {
    if (sessionRef.current === sessionId) return
    sessionRef.current = sessionId
    setGeometry(null)
    setPending(null)
    setError(null)
    setNotice('')
    setViewState(null)
  }, [sessionId])

  // 按 revision 读取并解析字节；失败保留旧几何（若有），只报告具体原因。
  useEffect(() => {
    if (sessionId === null || revisionId === null) {
      setGeometry(null)
      setLoading(false)
      return
    }
    if (geometry?.revisionId === revisionId) return
    const api = window.cunlian
    if (!api) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const read = await api.readModel({
        sessionId,
        ref: { kind: 'revision', modelRevisionId: revisionId },
      })
      if (cancelled) return
      if (!read.ok) {
        setError(read.error)
        setLoading(false)
        return
      }
      const parsed = parseStl(read.value.bytes)
      if (cancelled) return
      if (!parsed.ok) {
        setError(parsed.error)
        setLoading(false)
        return
      }
      setGeometry(geometryFrom(revisionId, read.value.fileName, parsed.value))
      setError(null)
      setLoading(false)
    })().catch((reason: unknown) => {
      if (cancelled) return
      setError({ code: 'READ_FAILED', message: reason instanceof Error ? reason.message : String(reason) })
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
    // geometry.revisionId 只用于避免重复读取；不把整个 geometry 作为依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, revisionId])

  const setView = useCallback((value: unknown) => {
    const next = normalizeViewState(value)
    if (next !== null) setViewState(next)
  }, [])

  const release = useCallback(
    async (token: string): Promise<void> => {
      const api = window.cunlian
      if (!api || sessionId === null) return
      await api.releaseModel({ sessionId, candidateToken: token })
    },
    [sessionId],
  )

  const beginImport = useCallback(
    async (replace: boolean) => {
      const api = window.cunlian
      if (!api || sessionId === null) return
      setBusy(true)
      setError(null)
      setNotice('')
      setPending(null)
      try {
        const picked = await api.pickModel({
          sessionId,
          baseEditSeq: acceptedSeq,
          ...(replace && part !== null ? { replacePartId: part.partId } : {}),
        })
        if (!picked.ok) {
          if (picked.error.code !== 'CANCELLED') setError(picked.error)
          return
        }
        const read = await api.readModel({
          sessionId,
          ref: { kind: 'candidate', token: picked.value.candidateToken },
        })
        if (!read.ok) {
          await release(picked.value.candidateToken)
          setError(read.error)
          return
        }
        const parsed = parseStl(read.value.bytes)
        if (!parsed.ok) {
          await release(picked.value.candidateToken)
          setError(parsed.error)
          return
        }
        setPending({
          candidateToken: picked.value.candidateToken,
          fileName: picked.value.fileName,
          byteSize: picked.value.byteSize,
          replacePartId: replace && part !== null ? part.partId : null,
          expectedCurrentModelRevisionId: replace && part !== null ? part.currentModelRevisionId : null,
          geometry: parsed.value,
        })
      } catch (reason) {
        setError({
          code: 'READ_FAILED',
          message: reason instanceof Error ? reason.message : String(reason),
        })
      } finally {
        setBusy(false)
      }
    },
    [acceptedSeq, part, release, sessionId],
  )

  const commitPending = useCallback(
    async (partName: string, unitNote: string) => {
      const api = window.cunlian
      if (!api || sessionId === null || pending === null) return
      setBusy(true)
      setError(null)
      try {
        const committed = await api.commitModel({
          sessionId,
          baseEditSeq: acceptedSeq,
          candidateToken: pending.candidateToken,
          expectedCurrentModelRevisionId: pending.expectedCurrentModelRevisionId,
          partName,
          unitNote,
        })
        if (!committed.ok) {
          await release(pending.candidateToken)
          setPending(null)
          setError(committed.error)
          return
        }
        await apply({
          acceptedSeq: committed.value.acceptedSeq,
          snapshot: committed.value.snapshot,
          recovery: committed.value.recovery,
          ...(committed.value.warning === undefined ? {} : { warning: committed.value.warning }),
        })
        setGeometry(geometryFrom(committed.value.modelRevisionId, pending.fileName, pending.geometry))
        setPending(null)
        setNotice(committed.value.warning ?? '模型已导入；尺寸链数值未改变。')
      } finally {
        setBusy(false)
      }
    },
    [acceptedSeq, apply, pending, release, sessionId],
  )

  const cancelPending = useCallback(async () => {
    if (pending === null) return
    await release(pending.candidateToken)
    setPending(null)
  }, [pending, release])

  const mutateLink = useCallback(
    async (request: LinkMutation): Promise<boolean> => {
      const api = window.cunlian
      if (!api || sessionId === null) return false
      setBusy(true)
      setError(null)
      try {
        const result = await api.linkModel({
          ...request,
          sessionId,
          baseEditSeq: acceptedSeq,
          expectedCurrentModelRevisionId: currentModelRevisionId ?? null,
        })
        if (!result.ok) {
          setError(result.error)
          return false
        }
        await apply({
          acceptedSeq: result.value.acceptedSeq,
          snapshot: result.value.snapshot,
          recovery: result.value.recovery,
          ...(result.value.warning === undefined ? {} : { warning: result.value.warning }),
        })
        setNotice(result.value.warning ?? '关联已记录；尺寸链数值未改变。')
        return true
      } finally {
        setBusy(false)
      }
    },
    [acceptedSeq, apply, currentModelRevisionId, sessionId],
  )

  const bindLink = useCallback(
    async (input: { termId: string; granularity: 'model' | 'part'; partId: string; modelRevisionId: string | null }) =>
      mutateLink({
        operation: 'bind',
        termId: input.termId,
        target: {
          granularity: input.granularity,
          partId: input.partId,
          modelRevisionId: input.modelRevisionId,
        },
      }),
    [mutateLink],
  )

  const confirmLink = useCallback(
    async (input: {
      linkId: string
      termId: string
      partId: string
      modelRevisionId: string | null
    }) =>
      mutateLink({
        operation: 'confirm-new',
        linkId: input.linkId,
        termId: input.termId,
        target: {
          granularity: 'model',
          partId: input.partId,
          modelRevisionId: input.modelRevisionId,
        },
      }),
    [mutateLink],
  )

  return {
    partId,
    revisionId,
    geometry,
    loading,
    busy,
    error,
    notice,
    pending,
    view,
    setView,
    beginImport,
    commitPending,
    cancelPending,
    bindLink,
    confirmLink,
    clearError: () => setError(null),
  }
}
