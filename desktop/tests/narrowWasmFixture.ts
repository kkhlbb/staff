import { readFileSync } from 'node:fs'

export const narrowWasm = () => Buffer.from(readFileSync('vendor/occt-unified/cunlian_occt.wasm'))
export function behaviorModifiedWasm() {
  const bytes = narrowWasm()
  for (const text of ['Open CASCADE STEP translator 7.8', 'Open CASCADE %s processor 7.8']) {
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
export function signatureMismatchWasm() {
  const bytes = narrowWasm()
  let cursor = 8
  const uleb = () => { let n = 0, shift = 0, b; do { b = bytes[cursor++]; n += (b & 127) * 2 ** shift; shift += 7 } while (b & 128); return n }
  while (cursor < bytes.length) {
    const id = bytes[cursor++], size = uleb(), end = cursor + size
    if (id === 7) {
      const count = uleb(), entries: { name: Buffer; kind: number; index: number }[] = []
      for (let i = 0; i < count; i++) { const size = uleb(), name = bytes.subarray(cursor, cursor + size); cursor += size; entries.push({ name, kind: bytes[cursor++], index: uleb() }) }
      const ctor = entries.find(e => e.name.toString() === '__wasm_call_ctors')!
      const payload = Buffer.concat([leb(count), ...entries.map(e => Buffer.concat([leb(e.name.length), e.name, Buffer.from([e.kind]), leb(e.name.toString() === 'spacer_step' ? ctor.index : e.index)]))])
      return sectionChanged(7, [...payload])
    }
    cursor = end
  }
  throw new Error('missing exports')
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
