export const A40_CASES = ['A40-01', 'A40-02', 'A40-02b', 'A40-03', 'A40-04', 'A40-05', 'A40-06', 'A40-07', 'A40-07b', 'A40-07c-1', 'A40-07c-2', 'A40-07d', 'A40-08', 'A40-09']
export const INTENT_CASES = ['D1', 'D2', 'D3', 'D3b']
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.trim().length > 0
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
export function recordStatus(record) {
  if (!object(record) || !text(record.item) || !(text(record.taskState) || (record.taskState === null && record.modelCalls === 0)) ||
      !(record.taskErrorCode === null || text(record.taskErrorCode)) ||
      !Number.isFinite(record.durationMs) || record.durationMs < 0 ||
      !Number.isInteger(record.modelCalls) || record.modelCalls < 0 ||
      !Array.isArray(record.assertions) || record.assertions.length === 0 ||
      record.assertions.some(a => !object(a) || !text(a.name) || typeof a.ok !== 'boolean') ||
      (record.outcome !== undefined && !['PASS', 'FAIL'].includes(record.outcome))) return 'INVALID'
  return record.outcome === 'FAIL' || record.assertions.some(a => !a.ok) ? 'FAIL' : 'PASS'
}
export function recordsStatus(data, expected) {
  if (!object(data) || !Array.isArray(data.records) || !Array.isArray(expected) || expected.length === 0) return { status: 'INVALID', reason: 'records and expected cases are required', records: [] }
  const records = data.records
  if (records.length === 0) return { status: 'NOT_RUN', reason: 'no case executed', records }
  const actual = new Set(records.map(r => r?.item))
  const missing = expected.filter(item => !actual.has(item))
  const unexpected = [...actual].filter(item => !expected.includes(item))
  const states = records.map(recordStatus)
  const status = missing.length || unexpected.length || states.includes('INVALID') ? 'INVALID' : states.includes('FAIL') ? 'FAIL' : 'PASS'
  return { status, missing, unexpected, records }
}
export function validateArtifact(data, kind) {
  if (kind === 'a40') return recordsStatus(data, A40_CASES)
  if (!object(data)) return { status: 'INVALID' }
  if (kind === 'export') {
    if (data.schema !== 'v40stage4-export-artifact' || !text(data.source) || !text(data.artifact) ||
        !hash(data.sourceSha256) || !hash(data.sha256) || !hash(data.receiptSha256) ||
        !Number.isSafeInteger(data.byteSize) || data.byteSize <= 0 ||
        typeof data.receiptMatchesDisk !== 'boolean' || typeof data.renderValid !== 'boolean') return { status: 'INVALID' }
    return { status: data.receiptMatchesDisk && data.renderValid && data.sha256 === data.receiptSha256 ? 'PASS' : 'FAIL' }
  }
  if (kind === 'e2e') {
    if (!Array.isArray(data.checks)) return { status: 'INVALID' }
    if (data.checks.length === 0) return { status: 'NOT_RUN' }
    const expected = ['provider-configured', 'provider-test', 'preview-12.04', 'commit', 'over-limit-blocked', 'export-dialog', 'clarification', 'reopen-recap']
    if (typeof data.passed !== 'boolean' || !Array.isArray(data.blocked) ||
        data.checks.some(c => !object(c) || !text(c.id) || typeof c.ok !== 'boolean') ||
        expected.some(id => !data.checks.some(c => c.id === id))) return { status: 'INVALID' }
    return { status: data.passed && data.blocked.length === 0 && data.checks.every(c => c.ok) ? 'PASS' : 'FAIL' }
  }
  return { status: 'INVALID', reason: 'unknown evidence kind' }
}

// Missing/unparseable evidence is a failed guard, not an empty violations array.
export async function inspectEvidence(file, kind, read, violations, secret = '') {
  let raw
  try { raw = await read(file, 'utf8') } catch (error) {
    return { file, status: 'NOT_RUN', missing: true, violations: [], keyLeak: false, reason: error.code ?? 'READ_FAILED' }
  }
  let data
  try { data = JSON.parse(raw) } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return { file, status: 'INVALID', violations: ['invalid JSON syntax'], keyLeak: secret !== '' && raw.includes(secret) }
  }
  return { file, ...validateArtifact(data, kind), violations: violations(raw), keyLeak: secret !== '' && raw.includes(secret) }
}
