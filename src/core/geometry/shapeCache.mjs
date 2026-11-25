export class ShapeCache {
  #entries = new Map()
  #limit

  constructor(limit = 8) {
    this.#limit = limit
  }

  acquire(projectId, revision, fingerprint, build) {
    const key = JSON.stringify([projectId, revision])
    const previous = this.#entries.get(key)
    if (previous?.fingerprint === fingerprint) {
      this.#entries.delete(key)
      this.#entries.set(key, previous)
      return previous.shapes
    }
    this.#delete(key)
    const shapes = build()
    this.#entries.set(key, { projectId, revision, fingerprint, shapes })
    if (this.#entries.size > this.#limit) this.#delete(this.#entries.keys().next().value)
    return shapes
  }

  get handles() {
    return this.#entries.size * 2
  }

  release(projectId, revision) {
    for (const [key, entry] of this.#entries) {
      if (entry.projectId === projectId && (revision === undefined || entry.revision === revision)) this.#delete(key)
    }
  }

  clear() {
    for (const key of this.#entries.keys()) this.#delete(key)
  }

  #delete(key) {
    const entry = this.#entries.get(key)
    if (!entry) return
    this.#entries.delete(key)
    try {
      entry.shapes.cover.delete()
    } finally {
      entry.shapes.plate.delete()
    }
  }
}
