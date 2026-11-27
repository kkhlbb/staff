/** Separate archive authentication from historical Git evidence. Never fall back on Git errors. */
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { legacyCaptures } from './evidence-json'

export const manifestSha256 = '9ad682ea06f29fd933461968e4a818c9e18317460b7b40894085b04a663a7582'
export const privacyManifestPath = 'release/source-privacy-manifest.json'
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
interface DisplayEdit { offset: number; length: number; originalFragmentSha256: string; replacement: string }
interface Mapping { originalSha256: string; publishedSha256: string; rule: string; edits: DisplayEdit[] }
interface Manifest { schemaVersion: number; baselineCommit: string; frozenHistoryCommit: string; files: Record<string, Mapping> }
export function verifyManifest(bytes: Uint8Array): Manifest {
  if (sha256(bytes) !== manifestSha256) throw new Error('privacy manifest authentication failed')
  return JSON.parse(Buffer.from(bytes).toString()) as Manifest
}
export const sourcePrivacyManifest = verifyManifest(readFileSync(privacyManifestPath))
export function evidenceMode(root = '.'): 'git-original' | 'published-archive' {
  if (existsSync(join(root, '.git'))) return 'git-original'
  let top: string
  try { top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return 'published-archive' }
  return realpathSync(top) === realpathSync(root) ? 'git-original' : 'published-archive'
}
export function deriveDisplayFile(file: string, bytes: Buffer): Buffer {
  const row = sourcePrivacyManifest.files[file]
  if (!row || sha256(bytes) !== row.originalSha256) throw new Error(`original authentication failed: ${file}`)
  if (row.rule === 'previously-reviewed-historical-image-display-derivative') throw new Error('supply the separately authenticated public image')
  let result = bytes
  for (const edit of [...row.edits].reverse()) {
    if (sha256(bytes.subarray(edit.offset, edit.offset + edit.length)) !== edit.originalFragmentSha256 || edit.replacement !== 'fixture-user') throw new Error(`display edit authentication failed: ${file}`)
    result = Buffer.concat([result.subarray(0, edit.offset), Buffer.from(edit.replacement), result.subarray(edit.offset + edit.length)])
  }
  if (sha256(result) !== row.publishedSha256) throw new Error(`derived authentication failed: ${file}`)
  return result
}
export function verifyPublishedFile(root: string, file: string): Buffer {
  const row = sourcePrivacyManifest.files[file]
  if (!row) throw new Error(`unapproved published file: ${file}`)
  const bytes = readFileSync(resolve(root, file))
  if (sha256(bytes) !== row.publishedSha256) throw new Error(`published authentication failed: ${file}`)
  return bytes
}
export function verifyEvidenceTree(root = '.'): void {
  // Authenticate on every call, including a changed/deleted manifest after import.
  verifyManifest(readFileSync(join(root, privacyManifestPath)))
  const mode = evidenceMode(root)
  for (const [file, row] of Object.entries(sourcePrivacyManifest.files)) {
    if (mode === 'published-archive') verifyPublishedFile(root, file)
    else {
      const original = readFileSync(join(root, file))
      if (sha256(original) !== row.originalSha256) throw new Error(`Git original changed: ${file}`)
      const baseline = execFileSync('git', ['show', `${sourcePrivacyManifest.baselineCommit}:${file}`], { cwd: root, maxBuffer: original.length + 1024 })
      if (sha256(baseline) !== row.originalSha256) throw new Error(`Git baseline changed: ${file}`)
      if (row.rule !== 'previously-reviewed-historical-image-display-derivative') deriveDisplayFile(file, original)
    }
  }
}
export function frozenEvidence(file: string, root = '.'): Buffer {
  const expected = legacyCaptures[file as keyof typeof legacyCaptures]
  if (!expected || sourcePrivacyManifest.files[file]?.originalSha256 !== expected) throw new Error(`unapproved frozen evidence: ${file}`)
  if (evidenceMode(root) === 'published-archive') return verifyPublishedFile(root, file)
  const bytes = readFileSync(join(root, file))
  const history = execFileSync('git', ['show', `9fe22fd:${file}`], { cwd: root })
  if (sha256(bytes) !== expected || sha256(history) !== expected) throw new Error(`frozen Git SHA256: ${file}`)
  return bytes
}
