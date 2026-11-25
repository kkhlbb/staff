import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { HttpError } from './contracts.mjs'

export class VolumeStorageAdapter {
  #pending = new Map()

  constructor(root) {
    this.root = resolve(root)
  }

  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
  }

  path(id) {
    if (!/^[a-z0-9-]{1,120}$/i.test(id)) throw new HttpError(404, 'PROJECT_NOT_FOUND')
    return join(this.root, id + '.json')
  }

  async read(id) {
    try {
      return JSON.parse(await readFile(this.path(id), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') throw new HttpError(404, 'PROJECT_NOT_FOUND')
      throw error
    }
  }

  async ids() {
    return (await readdir(this.root)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5))
  }

  async write(id, state, signal) {
    const target = this.path(id)
    const temp = target + '.' + randomUUID() + '.tmp'
    try {
      const handle = await open(temp, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(state), { signal })
        await handle.sync()
      } finally {
        await handle.close()
      }
      signal?.throwIfAborted()
      await rename(temp, target)
      const directory = await open(this.root, 'r')
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
    } finally {
      await rm(temp, { force: true })
    }
  }

  async transact(id, signal, apply) {
    const previous = this.#pending.get(id) ?? Promise.resolve()
    const current = previous.then(async () => {
      signal?.throwIfAborted()
      const state = await this.read(id)
      const value = await apply(state)
      await this.write(id, state, signal)
      return value
    })
    const tail = current.catch(() => {})
    this.#pending.set(id, tail)
    try {
      return await current
    } finally {
      if (this.#pending.get(id) === tail) this.#pending.delete(id)
    }
  }
}
