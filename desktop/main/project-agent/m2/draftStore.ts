import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { M2PreviewSnapshot } from '../../../shared/project-agent/m2-preview'
import { fingerprint } from './engine.mjs'

const correction = z.object({
  targetId: z.string(),
  mode: z.enum(['answer', 'correct_interpretation']),
  content: z.string(),
})
const inputs = z.object({
  order: z.number().int().positive(),
  rightHoleOffsetQ: z.number().int(),
  corrections: z.array(correction),
})
export type M2DraftInputs = z.infer<typeof inputs>

const formalVersion = z.object({
  revision: z.string(), draftRevision: z.string(), createdAt: z.string(),
  checkSetFingerprint: z.string(), artifactHashes: z.object({ model: z.string(), drawing: z.string() }),
  model: z.unknown(), clauses: z.unknown(), solverRules: z.unknown(),
  preview: z.custom<M2PreviewSnapshot>(value => !!value && typeof value === 'object' && 'projectId' in value),
})
const journal = z.object({
  schema: z.literal(1), sourceKey: z.string(), inputs,
  history: z.array(inputs).default([]),
  versions: z.array(formalVersion).default([]),
  receipts: z.array(z.object({
    operation: z.enum(['commit', 'undo', 'change', 'clarification']),
    requestId: z.string(), digest: z.string(), value: z.unknown(),
    confirmationHash: z.string().optional(),
  })).default([]),
})
export type M2Journal = z.infer<typeof journal>

export function openM2DraftStore(root: string, projectId: string, bindingPath: string) {
  const file = path.join(root, fingerprint([projectId, bindingPath]) + '.json')
  function read() {
    try {
      return journal.parse(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new Error('DRAFT_READ_FAILED', { cause: error })
    }
  }
  return {
    read,
    transact<T>(run: (previous: M2Journal | undefined) => { next?: M2Journal; value: T }, seal: () => void) {
      seal()
      const { next, value } = run(read())
      if (!next) return value
      const temporary = file + '.' + randomUUID() + '.tmp'
      mkdirSync(root, { recursive: true, mode: 0o700 })
      try {
        const fd = openSync(temporary, 'wx', 0o600)
        try {
          writeFileSync(fd, JSON.stringify(next))
          fsyncSync(fd)
        } finally {
          closeSync(fd)
        }
        seal()
        renameSync(temporary, file)
      } finally {
        rmSync(temporary, { force: true })
      }
      return value
    },
  }
}
