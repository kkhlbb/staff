/** Evidence-only serialization. Never pass normalized values back to the product. */
// 历史采集，保留机器路径原样，不再重生成。Frozen at 9fe22fd.
export const legacyCaptures = {
  'docs/evidence/V3-B1/b1-electron-report.json': 'f78e74e7b35262d8194b69bbbf658713a90deaa405e9d41fa0d97eb9f86b34ec',
  'docs/evidence/V3-B2/fix-refit/before-report.json': 'b01254c138af7a880886895bf9f4437f6a078b8db102c0c23fae4f6a8eb77b9d',
  'docs/evidence/V3-B2/fix-refit/after-report.json': '02ab85749734aee7b042ea30150d6ddd315deb437d6abf8791415d7cdd0cb493',
  'docs/evidence/V3.6/1110-extraction.json': '04e42e8e608a17085847594385b782f5c273df906fc94ad002ec243e3d9c2555',
  'docs/evidence/V3.6/stage2-e2e.json': 'ab67e61d2c91e699374bc092f1358659932cba8044391a538402281e4e6cf8d5',
  'docs/evidence/V3.6/ambiguous-e2e.json': '82757be1965eb9b1fc5af8f953fb998f03322f6d6ebf921bda7b3c09aa332dbf',
} as const
export const evidenceFiles = Object.keys(legacyCaptures)

const uuid = /(?:rev-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu
const absolutePath = /(?:file:\/\/)?\/(?:Users\/|var\/folders\/|tmp\/)[^\s"'<>\\]*/gu
const generatedKey = /^(?:draftId|sessionId|requestId)$/u

function portablePath(value: string): string {
  const localFile = value.startsWith('file://')
  const relative = value.match(/\/(docs|src|out)\/.*$/u)?.[0].slice(1)
  const file = relative ?? value.split('/').at(-1) ?? value
  return localFile ? `file:${file}` : file
}

function normalize(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (generatedKey.test(key)) {
      return '<generated>'
    }
    // Several legacy probes store JSON inside a detail string: normalize it as data,
    // not by dropping the entire detail (which contains numerical assertions).
    if ((value.startsWith('[') || value.startsWith('{'))) {
      try {
        return JSON.stringify(normalize(JSON.parse(value)))
      } catch { /* Not a JSON-encoded probe; keep its text. */ }
    }
    return value.replace(absolutePath, portablePath).replace(uuid, '<generated>')
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, normalize(item, name)]))
  }
  return value
}

const runTimeKey = /^(startedAt|finishedAt|generatedAt)$/u

/** Visit JSON-encoded probes too; only the declared time keys are blanked. */
function mapRunTimes(value: unknown, fields: Set<string>, blank: boolean, key = ''): unknown {
  if (!blank && runTimeKey.test(key)) fields.add(key)
  if (blank && fields.has(key)) return ''
  if (Array.isArray(value)) return value.map((item) => mapRunTimes(item, fields, blank))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) =>
      [name, mapRunTimes(item, fields, blank, name)]))
  }
  if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
    try { return JSON.stringify(mapRunTimes(JSON.parse(value), fields, blank)) } catch { /* Plain text. */ }
  }
  return value
}

/** Comparison copy only: never write this text over the evidence artifact. */
export function evidenceComparisonBytes(text: string): string {
  const data = JSON.parse(text) as Record<string, unknown>
  const fields = data.runTimeFields
  if (!Array.isArray(fields) || fields.some((field) => typeof field !== 'string' || !runTimeKey.test(field))) {
    throw new Error('invalid runTimeFields')
  }
  return `${JSON.stringify(mapRunTimes(data, new Set(fields as string[]), true), null, 2)}\n`
}

export function serializeEvidence(value: unknown): string {
  const normalized = normalize(value) as Record<string, unknown>
  const fields = new Set<string>()
  mapRunTimes(normalized, fields, false)
  return `${JSON.stringify({
    ...normalized,
    generatedValueKind: '<generated> denotes an automatically generated identifier; not product data',
    generatedAtKind: 'run-time',
    runTimeFields: [...fields].sort(),
  }, null, 2)}\n`
}

/** Guard raw JSON, not its normalized form, so a producer regression cannot be hidden. */
export function evidenceViolations(text: string): string[] {
  const violations: string[] = []
  if (/\/var\/folders|\/Users\/|\/tmp\//u.test(text)) violations.push('absolute path')
  if (new RegExp(uuid.source, 'iu').test(text)) violations.push('unmarked UUID')
  const visit = (value: unknown, key = '') => {
    // parse.ts derives draft-<16 hex> with stableId(idempotencyKey), not a random UUID.
    const stableDraft = key === 'draftId' && typeof value === 'string' && /^draft-[a-f0-9]{16}$/u.test(value)
    if (typeof value === 'string' && generatedKey.test(key) && value !== '<generated>' && !stableDraft) {
      violations.push(`unmarked generated ${key}`)
    }
    if (Array.isArray(value)) value.forEach((item) => visit(item))
    else if (value !== null && typeof value === 'object') {
      Object.entries(value).forEach(([name, item]) => visit(item, name))
    } else if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
      try { visit(JSON.parse(value)) } catch { /* Plain text probe. */ }
    }
  }
  const data: unknown = JSON.parse(text)
  visit(data)
  if (text.includes('<generated>') && !(data as Record<string, unknown>).generatedValueKind) {
    violations.push('missing generatedValueKind')
  }
  return violations
}
