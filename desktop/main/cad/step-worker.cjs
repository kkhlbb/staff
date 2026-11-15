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
