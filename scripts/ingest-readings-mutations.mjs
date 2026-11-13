import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
const out = 'docs/evidence/ingest-readings/mutations'
await mkdir(out, { recursive: true })
const targets = [
  { id: 'M46', file: 'src/document-extraction/batch.ts',
    from: "if (hasAgentRead(candidate)) {", to: "if (false && hasAgentRead(candidate)) {" },
  { id: 'M47', file: 'src/document-extraction/ingestReadings.ts', from: 'provenance: [ref]',
    to: "provenance: [{ kind: 'pdf-text', documentId: draft.sourceIdentity.documentId, revisionId: draft.sourceIdentity.revisionId, sha256: draft.sourceIdentity.sha256, blobKey: draft.sourceIdentity.blobKey, page: 1, rectPdf: [0, 0, 1, 1], pageBoxPdf: [0, 0, 100, 100], textSnippet: input.statement, normalizedSnippet: input.statement, textItemIndexes: [] }]" },
  { id: 'M48', file: 'src/document-extraction/ingestReadings.ts', from: 'requiresVerification: true,', to: '' },
]
const run = () => spawnSync('./node_modules/.bin/vitest', ['run', 'src/document-extraction/__tests__/ingestReadings.test.ts'], { encoding: 'utf8' })
for (const mutation of targets) {
  const original = await readFile(mutation.file, 'utf8')
  assert(original.includes(mutation.from), `${mutation.id} target missing`)
  const changed = original.replaceAll(mutation.from, mutation.to)
  await writeFile(`${out}/${mutation.id}.patch`, `--- ${mutation.file}\n+++ ${mutation.file}\n-${mutation.from}\n+${mutation.to}\n`)
  try {
    await writeFile(mutation.file, changed)
    const red = run()
    await writeFile(`${out}/${mutation.id}-red.log`, `${red.stdout}${red.stderr}\nEXIT_CODE=${red.status}\n`)
    assert(red.status !== null && red.status !== 0, `${mutation.id} survived`)
    assert(`${red.stdout}${red.stderr}`.includes('AssertionError'), `${mutation.id} must be killed by assertion, not build error`)
  } finally { await writeFile(mutation.file, original) }
  const green = run()
  await writeFile(`${out}/${mutation.id}-green.log`, `${green.stdout}${green.stderr}\nEXIT_CODE=${green.status}\n`)
  assert.equal(green.status, 0)
  console.log(`${mutation.id}: red nonzero assertion / restored green 0`)
}
