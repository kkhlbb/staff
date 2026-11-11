// @vitest-environment node
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { evidenceFiles, evidenceViolations, serializeEvidence } from '../../scripts/evidence-json'

describe('scoped evidence reproducibility guard', () => {
  it.each(evidenceFiles)('%s contains no machine paths or unmarked generated IDs', (file) => {
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
    expect(serializeEvidence(capture('/var/folders/first', '12345678-1234-1234-1234-123456789abc', '2026-01-01T00:00:00Z')))
      .toBe(serializeEvidence(capture('/tmp/second', 'abcdef12-abcd-abcd-abcd-abcdef123456', '2026-11-10T23:59:59Z')))
  })

  it.each(evidenceFiles)('%s preserves every historical number, boolean, null, array and key', (file) => {
    const original = JSON.parse(execFileSync('git', ['show', `9fe22fd:${file}`], { encoding: 'utf8' }))
    const actual = JSON.parse(readFileSync(file, 'utf8'))
    const compare = (before: unknown, after: unknown) => {
      if (Array.isArray(before)) {
        expect(Array.isArray(after)).toBe(true)
        expect((after as unknown[]).length).toBe(before.length)
        before.forEach((value, index) => compare(value, (after as unknown[])[index]))
      } else if (before !== null && typeof before === 'object') {
        for (const [key, value] of Object.entries(before)) {
          expect(after).toHaveProperty(key)
          compare(value, (after as Record<string, unknown>)[key])
        }
      } else if (typeof before !== 'string') expect(after).toEqual(before)
      else if (before.startsWith('[') || before.startsWith('{')) {
        let parsed: unknown
        try { parsed = JSON.parse(before) } catch { return }
        compare(parsed, JSON.parse(after as string))
      } else if (/^[a-f0-9]{64}$/u.test(before)) expect(after).toBe(before)
    }
    compare(original, actual)
  })
})
