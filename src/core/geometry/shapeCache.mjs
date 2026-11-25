export class ShapeCache {
  #entries = new Map()
  #limit

  constructor(limit = 8) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid shape cache capacity')
    this.#limit = limit
  }

  // build transfers the two owned wrappers to the cache. Callers borrow the returned shapes.
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
    this.#releaseWhere(entry => entry.projectId === projectId && (revision === undefined || entry.revision === revision))
  }

  clear() {
    this.#releaseWhere(() => true)
  }

  #releaseWhere(matches) {
    const errors = []
    for (const [key, entry] of this.#entries) {
      if (!matches(entry)) continue
      try {
        this.#delete(key)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Failed to release cached native shapes')
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
