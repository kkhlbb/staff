import { HttpError } from './contracts.mjs'
import { randomUUID } from 'node:crypto'

export async function modelConnection(config, body, test, signal) {
  const base = body.baseUrl.replace(/\/$/, '')
  if (!config.models.has(base)) throw new HttpError(422, 'MODEL_URL_FORBIDDEN')
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + body.apiKey }
  async function call(path, payload) {
    const response = await fetch(base + path, {
      method: payload ? 'POST' : 'GET', headers, signal, redirect: 'error',
      ...(payload && { body: JSON.stringify(payload) }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new HttpError(502, 'MODEL_UPSTREAM_FAILED')
    }
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 1024 * 1024) throw new HttpError(502, 'MODEL_RESPONSE_TOO_LARGE')
      chunks.push(chunk)
    }
    try { return JSON.parse(Buffer.concat(chunks)) } catch { throw new HttpError(502, 'MODEL_INVALID_RESPONSE') }
  }
  const { data } = await call('/models')
  if (!Array.isArray(data)) throw new HttpError(502, 'MODEL_INVALID_RESPONSE')
  const availableModels = data.map(row => row?.id).filter(id => typeof id === 'string')
  if (!test) return { models: availableModels, defaultModel: availableModels[0] ?? null }
  const name = 'm1_connection_probe'
  const nonce = randomUUID()
  const start = performance.now()
  const messages = [{ role: 'user', content: 'Call m1_connection_probe with nonce ' + nonce + '. Then echo the tool result.' }]
  const tools = [{ type: 'function', function: { name, parameters: {
    type: 'object', properties: { nonce: { type: 'string' } }, required: ['nonce'], additionalProperties: false,
  } } }]
  const answer = (await call('/chat/completions', {
    model: body.model, messages, tools, tool_choice: { type: 'function', function: { name } },
  })).choices?.[0]?.message
  const probe = answer?.tool_calls?.find(tool => tool.function?.name === name)
  let toolRoundTripPassed = false
  if (probe) {
    let parsed
    try { parsed = JSON.parse(probe.function.arguments) } catch { /* malformed tool arguments */ }
    if (parsed?.nonce === nonce) {
      const receipt = randomUUID()
      const returned = await call('/chat/completions', {
        model: body.model, tools, messages: [...messages, answer, { role: 'tool', tool_call_id: probe.id, content: receipt }],
      })
      toolRoundTripPassed = returned.choices?.[0]?.message?.content?.includes(receipt) ?? false
    }
  }
  return { availableModels, selectedModel: body.model, toolCallSupported: Boolean(probe), toolRoundTripPassed,
    toolRoundTripName: name, toolRoundTripLatencyMs: performance.now() - start }
}
