// Fixed narrow C ABI; one fresh WASM heap per job, terminated by the parent.
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
(async () => {
  const { input, assetDirectory, hashes } = workerData;
  for (const [name, expected] of Object.entries(hashes)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(assetDirectory, name))).digest('hex'), expected, 'STEP_ASSET_HASH: ' + name);
  }
  assert.ok(input && Object.keys(input).sort().join(',') === 'innerDiameter,length,outerDiameter', 'STEP_INVALID');
  assert.ok(Object.values(input).every(q => Number.isSafeInteger(q) && q >= 100 && q <= 100000000), 'STEP_UNSUPPORTED');
  assert.ok(input.outerDiameter - input.innerDiameter >= 200, 'STEP_UNSUPPORTED');
  const d = input.innerDiameter / 10000, D = input.outerDiameter / 10000, L = input.length / 10000;
  assert.ok(Math.max(D, L) / Math.min(d / 2, (D - d) / 2, L) <= 10000, 'STEP_UNSUPPORTED');
  const originalWasm = fs.readFileSync(path.join(assetDirectory, 'spacer.wasm'));
  let wasmBinary = originalWasm;
  const prefix = workerData.localWasm ? 'STEP_LOCAL_' : 'STEP_';
  if (workerData.localWasm) {
    const local = workerData.localWasm;
    assert.ok(local.bytes instanceof Uint8Array && local.bytes.length >= 8 && local.bytes.length <= 64 * 1024 * 1024, 'STEP_LOCAL_SIZE');
    assert.equal(crypto.createHash('sha256').update(local.bytes).digest('hex'), local.sha256, 'STEP_LOCAL_HASH');
    wasmBinary = Buffer.from(local.bytes);
  }
  let module;
  try { module = new WebAssembly.Module(wasmBinary); } catch { throw new Error(prefix + 'COMPILE'); }
  const reference = new WebAssembly.Module(originalWasm);
  for (const kind of ['imports', 'exports']) assert.deepEqual(WebAssembly.Module[kind](module), WebAssembly.Module[kind](reference), prefix + 'ABI');
  // Module.imports/exports report names/kinds, NOT function signatures. Resolve
  // actual type indices before instantiation, including imported functions.
  function functionABI(bytes) {
    let cursor = 8, limit = bytes.length;
    const check = ok => assert.ok(ok, prefix + 'ABI');
    const byte = () => { check(cursor < limit); return bytes[cursor++]; };
    const leb = () => { let value = 0, shift = 0, b; do { check(shift < 35); b = byte(); value += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return value; };
    const name = () => { const size = leb(); check(cursor + size <= limit); const value = bytes.subarray(cursor, cursor + size).toString('utf8'); cursor += size; return value; };
    const types = [], functions = [], imports = [], exports = [];
    while (cursor < bytes.length) {
      limit = bytes.length;
      const id = byte(), size = leb(), end = cursor + size;
      check(end <= bytes.length); limit = end;
      if (id === 1) {
        const count = leb();
        for (let i = 0; i < count; i++) {
          check(byte() === 0x60);
          const vector = () => { const count = leb(), values = []; for (let j = 0; j < count; j++) { const value = byte(); check([0x7f,0x7e,0x7d,0x7c,0x7b,0x70,0x6f].includes(value)); values.push(value); } return values; };
          types.push({ parameters: vector(), results: vector() });
        }
      } else if (id === 2) {
        const count = leb();
        for (let i = 0; i < count; i++) { const module = name(), field = name(); check(byte() === 0); const type = leb(); functions.push(type); imports.push({ module, name: field, type }); }
      } else if (id === 3) {
        const count = leb(); for (let i = 0; i < count; i++) functions.push(leb());
      } else if (id === 7) {
        const count = leb(); for (let i = 0; i < count; i++) { const field = name(), kind = byte(), index = leb(); if (kind === 0) exports.push({ name: field, index }); }
      }
      if ([1,2,3,7].includes(id)) check(cursor === end);
      cursor = end;
    }
    const type = index => { check(Number.isInteger(index) && !!types[index]); return types[index]; };
    return { imports: imports.map(i => ({ module: i.module, name: i.name, signature: type(i.type) })), exports: exports.map(e => ({ name: e.name, signature: type(functions[e.index]) })) };
  }
  const abi = functionABI(wasmBinary);
  assert.deepEqual(abi, functionABI(originalWasm), prefix + 'ABI');
  assert.deepEqual(abi.exports.find(e => e.name === 'spacer_step')?.signature, { parameters: [0x7c,0x7c,0x7c], results: [0x7f] }, prefix + 'ABI');
  // V8 resourceLimits do not bound linear memory. Apply to BOTH default/local.
  let cursor = 8, memories = 0, tables = 0;
  function uleb(end) {
    let value = 0, shift = 0, byte;
    do {
      assert.ok(cursor < end && shift < 35, prefix + 'MEMORY');
      byte = wasmBinary[cursor++]; value += (byte & 127) * 2 ** shift; shift += 7;
    } while (byte & 128);
    return value;
  }
  while (cursor < wasmBinary.length) {
    const id = wasmBinary[cursor++], size = uleb(wasmBinary.length), end = cursor + size;
    assert.ok(end <= wasmBinary.length, prefix + 'MEMORY');
    if (id === 4) {
      assert.equal(uleb(end), 1, prefix + 'TABLE');
      assert.equal(wasmBinary[cursor++], 0x70, prefix + 'TABLE');
      assert.equal(uleb(end), 1, prefix + 'TABLE');
      const initial = uleb(end), maximum = uleb(end);
      assert.ok(initial <= maximum && maximum <= 1000000 && cursor === end, prefix + 'TABLE');
      tables++;
    }
    if (id === 5) {
      assert.equal(uleb(end), 1, prefix + 'MEMORY');
      assert.equal(uleb(end), 1, prefix + 'MEMORY');
      const initial = uleb(end), maximum = uleb(end);
      assert.ok(initial <= maximum && maximum <= 8192 && cursor === end, prefix + 'MEMORY');
      memories++;
    }
    cursor = end;
  }
  assert.equal(memories, 1, prefix + 'MEMORY');
  assert.equal(tables, 1, prefix + 'TABLE');
  let oc;
  try {
    oc = await require(path.join(assetDirectory, 'spacer.cjs'))({
      instantiateWasm(imports, receive) {
        const instance = new WebAssembly.Instance(module, imports);
        receive(instance, module);
        return instance.exports;
      },
      print: () => {}, printErr: () => {},
    });
  } catch { throw new Error(prefix + 'INSTANTIATE'); }
  assert.equal(typeof oc._spacer_step, 'function', prefix + 'API');
  assert.equal(typeof oc.FS?.readFile, 'function', prefix + 'API');
  // C++ wrapper validates BRep/solid/shell/analytic faces/radii/volume/hole
  // points before writing AND on STEP readback. Nonzero codes never yield bytes.
  const code = oc._spacer_step(D, d, L);
  assert.equal(code, 0, 'STEP_NARROW_STATUS_' + code);
  const bytes = Uint8Array.from(oc.FS.readFile('/spacer.step'));
  assert.ok(bytes.length > 0 && bytes.length <= 16 * 1024 * 1024, 'STEP_RESULT_SIZE');
  parentPort.postMessage({ bytes }, [bytes.buffer]);
})().catch(error => { parentPort.postMessage({ error: 'STEP_KERNEL_FAILED: ' + (error?.message || String(error)) }); });
