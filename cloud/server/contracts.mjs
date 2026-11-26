import openapi from '../contracts/openapi.json' with { type: 'json' }
import catalog from '../contracts/mcp-tools.json' with { type: 'json' }

export const tools = catalog.tools
export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message)
    Object.assign(this, { status, code })
  }
}

export function matches(value, schema, root = schema) {
  if (schema.$ref) {
    const base = schema.$ref.startsWith('./')
      ? catalog
      : schema.$ref.startsWith('#/$defs/')
        ? root
        : openapi
    const target = schema.$ref.split('/').slice(1).reduce((node, key) => node[key], base)
    return matches(value, target, root)
  }
  if (schema.const !== undefined && value !== schema.const) return false
  if (schema.enum && !schema.enum.includes(value)) return false
  if (schema.anyOf && !schema.anyOf.some(item => matches(value, item, root))) return false
  if (schema.oneOf && schema.oneOf.filter(item => matches(value, item, root)).length !== 1) return false
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
      const keys = Object.keys(value)
      if (keys.length < (schema.minProperties ?? 0)) return false
      if (schema.propertyNames && !keys.every(key => matches(key, schema.propertyNames, root))) return false
      return (schema.required ?? []).every(key => Object.hasOwn(value, key))
        && Object.entries(value).every(([key, child]) => {
          if (Object.hasOwn(schema.properties ?? {}, key)) return matches(child, schema.properties[key], root)
          return schema.additionalProperties !== false
            && (typeof schema.additionalProperties !== 'object' || matches(child, schema.additionalProperties, root))
        })
    }
    case 'array':
      return Array.isArray(value) && value.length >= (schema.minItems ?? 0)
        && value.length <= (schema.maxItems ?? Infinity) && value.every((item, index) => {
          const child = schema.prefixItems?.[index] ?? schema.items ?? {}
          return child !== false && (child === true || matches(item, child, root))
        })
    case 'string':
      if (schema.format === 'binary') return Buffer.isBuffer(value)
      return typeof value === 'string' && value.length >= (schema.minLength ?? 0)
        && value.length <= (schema.maxLength ?? Infinity) && (!schema.pattern || new RegExp(schema.pattern).test(value))
    case 'integer':
      if (!Number.isSafeInteger(value)) return false
      // falls through
    case 'number':
      return Number.isFinite(value)
        && value >= (schema.minimum ?? -Infinity)
        && value <= (schema.maximum ?? Infinity)
        && (schema.exclusiveMinimum === undefined || value > schema.exclusiveMinimum)
        && (schema.exclusiveMaximum === undefined || value < schema.exclusiveMaximum)
    case 'null': return value === null
    case 'boolean': return typeof value === 'boolean'
    default: return true
  }
}

export function validate(value, schema) {
  if (!matches(value, schema)) throw new HttpError(400, 'INVALID_REQUEST', 'Input does not match the contract')
  return value
}

export const routes = Object.entries(openapi.paths).flatMap(([path, methods]) => {
  const keys = [...path.matchAll(/\{(\w+)\}/g)].map(match => match[1])
  const pattern = new RegExp('^' + path.replace(/\{\w+\}/g, '([^/]+)') + '$')
  return Object.entries(methods).map(([method, operation]) => ({ path, method, operation, pattern, keys }))
})
