export class ShapeCache {
  #entries = new Map()
  #limit
  #ownership

  constructor(limit = 8, ownership = plateOwnership) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid shape cache capacity')
    this.#limit = limit
    this.#ownership = ownership
  }

  // The builder transfers ownership to the cache. Callers borrow the result.
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
    return [...this.#entries.values()].reduce((total, entry) => total + this.#ownership.count(entry.shapes), 0)
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
    this.#ownership.dispose(entry.shapes)
  }
}

const plateOwnership = {
  count: () => 2,
  dispose(shapes) {
    try {
      shapes.cover.delete()
    } finally {
      shapes.plate.delete()
    }
  },
}
