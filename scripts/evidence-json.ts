/** Evidence-only serialization. Never pass normalized values back to the product. */
export const evidenceFiles = [
  'docs/evidence/V3-B1/b1-electron-report.json',
  'docs/evidence/V3-B2/fix-refit/before-report.json',
  'docs/evidence/V3-B2/fix-refit/after-report.json',
  'docs/evidence/V3.6/1110-extraction.json',
  'docs/evidence/V3.6/stage2-e2e.json',
  'docs/evidence/V3.6/ambiguous-e2e.json',
] as const

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
    if (generatedKey.test(key) || /^(startedAt|finishedAt|generatedAt)$/u.test(key)) {
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

export function serializeEvidence(value: unknown): string {
  const normalized = normalize(value) as Record<string, unknown>
  return `${JSON.stringify({
    ...normalized,
    generatedValueKind: '<generated> denotes an automatically generated identifier or run-time timestamp; not product data',
    generatedAtKind: 'run-time',
  }, null, 2)}\n`
}

/** Guard raw JSON, not its normalized form, so a producer regression cannot be hidden. */
export function evidenceViolations(text: string): string[] {
  const violations: string[] = []
  if (/\/var\/folders|\/Users\/|\/tmp\//u.test(text)) violations.push('absolute path')
  if (new RegExp(uuid.source, 'iu').test(text)) violations.push('unmarked UUID')
  const visit = (value: unknown, key = '') => {
    if (typeof value === 'string' && generatedKey.test(key) && value !== '<generated>') {
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
