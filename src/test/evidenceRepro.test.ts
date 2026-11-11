// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { evidenceComparisonBytes, evidenceFiles, legacyCaptures, evidenceViolations, serializeEvidence } from '../../scripts/evidence-json'

function evidenceJsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    return entry.isDirectory() ? evidenceJsonFiles(path) : path.endsWith('.json') ? [path] : []
  }).sort()
}
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const outside = evidenceJsonFiles('docs/evidence').filter((file) => !Object.hasOwn(legacyCaptures, file))

describe('two-stage evidence guard', () => {
  it('runs both stages with explicit coverage (never a silent empty scan)', () => {
    expect(evidenceFiles).toHaveLength(6)
    const all = evidenceJsonFiles('docs/evidence')
    expect(all.length).toBe(evidenceFiles.length + outside.length)
    console.log(`STAGE 1 frozen SHA256 coverage: ${evidenceFiles.length}; STAGE 2 outside JSON coverage: ${outside.length}`)
    if (outside.length === 0) {
      const fallback = '当前无新增证据，生产方序列化由单元测试覆盖'
      expect(outside).toEqual([])
      console.log(fallback)
      expect(evidenceViolations(serializeEvidence({ target: '/Users/test/sample', startedAt: '2026-11-09T12:14:57.887Z' }))).toEqual([])
    } else {
      expect(outside.length).toBeGreaterThan(0)
    }
  })

  it.each(Object.entries(legacyCaptures))('STAGE 1 %s matches frozen SHA256', (file, expected) => {
    expect(sha256(readFileSync(file)), `frozen SHA256: ${file}; explicitly remove the legacy entry and explain why before regenerating`).toBe(expected)
    expect(sha256(execFileSync('git', ['show', `9fe22fd:${file}`])), `freeze source: ${file}`).toBe(expected)
  })

  it.each(outside)('STAGE 2 %s contains no machine paths or unmarked UUIDs', (file) => {
    expect(evidenceViolations(readFileSync(file, 'utf8')), file).toEqual([])
  })

  it.each(['/var/folders/abc/sample.json', '/Users/test/sample.json', '/tmp/sample.json'])('rejects %s even with metadata', (target) => {
    expect(evidenceViolations(JSON.stringify({ target, generatedValueKind: 'generated' }))).toContain('absolute path')
  })

  it('rejects UUIDs in nested and JSON-encoded probe values', () => {
    for (const value of ['rev-12345678-1234-1234-1234-123456789abc', '12345678-1234-1234-1234-123456789abc']) {
      expect(evidenceViolations(JSON.stringify({ detail: JSON.stringify({ value }) }))).toContain('unmarked UUID')
    }
    expect(evidenceViolations('{"sessionId":"random-session"}')).toContain('unmarked generated sessionId')
    expect(evidenceViolations('{"requestId":"random-request"}')).toContain('unmarked generated requestId')
    expect(evidenceViolations('{"draftId":"<generated>"}')).toContain('missing generatedValueKind')
  })

  it('normalizes nested probe strings without losing hashes, bytes, q or structure', () => {
    const source = { target: '/tmp/random/file.cunlian', sha256: 'a'.repeat(64), bytes: 7123,
      structure: { q: 523000, schemaVersion: 8, fields: [1, null, true] },
      detail: JSON.stringify({ sessionId: 'random', requestId: 'random', draftId: 'draft-random',
        href: 'file:///Users/test/project/out/app/index.html', revisionId: 'rev-12345678-1234-1234-1234-123456789abc' }) }
    const text = serializeEvidence(source)
    const result = JSON.parse(text)
    expect(result.sha256).toBe(source.sha256)
    expect(result.bytes).toBe(source.bytes)
    expect(result.structure).toEqual(source.structure)
    expect(result.target).toBe('file.cunlian')
    expect(JSON.parse(result.detail)).toEqual({ sessionId: '<generated>', requestId: '<generated>', draftId: '<generated>',
      href: 'file:out/app/index.html', revisionId: '<generated>' })
    expect(evidenceViolations(text)).toEqual([])
    expect(serializeEvidence(result)).toBe(text)
  })

  it('produces identical bytes from independent paths, UUIDs, sessions and run times', () => {
    const capture = (directory: string, id: string, time: string) => ({
      target: `${directory}/project.cunlian`,
      startedAt: time,
      revisionId: `rev-${id}`,
      sessionId: `session-${id}`,
      requestId: `request-${id}`,
      draftId: `draft-${id}`,
      detail: JSON.stringify({ revisionId: `rev-${id}`, path: `${directory}/sample.pdf`, bytes: 1357 }),
      sha256: 'b'.repeat(64),
      structure: { schemaVersion: 8, q: 523000 },
    })
    const first = serializeEvidence(capture('/var/folders/first', '12345678-1234-1234-1234-123456789abc', '2026-01-01T00:00:00Z'))
    const second = serializeEvidence(capture('/tmp/second', 'abcdef12-abcd-abcd-abcd-abcdef123456', '2026-11-10T23:59:59Z'))
    expect(first).not.toBe(second)
    expect(evidenceComparisonBytes(first)).toBe(evidenceComparisonBytes(second))
  })

  it('preserves and declares real timestamps; blanks only declared fields in comparison copies', () => {
    const source = { startedAt: '2026-11-09T12:14:57.887Z', finishedAt: '2026-11-09T12:15:19.479Z',
      generatedAt: '2026-11-09T12:15:20.000Z', detail: JSON.stringify({ generatedAt: '2026-11-09T12:15:21.000Z', q: 523000 }) }
    const text = serializeEvidence(source)
    const actual = JSON.parse(text)
    expect(actual).toMatchObject(source)
    expect(actual.runTimeFields).toEqual(['finishedAt', 'generatedAt', 'startedAt'])
    expect(evidenceViolations(text)).toEqual([])
    const compared = JSON.parse(evidenceComparisonBytes(text))
    expect(compared).toMatchObject({ startedAt: '', finishedAt: '', generatedAt: '' })
    expect(JSON.parse(compared.detail)).toEqual({ generatedAt: '', q: 523000 })
    expect(evidenceComparisonBytes(text)).not.toBe(evidenceComparisonBytes(serializeEvidence({ ...source, q: 1 })))
    const partiallyDeclared = JSON.stringify({ ...source, runTimeFields: ['startedAt'] })
    expect(JSON.parse(evidenceComparisonBytes(partiallyDeclared)).finishedAt).toBe(source.finishedAt)
    expect(() => evidenceComparisonBytes(JSON.stringify({ runTimeFields: ['q'], q: 523000 }))).toThrow('invalid runTimeFields')
    expect(JSON.parse(text)).toMatchObject(source)
  })

  it.each(evidenceFiles)('%s 的生产方序列化保留每个数值、布尔、null、数组长度与键', (file) => {
    const original = JSON.parse(execFileSync('git', ['show', `9fe22fd:${file}`], { encoding: 'utf8' }))
    const round = JSON.parse(serializeEvidence(original))
    const compare = (before: unknown, after: unknown, path: string) => {
      if (Array.isArray(before)) {
        expect(Array.isArray(after), path).toBe(true)
        expect((after as unknown[]).length, path).toBe(before.length)
        before.forEach((value, index) => compare(value, (after as unknown[])[index], `${path}[${index}]`))
        return
      }
      if (before !== null && typeof before === 'object') {
        for (const [key, value] of Object.entries(before)) {
          expect(after, `${path}/${key}`).toHaveProperty(key)
          compare(value, (after as Record<string, unknown>)[key], `${path}/${key}`)
        }
        return
      }
      if (typeof before === 'number' || typeof before === 'boolean' || before === null) {
        expect(after, path).toEqual(before)
        return
      }
      if (typeof before !== 'string') return
      if (before.startsWith('[') || before.startsWith('{')) {
        try { compare(JSON.parse(before), JSON.parse(after as string), path) } catch { /* 纯文本探针 */ }
        return
      }
      if (/^[a-f0-9]{64}$/u.test(before)) expect(after, path).toBe(before)
    }
    compare(original, round, file)
    expect(evidenceViolations(serializeEvidence(original))).toEqual([])
  })
})
