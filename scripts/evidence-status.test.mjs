import { test } from 'node:test'
import assert from 'node:assert/strict'
import { A40_CASES, INTENT_CASES, recordStatus, recordsStatus, validateArtifact, inspectEvidence } from './evidence-status.mjs'
const record = item => ({ item, outcome: 'PASS', assertions: [{ name: 'actual check', ok: true }], durationMs: 1, taskState: 'completed', taskErrorCode: null, modelCalls: 1, toolReceipts: [] })
test('empty records are NOT_RUN, never PASS', () => {
  for (const expected of [A40_CASES, INTENT_CASES]) assert.equal(recordsStatus({ records: [] }, expected).status, 'NOT_RUN')
})
test('missing/malformed records and mandatory fields are INVALID', () => {
  assert.equal(recordsStatus({}, A40_CASES).status, 'INVALID')
  assert.equal(recordsStatus({ records: [record(A40_CASES[0])] }, A40_CASES).status, 'INVALID')
  for (const assertions of [undefined, [], [{ ok: true }], [{ name: 'check' }]]) assert.equal(recordStatus({ ...record('x'), assertions }), 'INVALID')
  assert.equal(recordStatus({ outcome: 'PASS' }), 'INVALID')
})
test('PASS requires a complete expected-case set and nonempty true assertions', () => {
  const records = A40_CASES.map(record)
  assert.equal(recordsStatus({ records }, A40_CASES).status, 'PASS')
  assert.equal(recordStatus({ ...record('x'), assertions: [{ name: 'failed', ok: false }] }), 'FAIL')
  assert.equal(recordsStatus({ records: [...records, record('unexpected')] }, A40_CASES).status, 'INVALID')
})
test('non-model records require an explicit null taskState and zero modelCalls', () => {
  assert.equal(recordStatus({ ...record('A40-09'), taskState: null, modelCalls: 0 }), 'PASS')
  assert.equal(recordStatus({ ...record('x'), taskState: null, modelCalls: 1 }), 'INVALID')
  assert.equal(recordStatus({ ...record('x'), taskState: undefined, modelCalls: 0 }), 'INVALID')
})
test('missing, invalid JSON and structurally empty evidence fail closed', async () => {
  const missing = await inspectEvidence('missing.json', 'export', async () => { throw Object.assign(Error('missing'), { code: 'ENOENT' }) }, () => [])
  assert.equal(missing.status, 'NOT_RUN')
  assert.equal(missing.missing, true)
  assert.equal((await inspectEvidence('bad.json', 'export', async () => '{', () => [])).status, 'INVALID')
  assert.equal((await inspectEvidence('empty.json', 'export', async () => '{}', () => [])).status, 'INVALID')
})
test('missing required artifact fields and malformed e2e never pass', () => {
  assert.equal(validateArtifact({}, 'export').status, 'INVALID')
  assert.equal(validateArtifact({ checks: [] }, 'e2e').status, 'NOT_RUN')
  assert.equal(validateArtifact({ checks: [{ id: 'x', ok: true }] }, 'e2e').status, 'INVALID')
  assert.equal(validateArtifact({ checks: [{ id: 'x', ok: false }], passed: false, blocked: [] }, 'e2e').status, 'INVALID')
})
