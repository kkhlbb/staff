// Retain each observed Embind wrapper until delete, so GC cannot hide missed disposal.
export function observeNativeHandles(kernel) {
  const live = new Map()
  const types = new Map()
  let created = 0
  let deleted = 0

  function observe(value) {
    if (value == null || typeof value.delete !== 'function' || live.has(value)) return value
    const dispose = value.delete
    live.set(value, value.constructor.name)
    created++
    value[Symbol.dispose] = value.delete = function () {
      dispose.call(this)
      if (live.delete(this)) deleted++
    }
    for (let proto = Object.getPrototypeOf(value); proto; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (Object.hasOwn(value, name)) continue
        const method = Object.getOwnPropertyDescriptor(proto, name)?.value
        if (name === 'constructor' || typeof method !== 'function') continue
        value[name] = function (...args) { return observe(method.apply(this, args)) }
      }
    }
    return value
  }

  const oc = new Proxy(kernel, {
    get(target, name) {
      const value = target[name]
      if (typeof value !== 'function' || typeof value.prototype?.delete !== 'function') return value
      if (!types.has(value)) types.set(value, new Proxy(value, {
        construct: (type, args) => observe(Reflect.construct(type, args)),
        get(type, member) {
          const method = type[member]
          return member !== 'prototype' && typeof method === 'function'
            ? (...args) => observe(method.apply(type, args))
            : method
        },
      }))
      return types.get(value)
    },
  })
  return { oc, stats: () => ({ created, deleted, live: [...live.values()] }) }
}
