import type { EvidenceRef } from '../../../src/document-extraction/types'
import { evidenceRefKind } from '../../../src/document-extraction/types'
import type { CommitDraftResult } from '../../../src/transport/types'
import type {
  M2CheckItem,
  M2CheckStatus,
  M2DrawingAnnotationItem,
  M2DrawingVector,
  M2ModelMesh,
} from '../../../src/workspace/project-agent/m2WorkbenchBridge'

export interface CheckStatusDisplay {
  readonly icon: string
  readonly label: string
  readonly toneClass: string
  readonly isBlocking: boolean
  readonly isProblem: boolean
}

export function getCheckStatusDisplay(status: M2CheckStatus): CheckStatusDisplay {
  switch (status) {
    case 'pass':
      return {
        icon: '✓',
        label: '通过',
        toneClass: 'pa-tone-pass',
        isBlocking: false,
        isProblem: false,
      }
    case 'fail':
      return {
        icon: '✕',
        label: '不通过',
        toneClass: 'pa-tone-danger',
        isBlocking: true,
        isProblem: true,
      }
    case 'needsClarification':
      return {
        icon: '?',
        label: '待澄清',
        toneClass: 'pa-tone-pending',
        isBlocking: true,
        isProblem: true,
      }
    case 'uncovered':
      return {
        icon: '○',
        label: '未覆盖',
        toneClass: 'pa-tone-muted',
        isBlocking: true,
        isProblem: false,
      }
    case 'executionFailed':
      return {
        icon: '!',
        label: '执行失败',
        toneClass: 'pa-tone-execfail',
        isBlocking: true,
        isProblem: true,
      }
    case 'checking':
      return {
        icon: '…',
        label: '检查中',
        toneClass: 'pa-tone-action',
        isBlocking: true,
        isProblem: false,
      }
  }
}

export interface FormattedEvidenceItem {
  readonly key: string
  readonly badge: string
  readonly sourceLabel: string
  readonly excerpt: string
  readonly meta?: string
}

export function formatEvidenceRef(ref: EvidenceRef, index: number): FormattedEvidenceItem {
  const kind = evidenceRefKind(ref) ?? 'pdf-text'
  if (kind === 'pdf-text') {
    const pdf = ref as Extract<EvidenceRef, { readonly kind?: 'pdf-text' }>
    return {
      key: `pdf-text-${pdf.documentId}-${pdf.page}-${index}`,
      badge: 'PDF 文本',
      sourceLabel: `${pdf.documentId} · 第 ${pdf.page} 页`,
      excerpt: pdf.textSnippet,
      meta: `修订 ${pdf.revisionId}`,
    }
  }
  if (kind === 'pdf-ocr') {
    const ocr = ref as Extract<EvidenceRef, { readonly kind: 'pdf-ocr' }>
    return {
      key: `pdf-ocr-${ocr.documentId}-${ocr.page}-${index}`,
      badge: 'PDF OCR',
      sourceLabel: `${ocr.documentId} · 第 ${ocr.page} 页`,
      excerpt: ocr.textSnippet,
      meta: `置信度 ${Math.round(ocr.confidence * 100)}%`,
    }
  }
  if (kind === 'image-ocr') {
    const img = ref as Extract<EvidenceRef, { readonly kind: 'image-ocr' }>
    return {
      key: `image-ocr-${img.imageId}-${index}`,
      badge: '图片识别',
      sourceLabel: img.fileName,
      excerpt: img.recognizedText,
      meta: `置信度 ${Math.round(img.confidence * 100)}%`,
    }
  }
  if (kind === 'user-attestation') {
    const att = ref as Extract<EvidenceRef, { readonly kind: 'user-attestation' }>
    return {
      key: `user-attestation-${att.actorId}-${att.sessionSeq}-${index}`,
      badge: '人工确认',
      sourceLabel: `${att.actorId} · 第 ${att.sessionSeq} 次输入`,
      excerpt: att.statement,
      meta: att.fieldPath,
    }
  }
  const agent = ref as Extract<EvidenceRef, { readonly kind: 'agent-read' }>
  const srcDesc =
    agent.source.kind === 'pdf-page'
      ? `PDF 第 ${agent.source.page} 页`
      : `草图 ${agent.source.imageId}`
  return {
    key: `agent-read-${agent.turnId}-${index}`,
    badge: 'Agent 读数',
    sourceLabel: `${agent.actorId} · ${srcDesc}`,
    excerpt: agent.statement,
    meta: agent.modelId ?? undefined,
  }
}

export function collectCheckEvidenceItems(
  check: M2CheckItem,
  evidenceByCheckId?: Readonly<Record<string, readonly EvidenceRef[]>>,
): readonly FormattedEvidenceItem[] {
  const items: FormattedEvidenceItem[] = []
  const refs = evidenceByCheckId?.[check.checkId] ?? []
  refs.forEach((ref, idx) => {
    items.push(formatEvidenceRef(ref, idx))
  })
  if (items.length === 0 && check.anchor) {
    items.push({
      key: `anchor-${check.checkId}-${check.anchor.documentRef}-${check.anchor.page}`,
      badge: '任务书锚点',
      sourceLabel: `${check.anchor.documentName} · 第 ${check.anchor.page} 页`,
      excerpt: check.anchor.excerpt,
      meta: check.anchor.documentRef,
    })
  }
  return items
}

export interface WebhookStatusView {
  readonly state: 'delivered' | 'pending' | 'failed' | 'not-configured'
  readonly label: string
  readonly detail?: string
}

export function extractWebhookStatus(
  result: CommitDraftResult,
  requestedWebhookUrl?: string,
): WebhookStatusView {
  const raw = result as CommitDraftResult & {
    readonly webhookStatus?: string
    readonly webhook?: {
      readonly status?: string
      readonly state?: string
      readonly url?: string
      readonly httpStatus?: number
      readonly error?: string
    }
    readonly webhookDelivery?: {
      readonly status?: string
      readonly url?: string
      readonly httpStatus?: number
      readonly error?: string
    }
  }

  const delivery = raw.webhook ?? raw.webhookDelivery
  const statusStr = (delivery?.status ?? delivery?.state ?? raw.webhookStatus ?? '')
    .trim()
    .toLowerCase()

  if (statusStr === 'delivered' || statusStr === 'succeeded' || statusStr === 'sent' || statusStr === 'ok') {
    return {
      state: 'delivered',
      label: 'Webhook 回调已送达',
      detail: delivery?.httpStatus
        ? `HTTP ${delivery.httpStatus}${delivery.url ? ` · ${delivery.url}` : ''}`
        : delivery?.url ?? requestedWebhookUrl,
    }
  }
  if (statusStr === 'failed' || statusStr === 'error') {
    return {
      state: 'failed',
      label: 'Webhook 回调失败',
      detail: delivery?.error ?? (delivery?.httpStatus ? `HTTP ${delivery.httpStatus}` : requestedWebhookUrl),
    }
  }
  if (statusStr === 'pending' || statusStr === 'queued' || statusStr === 'dispatched') {
    return {
      state: 'pending',
      label: 'Webhook 回调已触发（投递中）',
      detail: delivery?.url ?? requestedWebhookUrl,
    }
  }
  if (requestedWebhookUrl && requestedWebhookUrl.trim()) {
    return {
      state: 'pending',
      label: 'Webhook 回调已请求（落盘后异步发送）',
      detail: requestedWebhookUrl.trim(),
    }
  }
  return {
    state: 'not-configured',
    label: '未配置 Webhook 回调',
  }
}

export function isConflictErrorCode(code: string | undefined): boolean {
  if (!code) return false
  const upper = code.toUpperCase()
  return (
    upper === 'CONFLICT' ||
    upper === 'FINGERPRINT_MISMATCH' ||
    upper === 'BASE_REVISION_CONFLICT' ||
    upper === 'WRITER_REVOKED' ||
    upper === 'WRITER_HELD' ||
    upper === 'CONFIRMATION_EXPIRED' ||
    upper === 'STALE_DRAFT' ||
    upper === 'STALE_BASE'
  )
}

/**
 * Derive an interactive `M2DrawingVector` and `M2DrawingAnnotationItem[]` for
 * `M2VectorDrawingViewport` from the draft revision, checks, and optional 3D mesh bounds.
 */
export function buildReviewDrawingModel(params: {
  readonly draftRevision: string
  readonly checks: readonly M2CheckItem[]
  readonly mesh: M2ModelMesh | null
}): {
  readonly drawingVector: M2DrawingVector
  readonly annotations: readonly M2DrawingAnnotationItem[]
} {
  const width = params.mesh
    ? Math.max(40, Math.round(params.mesh.bounds.max[0] - params.mesh.bounds.min[0]))
    : 120
  const height = params.mesh
    ? Math.max(30, Math.round(params.mesh.bounds.max[1] - params.mesh.bounds.min[1]))
    : 80
  const depth = params.mesh
    ? Math.max(12, Math.round(params.mesh.bounds.max[2] - params.mesh.bounds.min[2]))
    : 20

  const annotationMap = new Map<string, M2DrawingAnnotationItem>()
  for (const check of params.checks) {
    for (const annId of check.linkedAnnotationIds) {
      const existing = annotationMap.get(annId)
      if (!existing) {
        annotationMap.set(annId, {
          annotationId: annId,
          label: check.title,
          valueText: check.summary.slice(0, 28),
          view: 'front',
          linkedFeatureIds: [...check.linkedFeatureIds],
          requirementIds: [check.requirementId],
        })
      } else {
        const mergedFeatures = Array.from(
          new Set([...existing.linkedFeatureIds, ...check.linkedFeatureIds]),
        )
        const mergedReqs = Array.from(
          new Set([...(existing.requirementIds ?? []), check.requirementId]),
        )
        annotationMap.set(annId, {
          ...existing,
          linkedFeatureIds: mergedFeatures,
          requirementIds: mergedReqs,
        })
      }
    }
  }

  const annotations = Array.from(annotationMap.values())

  const drawingVector: M2DrawingVector = {
    unit: 'mm',
    revision: params.draftRevision,
    displayDecimals: 2,
    views: [
      {
        id: 'front',
        title: '主视图',
        size: [width, height],
        lines: [
          { x1: 0, y1: 0, x2: width, y2: 0 },
          { x1: width, y1: 0, x2: width, y2: height },
          { x1: width, y1: height, x2: 0, y2: height },
          { x1: 0, y1: height, x2: 0, y2: 0 },
        ],
        circles: [
          { cx: width * 0.28, cy: height * 0.5, r: Math.min(width, height) * 0.08 },
          { cx: width * 0.72, cy: height * 0.5, r: Math.min(width, height) * 0.08 },
        ],
        hiddenLines: [],
      },
      {
        id: 'side',
        title: '侧视图',
        size: [depth, height],
        lines: [
          { x1: 0, y1: 0, x2: depth, y2: 0 },
          { x1: depth, y1: 0, x2: depth, y2: height },
          { x1: depth, y1: height, x2: 0, y2: height },
          { x1: 0, y1: height, x2: 0, y2: 0 },
        ],
        circles: [],
        hiddenLines: [
          { x1: 0, y1: height * 0.42, x2: depth, y2: height * 0.42 },
          { x1: 0, y1: height * 0.58, x2: depth, y2: height * 0.58 },
        ],
      },
    ],
    annotations: annotations.map((ann, idx) => ({
      annotationId: ann.annotationId,
      view: ann.view,
      side: idx % 2 === 0 ? 'below' : 'above',
      lane: Math.floor(idx / 2),
      label: ann.label,
      valueText: ann.valueText,
      witnesses: [
        [width * 0.25, height * 0.5],
        [width * 0.75, height * 0.5],
      ],
      linkedFeatureIds: ann.linkedFeatureIds,
    })),
  }

  return { drawingVector, annotations }
}
