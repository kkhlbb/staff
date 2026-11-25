import { createHash, randomUUID } from 'node:crypto'
import { promises as fs, realpathSync, statSync } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import path from 'node:path'
import { PROJECT_FILE_MAX_SOURCE_BYTES } from '../../../src/project-file/types.ts'
import { hash, object, text } from '../../shared/project-agent/schema.ts'

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const schema = object({ key: text, projectId: text, fingerprint: hash, fileIdentity: text })
type Record = import('../../shared/project-agent/schema.ts').Infer<typeof schema>
type Version = Omit<Record, 'key'> & { canonical: string }
const fileIdentity = (stat: BigIntStats) =>
  JSON.stringify([String(stat.dev), String(stat.ino), String(stat.birthtimeNs), String(stat.ctimeNs)])
const sameVersion = (a: Record | Version, b: Version) =>
  a.projectId === b.projectId && a.fingerprint === b.fingerprint && a.fileIdentity === b.fileIdentity

// One pointer per canonical path. The journal remains under an independent random key.
export class M1FileBindings {
  private queue: Promise<unknown> = Promise.resolve()
  // Reuse the verified hash only while the kernel reports the same inode and change time.
  private readonly verified = new Map<string, Version>()
  private readonly root: string
  constructor(root: string) { this.root = root }

  async observe(session: { path: string | null; fingerprint: string | null; projectId: string }): Promise<Version> {
    if (!session.path || !session.fingerprint) throw Error('AUTH_REQUIRED')
    const canonical = await fs.realpath(session.path)
    const file = await fs.open(canonical, 'r')
    try {
      const before = await file.stat({ bigint: true })
      if (!before.isFile() || before.size > PROJECT_FILE_MAX_SOURCE_BYTES) throw Error('AUTH_REQUIRED')
      const version = { canonical, projectId: session.projectId, fingerprint: session.fingerprint,
        fileIdentity: fileIdentity(before) }
      const cached = this.verified.get(canonical)
      if (cached && sameVersion(cached, version)) {
        this.assertCurrent(version, session.path)
        return version
      }
      const buffer = Buffer.alloc(Number(before.size))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const after = await fs.stat(canonical, { bigint: true })
      if (bytesRead !== buffer.length || before.size !== after.size || before.ctimeNs !== after.ctimeNs ||
        before.dev !== after.dev || before.ino !== after.ino || before.birthtimeNs !== after.birthtimeNs ||
        digest(buffer) !== session.fingerprint) throw Error('AUTH_REQUIRED')
      this.assertCurrent(version, session.path)
      this.verified.set(canonical, version)
      const oldest = this.verified.keys().next().value
      if (this.verified.size > 32 && oldest !== undefined) this.verified.delete(oldest)
      return version
    } finally {
      await file.close()
    }
  }

  assertCurrent(version: Version, projectPath: string) {
    try {
      if (realpathSync(projectPath) === version.canonical &&
        fileIdentity(statSync(version.canonical, { bigint: true })) === version.fileIdentity) return
    } catch { /* the file or its path is no longer available */ }
    throw Error('AUTH_REQUIRED')
  }

  private pointer(version: Version) { return path.join(this.root, 'file-bindings', digest(version.canonical) + '.json') }
  private async load(version: Version) {
    try {
      const record: unknown = JSON.parse(await fs.readFile(this.pointer(version), 'utf8'))
      if (!schema(record) || !/^[0-9a-f-]{36}$/.test(record.key)) throw Error('SAVE_FAILED')
      return record
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async store(version: Version, key: string) {
    const target = this.pointer(version)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const temp = target + '.' + randomUUID() + '.tmp'
    const data = JSON.stringify({ key, projectId: version.projectId, fingerprint: version.fingerprint, fileIdentity: version.fileIdentity })
    const file = await fs.open(temp, 'wx', 0o600)
    try {
      try {
        await file.writeFile(data)
        await file.sync()
      } finally {
        await file.close()
      }
      if (await fs.readFile(temp, 'utf8') !== data) throw Error('SAVE_FAILED')
      await fs.rename(temp, target)
    } catch (error) {
      await fs.unlink(temp).catch(() => {})
      throw error
    }
  }

  private serial<T>(operation: () => Promise<T>) {
    const next = this.queue.then(operation)
    this.queue = next.catch(() => {})
    return next
  }

  keyFor(version: Version) {
    return this.serial(async () => {
      const record = await this.load(version)
      return record && sameVersion(record, version) ? record.key : null
    })
  }

  confirm(version: Version, current: () => boolean) {
    return this.serial(async () => {
      const observed = await this.observe({ ...version, path: version.canonical })
      if (!current() || !sameVersion(version, observed)) throw Error('AUTH_REQUIRED')
      const record = await this.load(version)
      if (!current()) throw Error('AUTH_REQUIRED')
      if (record && sameVersion(record, version)) return record.key
      const key = randomUUID()
      await this.store(version, key)
      return key
    })
  }

  advance(previous: Version, next: Version) {
    return this.serial(async () => {
      if (previous.canonical !== next.canonical || previous.projectId !== next.projectId) return
      const record = await this.load(previous)
      if (record && sameVersion(record, previous)) await this.store(next, record.key)
    })
  }
}
