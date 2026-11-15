import assert from 'node:assert/strict'
import { loadLocalStepWasm } from '../../desktop/main/cad/stepLocalWasm.ts'
const [file,sha,expectDenied] = process.argv.slice(2)
const selection={CUNLIAN_STEP_LOCAL_OPT_IN:'1',CUNLIAN_STEP_LOCAL_WASM:file,CUNLIAN_STEP_LOCAL_SHA256:sha}
if(expectDenied==='denied') {
 await assert.rejects(loadLocalStepWasm(selection),/STEP_LOCAL_FILE/)
 console.log('OS read denied -> STEP_LOCAL_FILE; no privilege or permission change')
} else {
 assert.equal((await loadLocalStepWasm(selection)).sha256,sha)
 console.log('Control: same selected file and SHA readable without sandbox restriction')
}
