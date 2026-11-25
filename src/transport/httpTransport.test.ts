import { describe, expect, it, vi } from 'vitest'
import { createHttpTransport, type HttpCommitDraftRequest } from './httpTransport'
import type { CommitDraftResult, TransportCapabilities } from './types'

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  })
}

describe('HttpTransport', () => {
  it('capabilities() 发送鉴权头并透传 FEATURE_3D_ASSEMBLY_M1', async () => {
    const caps: TransportCapabilities = {
      attachments: ['pdf', 'stl', 'step'],
      drawingFormats: ['svg', 'dxf-r12', 'dxf-2000'],
      writerLeases: true,
      modelConnection: true,
      FEATURE_3D_ASSEMBLY_M1: true,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ok: true, value: caps }),
    )

    const transport = createHttpTransport({
      baseUrl: 'https://cloud.cunlian.test///',
      apiKey: 'sk-cloud-secret',
      fetchImpl: fetchMock,
    })

    const res = await transport.capabilities()
    expect(res).toEqual({ ok: true, value: caps })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://cloud.cunlian.test/api/v1/capabilities')
    expect(init?.method).toBe('GET')
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-cloud-secret')
    expect(headers['X-API-Key']).toBe('sk-cloud-secret')
  })

  it('authScheme 支持单独发送 Bearer 或 X-API-Key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({ ok: true, value: { projects: [] } }))

    const bearerOnly = createHttpTransport({
      baseUrl: 'https://cloud.cunlian.test',
      apiKey: 'token-1',
      authScheme: 'bearer',
      fetchImpl: fetchMock,
    })
    await bearerOnly.listProjects()
    const h1 = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(h1.Authorization).toBe('Bearer token-1')
    expect(h1['X-API-Key']).toBeUndefined()

    const keyOnly = createHttpTransport({
      baseUrl: 'https://cloud.cunlian.test',
      apiKey: 'token-2',
      authScheme: 'api-key',
      fetchImpl: fetchMock,
    })
    await keyOnly.listProjects()
    const h2 = fetchMock.mock.calls[1][1]?.headers as Record<string, string>
    expect(h2.Authorization).toBeUndefined()
    expect(h2['X-API-Key']).toBe('token-2')
  })

  it('commitDraft 正确映射 checksetFingerprint、webhook 与可选租约头', async () => {
    const committed: CommitDraftResult = {
      projectId: 'proj/01',
      committedRevision: 'rev-2',
      previousBaseRevision: 'rev-1',
      committedDraftRevision: 'draft-3',
      checksetFingerprint: 'csfp-abc12345',
      summary: '人工确认提交完成',
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ok: true, value: committed }, 201),
    )

    const transport = createHttpTransport({
      baseUrl: 'https://cloud.cunlian.test',
      apiKey: 'key-commit',
      fetchImpl: fetchMock,
    })

    const req: HttpCommitDraftRequest = {
      projectId: 'proj/01',
      baseRevision: 'rev-1',
      draftRevision: 'draft-3',
      checksetFingerprint: 'csfp-abc12345',
      confirmationToken: 'human-confirm-1',
      requestId: 'req-001',
      webhook: { url: 'https://agentarts.huawei.test/callback' },
      leaseToken: 'lease-xyz',
      writerEpoch: 7,
    }

    const res = await transport.commitDraft(req)
    expect(res).toEqual({ ok: true, value: committed })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://cloud.cunlian.test/api/v1/projects/proj%2F01/drafts/draft-3/commit')
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string>
    expect(headers['X-Lease-Token']).toBe('lease-xyz')
    expect(headers['X-Writer-Epoch']).toBe('7')
    expect(JSON.parse(String(init?.body))).toEqual({
      projectId: 'proj/01',
      baseRevision: 'rev-1',
      draftRevision: 'draft-3',
      checksetFingerprint: 'csfp-abc12345',
      confirmationToken: 'human-confirm-1',
      requestId: 'req-001',
      webhook: { url: 'https://agentarts.huawei.test/callback' },
    })
  })

  it('409 租约/指纹冲突保留服务端结构化错误码与详情', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          error: {
            code: 'FINGERPRINT_MISMATCH',
            message: '检查集指纹已过期，请刷新最新草稿',
            detail: 'expected=csfp-old actual=csfp-new',
          },
        },
        409,
      ),
    )

    const transport = createHttpTransport({
      baseUrl: 'https://cloud.cunlian.test',
      fetchImpl: fetchMock,
    })

    const res = await transport.commitDraft({
      projectId: 'p1',
      baseRevision: 'r1',
      draftRevision: 'd2',
      checksetFingerprint: 'csfp-old',
      confirmationToken: 'tok-1',
      requestId: 'req-409',
    })

    expect(res).toEqual({
      ok: false,
      error: {
        code: 'FINGERPRINT_MISMATCH',
        message: '检查集指纹已过期，请刷新最新草稿',
        detail: 'expected=csfp-old actual=csfp-new',
      },
    })
  })

  it('非标准 HTTP 错误（401 / 404 / 500）与畸形 JSON 统一归一化为 M2Result 错误', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }))
      .mockResolvedValueOnce(new Response('not found', { status: 404, statusText: 'Not Found' }))
      .mockResolvedValueOnce(new Response('boom', { status: 502, statusText: 'Bad Gateway' }))
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ unexpected: true }, 200))

    const transport = createHttpTransport({
      baseUrl: 'https://cloud.cunlian.test',
      fetchImpl: fetchMock,
    })

    const r401 = await transport.getProject({ projectId: 'p1' })
    expect(r401.ok).toBe(false)
    if (!r401.ok) expect(r401.error.code).toBe('UNAUTHORIZED')

    const r404 = await transport.getProject({ projectId: 'p1' })
    expect(r404.ok).toBe(false)
    if (!r404.ok) expect(r404.error.code).toBe('NOT_FOUND')

    const r502 = await transport.getProject({ projectId: 'p1' })
    expect(r502.ok).toBe(false)
    if (!r502.ok) expect(r502.error.code).toBe('SERVER_ERROR')

    const rBadJson = await transport.getProject({ projectId: 'p1' })
    expect(rBadJson.ok).toBe(false)
    if (!rBadJson.ok) expect(rBadJson.error.code).toBe('MALFORMED_RESPONSE')

    const rBadEnv = await transport.getProject({ projectId: 'p1' })
    expect(rBadEnv.ok).toBe(false)
    if (!rBadEnv.ok) expect(rBadEnv.error.code).toBe('MALFORMED_RESPONSE')
  })

  it('超时与网络异常归一化为 REQUEST_TIMEOUT / NETWORK_ERROR', async () => {
    const hangingFetch: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })

    const timeoutTransport = createHttpTransport({
      baseUrl: 'https://cloud.cunlian.test',
      timeoutMs: 20,
      fetchImpl: hangingFetch,
    })

    const timeoutRes = await timeoutTransport.capabilities()
    expect(timeoutRes.ok).toBe(false)
    if (!timeoutRes.ok) {
      expect(timeoutRes.error.code).toBe('REQUEST_TIMEOUT')
    }

    const failingFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
    const netTransport = createHttpTransport({
      baseUrl: 'https://cloud.cunlian.test',
      fetchImpl: failingFetch,
    })

    const netRes = await netTransport.capabilities()
    expect(netRes.ok).toBe(false)
    if (!netRes.ok) {
      expect(netRes.error.code).toBe('NETWORK_ERROR')
      expect(netRes.error.detail).toContain('Failed to fetch')
    }
  })

  it('二进制上传/下载与图纸 X-Drawing-Fingerprint 路由映射正确', async () => {
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(svgBytes, {
          status: 200,
          headers: {
            'Content-Type': 'image/svg+xml',
            'X-Drawing-Fingerprint': 'drw-fp-99',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(svgBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: true,
            value: {
              projectId: 'p-imp',
              name: 'Imported',
              baseRevision: 'rev-1',
              draftRevision: null,
            },
          },
          201,
        ),
      )

    const transport = createHttpTransport({
      baseUrl: 'https://cloud.cunlian.test',
      fetchImpl: fetchMock,
    })

    const drawing = await transport.getDrawing({
      projectId: 'p1',
      draftRevision: 'd1',
      format: 'svg',
    })
    expect(drawing.ok).toBe(true)
    if (drawing.ok) {
      expect(drawing.value.fingerprint).toBe('drw-fp-99')
      expect(new TextDecoder().decode(drawing.value.bytes)).toContain('<svg')
    }

    const missingFp = await transport.getDrawing({
      projectId: 'p1',
      draftRevision: 'd1',
      format: 'svg',
    })
    expect(missingFp.ok).toBe(false)
    if (!missingFp.ok) {
      expect(missingFp.error.code).toBe('MALFORMED_RESPONSE')
    }

    const imported = await transport.importProject({
      kind: 'pdf',
      fileName: 'taskbook.pdf',
      bytes: new Uint8Array([1, 2, 3, 4]),
    })
    expect(imported.ok).toBe(true)
    const [impUrl, impInit] = fetchMock.mock.calls[2]
    expect(impUrl).toBe('https://cloud.cunlian.test/api/v1/projects/import')
    expect(impInit?.body).toBeInstanceOf(FormData)
  })

  it('租约、事件、审核、提交状态与模型连接路由参数映射准确', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const u = String(url)
      if (u.endsWith('/healthz')) {
        return jsonResponse({ status: 'ok' })
      }
      if (u.includes('/writer')) {
        return jsonResponse({
          ok: true,
          value: { writerEpoch: 2, baseRevision: 'r1', draftRevision: 'd2' },
        })
      }
      if (u.includes('/events')) {
        return jsonResponse({
          ok: true,
          value: { events: [], nextCursor: 5, highWatermark: 5 },
        })
      }
      if (u.includes('/commit')) {
        return jsonResponse({ ok: true, value: { state: 'awaiting-confirmation' } })
      }
      return jsonResponse({ ok: true, value: {} })
    })

    const transport = createHttpTransport({
      baseUrl: 'https://cloud.cunlian.test',
      fetchImpl: fetchMock,
    })

    expect(await transport.health()).toEqual({ ok: true, value: { status: 'ok' } })
    expect(
      await transport.acquireWriter({ projectId: 'p1', expectedWriterEpoch: 1 }),
    ).toEqual({
      ok: true,
      value: { writerEpoch: 2, baseRevision: 'r1', draftRevision: 'd2' },
    })
    await transport.takeOverWriter({ projectId: 'p1', expectedWriterEpoch: 2 })
    await transport.readProjectEvents({ projectId: 'p1', afterSequence: 5, limit: 20 })
    await transport.getCommitStatus({ projectId: 'p1', draftRevision: 'd2' })
    await transport.getConnectionStatus({ projectId: 'p1', scopeEpoch: 3 })

    const urls = fetchMock.mock.calls.map(([u]) => String(u))
    expect(urls).toEqual([
      'https://cloud.cunlian.test/healthz',
      'https://cloud.cunlian.test/api/v1/projects/p1/writer',
      'https://cloud.cunlian.test/api/v1/projects/p1/writer/takeover',
      'https://cloud.cunlian.test/api/v1/projects/p1/events?afterSequence=5&limit=20',
      'https://cloud.cunlian.test/api/v1/projects/p1/drafts/d2/commit',
      'https://cloud.cunlian.test/api/v1/projects/p1/connection?scopeEpoch=3',
    ])
  })
})
