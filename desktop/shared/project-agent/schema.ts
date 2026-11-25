export type Schema<T> = (value: unknown) => value is T
export type Infer<S> = S extends Schema<infer T> ? T : never

export function object<S extends Record<string, Schema<unknown>>>(shape: S): Schema<{ [K in keyof S]: Infer<S[K]> }> {
  return (value): value is { [K in keyof S]: Infer<S[K]> } => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    const fields = value as Record<string, unknown>
    return Reflect.ownKeys(fields).length === Object.keys(shape).length &&
      Object.entries(shape).every(([key, check]) => Object.hasOwn(fields, key) && check(fields[key]))
  }
}

export function oneOf<const T extends readonly (string | boolean | null)[]>(...choices: T): Schema<T[number]> {
  return (value): value is T[number] => choices.some((choice) => choice === value)
}

export function either<A, B>(left: Schema<A>, right: Schema<B>): Schema<A | B> {
  return (value): value is A | B => left(value) || right(value)
}

export const nullable = <T>(check: Schema<T>) => either(check, oneOf(null))
export const list = <T>(check: Schema<T>): Schema<T[]> =>
  (value): value is T[] => Array.isArray(value) && [...value].every(check)
export const text: Schema<string> = (value): value is string => typeof value === 'string' && value.trim().length > 0
export const bool = oneOf(true, false)
export const q: Schema<number> = (value): value is number => Number.isSafeInteger(value)
export const nat: Schema<number> = (value): value is number => q(value) && value >= 0
export const positive: Schema<number> = (value): value is number => nat(value) && value > 0
export const finite: Schema<number> = (value): value is number => typeof value === 'number' && Number.isFinite(value)
export const hash: Schema<string> = (value): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
