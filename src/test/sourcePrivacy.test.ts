// @vitest-environment node
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sourcePrivacyManifest, verifyPublishedFile, verifyManifest, evidenceMode, deriveDisplayFile, sha256 } from '../../scripts/source-privacy'

describe('release source independent privacy manifest', () => {
  it('authenticates the complete approved mapping, not a caller-supplied manifest', () => {
    expect(() => verifyManifest(Buffer.from('{}'))).toThrow()
    expect(Object.keys(sourcePrivacyManifest.files).length).toBeGreaterThan(650)
  })
  it('does not treat a broken Git checkout as a release archive', () => {
    const root = mkdtempSync(join(tmpdir(), 'privacy-git-'))
    mkdirSync(join(root, '.git'))
    expect(evidenceMode(root)).toBe('git-original')
  })
  const file = 'docs/evidence/V3-B1/b1-electron-report.json'
  it('accepts only the authenticated published bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'privacy-published-'))
    const original = readFileSync(file)
    // The approved public bytes can be reconstructed from the exact original in Git.
    const row = sourcePrivacyManifest.files[file]
    const bytes = sha256(original) === row.publishedSha256 ? original : deriveDisplayFile(file, original)
    mkdirSync(join(root, 'docs/evidence/V3-B1'), { recursive: true })
    writeFileSync(join(root, file), bytes)
    expect(() => verifyPublishedFile(root, file)).not.toThrow()
    const payload = JSON.parse(bytes.toString())
    const changeNumber = (node: Record<string, unknown>): boolean => {
      for (const key of Object.keys(node)) {
        if (typeof node[key] === 'number') { node[key] = (node[key] as number) + 1; return true }
        if (node[key] !== null && typeof node[key] === 'object' && changeNumber(node[key] as Record<string, unknown>)) return true
      }
      return false
    }
    expect(changeNumber(payload)).toBe(true)
    writeFileSync(join(root, file), JSON.stringify(payload))
    expect(() => verifyPublishedFile(root, file)).toThrow('published authentication failed')
    const missing = JSON.parse(bytes.toString())
    delete missing[Object.keys(missing)[0]]
    writeFileSync(join(root, file), JSON.stringify(missing))
    expect(() => verifyPublishedFile(root, file)).toThrow('published authentication failed')
  })
  it('rejects a missing field even when the rest of the JSON is valid', () => {
    const root = mkdtempSync(join(tmpdir(), 'privacy-field-'))
    mkdirSync(join(root, 'docs/evidence/V3-B1'), { recursive: true })
    writeFileSync(join(root, file), '{}')
    expect(() => verifyPublishedFile(root, file)).toThrow()
  })
  it('rejects a missing historical image, rather than scanning only files that still exist', () => {
    const image = Object.keys(sourcePrivacyManifest.files).find((path) => path.endsWith('.png'))!
    expect(image).toBeTruthy()
    expect(() => verifyPublishedFile(mkdtempSync(join(tmpdir(), 'privacy-image-')), image)).toThrow()
  })
})
