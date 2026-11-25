import type {
  M1StageChangeRequest,
  M1StageResult,
  M1WriterContext,
} from '../../desktop/main/project-agent/m1StageContracts'
import type {
  M1Activity,
  M1ContextFields,
  M1EventPageFields,
} from '../../desktop/shared/project-agent/m1-fields'
import type { M2ModelMeshInput, M2Result } from '../../desktop/shared/project-agent/m2-preview'
import type { ProjectFileAttachmentRef } from '../project-file/types'
import {
  FEATURE_3D_ASSEMBLY_M1,
  type AttachmentUpload,
  type CheckSet,
  type CommitDraftRequest,
  type CommitDraftResult,
  type CreateProjectRequest,
  type DraftRef,
  type DrawingRequest,
  type GeometryRequest,
  type ImportProjectRequest,
  type PreloadTransport,
  type ProjectRef,
  type ProjectSummary,
  type SimulationRequest,
  type SimulationResult,
  type Transport,
  type TransportCapabilities,
  type WriterRequest,
  type WriterState,
} from './types'

export type HttpTransportAuthScheme = 'bearer' | 'api-key' | 'both'

export interface HttpTransportOptions {
  /** Base URL of the cloud engine server (e.g. `https://api.example.com` or `''` for same-origin). */
  readonly baseUrl: string
  /** Optional API key sent via `Authorization: Bearer` and/or `X-API-Key`. */
  readonly apiKey?: string
  /** Auth header mode when `apiKey` is provided. Defaults to `'both'`. */
  readonly authScheme?: HttpTransportAuthScheme
  /** Optional custom `fetch` implementation for tests or non-browser runtimes. */
  readonly fetchImpl?: typeof fetch
  /** Per-request timeout in milliseconds enforced via `AbortController`. Defaults to `30000`. */
  readonly timeoutMs?: number
  /** Optional lease token attached as `X-Lease-Token` on write/commit calls when provided. */
  readonly leaseToken?: string
  /** Optional writer epoch attached as `X-Writer-Epoch` on write/commit calls when provided. */
  readonly writerEpoch?: number
  /** Optional extra static headers merged into every request. */
  readonly headers?: Readonly<Record<string, string>>
}

/** Optional extra fields callers may pass alongside frozen `CommitDraftRequest`. */
export interface HttpCommitDraftRequest extends CommitDraftRequest {
  readonly leaseToken?: string
  readonly writerEpoch?: number
}

export interface HttpTransport extends Transport {
  readonly kind: 'http'
  readonly baseUrl: string
  health(): Promise<M2Result<{ status: 'ok' }>>
}

interface ErrorEnvelope {
  readonly ok: false
  readonly error: {
    readonly code: string
    readonly message: string
    readonly detail?: string
  }
}

interface SuccessEnvelope<T> {
  readonly ok: true
  readonly value: T
}

const DEFAULT_TIMEOUT_MS = 30_000

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseErrorEnvelope(body: unknown): ErrorEnvelope['error'] | null {
  if (!isRecord(body) || body.ok !== false || !isRecord(body.error)) {
    return null
  }
  const code = typeof body.error.code === 'string' && body.error.code.trim() ? body.error.code : null
  const message =
    typeof body.error.message === 'string' && body.error.message.trim() ? body.error.message : null
  if (!code || !message) {
    return null
  }
  const detail = typeof body.error.detail === 'string' ? body.error.detail : undefined
  return detail !== undefined ? { code, message, detail } : { code, message }
}

function defaultErrorCodeForStatus(status: number): string {
  if (status === 400) return 'INVALID_REQUEST'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 422) return 'UNPROCESSABLE_ENTITY'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'SERVER_ERROR'
  return 'HTTP_ERROR'
}

function defaultMessageForStatus(status: number, statusText: string): string {
  if (status === 401) return '鉴权失败，请检查 API Key 或登录凭据'
  if (status === 403) return '无权访问目标资源'
  if (status === 404) return '请求的资源不存在'
  if (status === 409) return '修订版本、写入租约或检查集指纹冲突'
  if (status === 422) return '确认凭据无效或必需检查项未通过'
  if (status >= 500) return `服务端内部错误（HTTP ${status}）`
  return statusText ? `HTTP ${status} ${statusText}` : `HTTP ${status}`
}

function buildAuthHeaders(
  apiKey: string | undefined,
  scheme: HttpTransportAuthScheme,
  staticHeaders: Readonly<Record<string, string>> | undefined,
  extraHeaders?: Readonly<Record<string, string>>,
): Record<string, string> {
  const headers: Record<string, string> = {}
  if (staticHeaders) {
    for (const [k, v] of Object.entries(staticHeaders)) {
      headers[k] = v
    }
  }
  const trimmedKey = apiKey?.trim() ?? ''
  if (trimmedKey) {
    if (scheme === 'bearer' || scheme === 'both') {
      headers.Authorization = `Bearer ${trimmedKey}`
    }
    if (scheme === 'api-key' || scheme === 'both') {
      headers['X-API-Key'] = trimmedKey
    }
  }
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers[k] = v
    }
  }
  return headers
}

function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function buildMultipartForm(kind: string, fileName: string, bytes: Uint8Array): FormData {
  const form = new FormData()
  form.set('kind', kind)
  form.set('fileName', fileName)
  const blob = new Blob([toBlobPart(bytes)], { type: 'application/octet-stream' })
  form.set('file', blob, fileName)
  return form
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true
  if (err instanceof Error && err.name === 'AbortError') return true
  return false
}

export function createHttpTransport(options: HttpTransportOptions): HttpTransport {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const apiKey = options.apiKey
  const authScheme: HttpTransportAuthScheme = options.authScheme ?? 'both'
  const timeoutMs =
    typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS
  const fetchFn: typeof fetch | undefined = options.fetchImpl ?? globalThis.fetch

  async function executeFetch(
    path: string,
    init: {
      readonly method: 'GET' | 'POST' | 'DELETE'
      readonly body?: BodyInit
      readonly headers?: Readonly<Record<string, string>>
      readonly accept?: string
    },
  ): Promise<M2Result<Response>> {
    if (typeof fetchFn !== 'function') {
      return {
        ok: false,
        error: {
          code: 'NETWORK_ERROR',
          message: '当前运行环境缺少 fetch 实现',
        },
      }
    }

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    const headers = buildAuthHeaders(apiKey, authScheme, options.headers, {
      ...(init.accept ? { Accept: init.accept } : {}),
      ...(init.headers ?? {}),
    })

    const url = `${baseUrl}${path}`

    try {
      const response = await fetchFn(url, {
        method: init.method,
        headers,
        body: init.body,
        signal: controller.signal,
      })
      return { ok: true, value: response }
    } catch (err) {
      if (timedOut || isAbortError(err)) {
        return {
          ok: false,
          error: {
            code: 'REQUEST_TIMEOUT',
            message: `请求超时（>${timeoutMs} ms）`,
            detail: `${init.method} ${path}`,
          },
        }
      }
      const detail = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        error: {
          code: 'NETWORK_ERROR',
          message: '网络请求失败，无法连接云端服务',
          detail,
        },
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function parseHttpError(response: Response): Promise<M2Result<never>> {
    let rawText: string
    try {
      rawText = await response.text()
    } catch {
      rawText = ''
    }

    if (rawText.trim()) {
      try {
        const parsed: unknown = JSON.parse(rawText)
        const envelopeError = parseErrorEnvelope(parsed)
        if (envelopeError) {
          return { ok: false, error: envelopeError }
        }
      } catch {
        // Non-JSON error body falls through to status-based normalization
      }
    }

    const code = defaultErrorCodeForStatus(response.status)
    const message = defaultMessageForStatus(response.status, response.statusText)
    const detail = rawText.trim() ? rawText.trim().slice(0, 300) : `HTTP ${response.status}`
    return {
      ok: false,
      error: { code, message, detail },
    }
  }

  async function requestJson<T>(
    path: string,
    init: {
      readonly method: 'GET' | 'POST' | 'DELETE'
      readonly jsonBody?: unknown
      readonly formBody?: FormData
      readonly extraHeaders?: Readonly<Record<string, string>>
      readonly unwrapEnvelope?: boolean
    },
  ): Promise<M2Result<T>> {
    const headers: Record<string, string> = { ...(init.extraHeaders ?? {}) }
    let body: BodyInit | undefined
    if (init.formBody) {
      body = init.formBody
    } else if (init.jsonBody !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(init.jsonBody)
    }

    const fetched = await executeFetch(path, {
      method: init.method,
      headers,
      body,
      accept: 'application/json',
    })
    if (!fetched.ok) return fetched

    const response = fetched.value
    if (!response.ok) {
      return parseHttpError(response)
    }

    let rawText: string
    try {
      rawText = await response.text()
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'MALFORMED_RESPONSE',
          message: '读取响应正文失败',
          detail: err instanceof Error ? err.message : String(err),
        },
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch {
      return {
        ok: false,
        error: {
          code: 'MALFORMED_RESPONSE',
          message: '云端返回了无法解析的 JSON 响应',
          detail: rawText.slice(0, 200),
        },
      }
    }

    if (init.unwrapEnvelope === false) {
      return { ok: true, value: parsed as T }
    }

    const envelopeError = parseErrorEnvelope(parsed)
    if (envelopeError) {
      return { ok: false, error: envelopeError }
    }

    if (!isRecord(parsed) || parsed.ok !== true || !('value' in parsed)) {
      return {
        ok: false,
        error: {
          code: 'MALFORMED_RESPONSE',
          message: '云端响应缺少标准 { ok, value } 信封结构',
          detail: rawText.slice(0, 200),
        },
      }
    }

    return { ok: true, value: (parsed as unknown as SuccessEnvelope<T>).value }
  }

  async function requestBinary(
    path: string,
    accept: string,
  ): Promise<M2Result<{ bytes: Uint8Array; headers: Headers }>> {
    const fetched = await executeFetch(path, {
      method: 'GET',
      accept,
    })
    if (!fetched.ok) return fetched

    const response = fetched.value
    if (!response.ok) {
      return parseHttpError(response)
    }

    try {
      const buffer = await response.arrayBuffer()
      return {
        ok: true,
        value: {
          bytes: new Uint8Array(buffer),
          headers: response.headers,
        },
      }
    } catch (err) {
      return {
        ok: false,
        error: {
          code: 'MALFORMED_RESPONSE',
          message: '读取二进制响应失败',
          detail: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }

  function leaseHeaders(override?: {
    readonly leaseToken?: string
    readonly writerEpoch?: number
  }): Record<string, string> {
    const headers: Record<string, string> = {}
    const token = override?.leaseToken ?? options.leaseToken
    const epoch = override?.writerEpoch ?? options.writerEpoch
    if (token && token.trim()) {
      headers['X-Lease-Token'] = token.trim()
    }
    if (typeof epoch === 'number' && Number.isInteger(epoch) && epoch >= 0) {
      headers['X-Writer-Epoch'] = String(epoch)
    }
    return headers
  }

  const getConnectionStatus: PreloadTransport['getM1ConnectionStatus'] = async (request) => {
    const query = new URLSearchParams({ scopeEpoch: String(request.scopeEpoch) })
    const res = await requestJson<
      Awaited<ReturnType<PreloadTransport['getM1ConnectionStatus']>> extends { ok: true; value: infer V }
        ? V
        : never
    >(`/api/v1/projects/${encodeSegment(request.projectId)}/connection?${query.toString()}`, {
      method: 'GET',
    })
    return res
  }

  const testModelConnection: PreloadTransport['testM1ModelApiConnection'] = async (request) => {
    return requestJson(`/api/v1/model-connection/test`, {
      method: 'POST',
      jsonBody: {
        projectId: request.projectId,
        requestId: request.requestId,
        scopeEpoch: request.scopeEpoch,
        baseUrl: request.baseUrl,
        apiKey: request.apiKey,
        model: request.model,
        contextPreview: request.contextPreview,
      },
    })
  }

  const listModels: PreloadTransport['listM1ModelApiModels'] = async (request) => {
    return requestJson(`/api/v1/model-connection/models`, {
      method: 'POST',
      jsonBody: {
        projectId: request.projectId,
        requestId: request.requestId,
        scopeEpoch: request.scopeEpoch,
        baseUrl: request.baseUrl,
        apiKey: request.apiKey,
      },
    })
  }

  return {
    kind: 'http',
    baseUrl,

    async health(): Promise<M2Result<{ status: 'ok' }>> {
      const res = await requestJson<unknown>('/healthz', {
        method: 'GET',
        unwrapEnvelope: false,
      })
      if (!res.ok) return res
      if (!isRecord(res.value) || res.value.status !== 'ok') {
        return {
          ok: false,
          error: {
            code: 'MALFORMED_RESPONSE',
            message: '健康检查响应异常',
          },
        }
      }
      return { ok: true, value: { status: 'ok' } }
    },

    async capabilities(): Promise<M2Result<TransportCapabilities>> {
      const res = await requestJson<TransportCapabilities>('/api/v1/capabilities', {
        method: 'GET',
      })
      if (!res.ok) return res
      return {
        ok: true,
        value: {
          ...res.value,
          FEATURE_3D_ASSEMBLY_M1:
            typeof res.value.FEATURE_3D_ASSEMBLY_M1 === 'boolean'
              ? res.value.FEATURE_3D_ASSEMBLY_M1
              : FEATURE_3D_ASSEMBLY_M1,
        },
      }
    },

    async listProjects(): Promise<M2Result<{ projects: ProjectSummary[] }>> {
      return requestJson<{ projects: ProjectSummary[] }>('/api/v1/projects', {
        method: 'GET',
      })
    },

    async createProject(request: CreateProjectRequest): Promise<M2Result<ProjectSummary>> {
      return requestJson<ProjectSummary>('/api/v1/projects', {
        method: 'POST',
        jsonBody: {
          name: request.name,
          template: request.template,
        },
      })
    },

    async importProject(request: ImportProjectRequest): Promise<M2Result<ProjectSummary>> {
      return requestJson<ProjectSummary>('/api/v1/projects/import', {
        method: 'POST',
        formBody: buildMultipartForm(request.kind, request.fileName, request.bytes),
      })
    },

    async getProject(request: ProjectRef): Promise<M2Result<ProjectSummary>> {
      return requestJson<ProjectSummary>(`/api/v1/projects/${encodeSegment(request.projectId)}`, {
        method: 'GET',
      })
    },

    async uploadAttachment(request: AttachmentUpload): Promise<M2Result<ProjectFileAttachmentRef>> {
      return requestJson<ProjectFileAttachmentRef>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/attachments`,
        {
          method: 'POST',
          formBody: buildMultipartForm(request.kind, request.fileName, request.bytes),
        },
      )
    },

    async readAttachmentBytes(
      request: ProjectRef & { attachmentId: string },
    ): Promise<M2Result<Uint8Array>> {
      const res = await requestBinary(
        `/api/v1/projects/${encodeSegment(request.projectId)}/attachments/${encodeSegment(request.attachmentId)}`,
        'application/octet-stream',
      )
      if (!res.ok) return res
      return { ok: true, value: res.value.bytes }
    },

    async buildGeometry(
      request: GeometryRequest,
    ): Promise<M2Result<DraftRef & { geometryFingerprint: string }>> {
      return requestJson<DraftRef & { geometryFingerprint: string }>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/drafts/${encodeSegment(request.draftRevision)}/geometry`,
        {
          method: 'POST',
          jsonBody: request.assembly3d !== undefined ? { assembly3d: request.assembly3d } : {},
          extraHeaders: leaseHeaders(),
        },
      )
    },

    async triangulate(request: DraftRef): Promise<M2Result<M2ModelMeshInput>> {
      return requestJson<M2ModelMeshInput>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/drafts/${encodeSegment(request.draftRevision)}/mesh`,
        { method: 'GET' },
      )
    },

    async runChecks(request: DraftRef): Promise<M2Result<CheckSet>> {
      return requestJson<CheckSet>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/drafts/${encodeSegment(request.draftRevision)}/checks`,
        { method: 'POST' },
      )
    },

    async runSimulation(request: SimulationRequest): Promise<M2Result<SimulationResult>> {
      return requestJson<SimulationResult>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/drafts/${encodeSegment(request.draftRevision)}/simulation`,
        {
          method: 'POST',
          jsonBody: {
            chain: request.chain,
            ...(request.monteCarlo ? { monteCarlo: request.monteCarlo } : {}),
          },
        },
      )
    },

    async getDrawing(
      request: DrawingRequest,
    ): Promise<M2Result<{ bytes: Uint8Array; fingerprint: string }>> {
      const accept = request.format === 'svg' ? 'image/svg+xml' : 'application/dxf'
      const res = await requestBinary(
        `/api/v1/projects/${encodeSegment(request.projectId)}/drafts/${encodeSegment(request.draftRevision)}/drawing/${encodeSegment(request.format)}`,
        accept,
      )
      if (!res.ok) return res
      const fingerprint = res.value.headers.get('X-Drawing-Fingerprint')?.trim() ?? ''
      if (!fingerprint) {
        return {
          ok: false,
          error: {
            code: 'MALFORMED_RESPONSE',
            message: '图纸响应缺少必需的 X-Drawing-Fingerprint 头',
          },
        }
      }
      return {
        ok: true,
        value: {
          bytes: res.value.bytes,
          fingerprint,
        },
      }
    },

    async acquireWriter(request: WriterRequest): Promise<M2Result<WriterState>> {
      return requestJson<WriterState>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/writer`,
        {
          method: 'POST',
          jsonBody: { expectedWriterEpoch: request.expectedWriterEpoch },
        },
      )
    },

    async takeOverWriter(request: WriterRequest): Promise<M2Result<WriterState>> {
      return requestJson<WriterState>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/writer/takeover`,
        {
          method: 'POST',
          jsonBody: { expectedWriterEpoch: request.expectedWriterEpoch },
        },
      )
    },

    async revokeWriter(request: ProjectRef): Promise<M2Result<{ revoked: true }>> {
      return requestJson<{ revoked: true }>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/writer`,
        { method: 'DELETE' },
      )
    },

    async readWriterContext(
      request: ProjectRef,
    ): Promise<M2Result<M1WriterContext & { mountingPlateDraftRevision?: string }>> {
      return requestJson<M1WriterContext & { mountingPlateDraftRevision?: string }>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/writer`,
        { method: 'GET' },
      )
    },

    async stageChange(
      request: ProjectRef & { change: M1StageChangeRequest },
    ): Promise<M2Result<M1StageResult>> {
      return requestJson<M1StageResult>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/drafts/changes`,
        {
          method: 'POST',
          jsonBody: { change: request.change },
          extraHeaders: leaseHeaders(),
        },
      )
    },

    async commitDraft(request: HttpCommitDraftRequest): Promise<M2Result<CommitDraftResult>> {
      const legacyCheckSetFingerprint = (
        request as unknown as { readonly checkSetFingerprint?: string }
      ).checkSetFingerprint
      const checksetFingerprint = request.checksetFingerprint || legacyCheckSetFingerprint || ''

      const payload: CommitDraftRequest = {
        projectId: request.projectId,
        baseRevision: request.baseRevision,
        draftRevision: request.draftRevision,
        checksetFingerprint,
        confirmationToken: request.confirmationToken,
        requestId: request.requestId,
        ...(request.webhook ? { webhook: { url: request.webhook.url } } : {}),
      }

      return requestJson<CommitDraftResult>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/drafts/${encodeSegment(request.draftRevision)}/commit`,
        {
          method: 'POST',
          jsonBody: payload,
          extraHeaders: leaseHeaders({
            leaseToken: request.leaseToken,
            writerEpoch: request.writerEpoch,
          }),
        },
      )
    },

    async authorizeProject(
      request: ProjectRef,
    ): Promise<M2Result<ProjectRef & { authorized: true }>> {
      return requestJson<ProjectRef & { authorized: true }>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/authorization`,
        { method: 'POST' },
      )
    },

    async getContext(
      request: ProjectRef,
    ): Promise<M2Result<M1ContextFields & { baseRevision: string }>> {
      return requestJson<M1ContextFields & { baseRevision: string }>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/context`,
        { method: 'GET' },
      )
    },

    async getExternalActivities(
      request: ProjectRef,
    ): Promise<M2Result<{ activities: M1Activity[]; draftRevision: string | null }>> {
      return requestJson<{ activities: M1Activity[]; draftRevision: string | null }>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/external-activities`,
        { method: 'GET' },
      )
    },

    async readProjectEvents(
      request: ProjectRef & { afterSequence?: number; limit?: number },
    ): Promise<M2Result<M1EventPageFields>> {
      const params = new URLSearchParams()
      if (typeof request.afterSequence === 'number') {
        params.set('afterSequence', String(request.afterSequence))
      }
      if (typeof request.limit === 'number') {
        params.set('limit', String(request.limit))
      }
      const qs = params.toString()
      const suffix = qs ? `?${qs}` : ''
      return requestJson<M1EventPageFields>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/events${suffix}`,
        { method: 'GET' },
      )
    },

    async getReview(
      request: DraftRef,
    ): Promise<M2Result<{ review: CheckSet; summary: string; baseRevision: string | null }>> {
      return requestJson<{ review: CheckSet; summary: string; baseRevision: string | null }>(
        `/api/v1/projects/${encodeSegment(request.projectId)}/drafts/${encodeSegment(request.draftRevision)}/review`,
        { method: 'GET' },
      )
    },

    async getCommitStatus(
      request: DraftRef,
    ): Promise<
      M2Result<
        { state: 'awaiting-confirmation' } | { state: 'committed'; result: CommitDraftResult }
      >
    > {
      return requestJson<
        { state: 'awaiting-confirmation' } | { state: 'committed'; result: CommitDraftResult }
      >(
        `/api/v1/projects/${encodeSegment(request.projectId)}/drafts/${encodeSegment(request.draftRevision)}/commit`,
        { method: 'GET' },
      )
    },

    getConnectionStatus,
    testModelConnection,
    listModels,
  }
}
