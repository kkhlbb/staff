import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError } from './contracts.mjs'

const defaultAssemblyKernelModules = [
  fileURLToPath(new URL('../../src/core/geometry/assemblyGeometry.mjs', import.meta.url)),
  fileURLToPath(new URL('../../src/core/solver/assemblySolver.mjs', import.meta.url)),
]

export function hasAssemblyKernel(modules = defaultAssemblyKernelModules) {
  return modules.every(file => existsSync(file))
}

function number(value, fallback) {
  const parsed = Number(value ?? fallback)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2 ** 31 - 1) throw Error('Invalid numeric configuration')
  return parsed
}

function endpoint(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error('Expected an HTTPS endpoint')
  return url
}

export function configFrom(env = process.env, options = {}) {
  const principals = env.CUNLIAN_KEYS
    ? JSON.parse(env.CUNLIAN_KEYS)
    : env.CUNLIAN_API_KEY ? [{ name: 'operator', key: env.CUNLIAN_API_KEY, write: true, takeover: true }] : []
  if (!Array.isArray(principals) || !principals.length || principals.some(value =>
    !/^[a-zA-Z][\w-]{0,63}$/.test(value.name) || typeof value.key !== 'string' || !/^[^\s,]{16,}$/.test(value.key)
    || (value.tools && (!Array.isArray(value.tools) || value.tools.some(tool => typeof tool !== 'string'))))
    || new Set(principals.map(value => value.key)).size !== principals.length
    || new Set(principals.map(value => value.name)).size !== principals.length) throw Error('Invalid CUNLIAN_KEYS')
  if (env.CUNLIAN_APPROVAL_SECRET && (env.CUNLIAN_APPROVAL_SECRET.length < 16
    || principals.some(principal => principal.key === env.CUNLIAN_APPROVAL_SECRET))) throw Error('Invalid approval secret')
  const webhooks = new Set((env.CUNLIAN_WEBHOOK_URLS ?? '').split(',').filter(Boolean).map(value => endpoint(value).href))
  if (webhooks.size && (env.CUNLIAN_WEBHOOK_SECRET?.length ?? 0) < 16) throw Error('Webhook signing secret required')
  const models = new Set((env.CUNLIAN_MODEL_URLS ?? '').split(',').filter(Boolean).map(value => {
    const url = endpoint(value)
    if (url.search) throw Error('Model base URLs must not contain query parameters')
    return url.href.replace(/\/$/, '')
  }))
  const feature3dAssemblyM1 = env.FEATURE_3D_ASSEMBLY_M1 === 'true' || env.FEATURE_3D_ASSEMBLY_M1 === '1'
  const kernelAvailable = options.assemblyKernelAvailable ?? hasAssemblyKernel()
  if (feature3dAssemblyM1 && !kernelAvailable) {
    throw Error('FEATURE_3D_ASSEMBLY_M1 requires the Track B assembly kernel')
  }
  return {
    host: env.HOST ?? '127.0.0.1', port: number(env.PORT, 8787),
    root: resolve(env.CUNLIAN_DATA ?? './data'), web: resolve(env.CUNLIAN_WEB ?? './cloud/deploy/web'),
    maxUpload: number(env.CUNLIAN_MAX_UPLOAD, 16 * 1024 * 1024),
    timeoutMs: number(env.CUNLIAN_TIMEOUT_MS, 30000), leaseMs: number(env.CUNLIAN_LEASE_MS, 900000),
    confirmationMs: number(env.CUNLIAN_CONFIRMATION_MS, 120000), approvalSecret: env.CUNLIAN_APPROVAL_SECRET,
    webhookSecret: env.CUNLIAN_WEBHOOK_SECRET,
    origin: env.CUNLIAN_PUBLIC_ORIGIN ? endpoint(env.CUNLIAN_PUBLIC_ORIGIN).origin : null,
    proxies: new Set((env.CUNLIAN_TRUSTED_PROXIES ?? '').split(',').filter(Boolean)),
    principals, models, feature3dAssemblyM1,
    webhookUrl(value) {
      let url
      try { url = endpoint(value) } catch { throw new HttpError(422, 'WEBHOOK_URL_FORBIDDEN') }
      if (!webhooks.has(url.href)) throw new HttpError(422, 'WEBHOOK_URL_FORBIDDEN')
      return url
    },
  }
}
