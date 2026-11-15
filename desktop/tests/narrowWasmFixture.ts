import { readFileSync } from 'node:fs'

export const narrowWasm = () => Buffer.from(readFileSync('vendor/step-narrow-v1/spacer.wasm'))
export function behaviorModifiedWasm() {
  const bytes = narrowWasm()
  for (const text of ['Open CASCADE STEP translator 8.0', 'Open CASCADE %s processor 8.0']) {
    const offset = bytes.indexOf(text)
    if (offset < 0) throw new Error('fixture identity mismatch')
    Buffer.from(text.replace('Open CASCADE', 'USER PATCHED')).copy(bytes, offset)
  }
  return bytes
}
function leb(value: number) {
  const bytes = []
  do { const b = value & 127; value >>>= 7; bytes.push(b | (value ? 128 : 0)) } while (value)
  return Buffer.from(bytes)
}
export function sectionChanged(id: number, payload: number[]) {
  const bytes = narrowWasm()
  let cursor = 8
  while (cursor < bytes.length) {
    const start = cursor, section = bytes[cursor++]
    let size = 0, shift = 0, byte
    do { byte = bytes[cursor++]; size += (byte & 127) * 2 ** shift; shift += 7 } while (byte & 128)
    const end = cursor + size
    if (section === id) return Buffer.concat([bytes.subarray(0, start), Buffer.from([id]), leb(payload.length), Buffer.from(payload), bytes.subarray(end)])
    cursor = end
  }
  throw new Error('missing section')
}
