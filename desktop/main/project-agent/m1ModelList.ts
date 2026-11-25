import type { M1ModelListRequest, M1ModelListResult } from '../../shared/project-agent/m1-model-api'
import { ModelAdapterError } from '../modelAdapter'
import { OpenAICompatibleAdapter } from '../openaiCompatibleAdapter'

export async function listM1ModelApiModels(
  request: M1ModelListRequest,
  signal: AbortSignal,
  fetchImpl?: typeof fetch,
): Promise<M1ModelListResult> {
  let url: URL
  let decodedUrl: string
  try {
    url = new URL(request.baseUrl)
    decodedUrl = decodeURIComponent(url.href)
  } catch { throw Error('INVALID_REQUEST') }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  const key = request.apiKey.trim()
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
      url.username || url.password || url.href.includes('?') || url.href.includes('#') ||
      (key && (url.href.includes(key) || decodedUrl.includes(key)))) throw Error('INVALID_REQUEST')
  if (!key && !loopback) throw Error('INVALID_API_KEY')
  const adapter = new OpenAICompatibleAdapter({
    settings: { baseUrl: url.href, model: '' },
    getApiKey: async () => key || null,
    fetchImpl,
    signal,
  })
  try {
    const ids = await adapter.listModels({ allowAnonymous: loopback })
    const models = ids.filter(id => !key || (!id.includes(key) && !id.includes(encodeURIComponent(key))))
    return { models, defaultModel: models[0] ?? null }
  } catch (error) {
    // Fetch exceptions can include credential-bearing URLs or redirect locations.
    // eslint-disable-next-line preserve-caught-error
    throw Error(error instanceof ModelAdapterError && error.code === 'AUTH_FAILED' ? 'AUTH_FAILED' : 'DISCONNECTED')
  }
}
