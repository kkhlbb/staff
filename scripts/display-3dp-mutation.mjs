import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
const dir='docs/evidence/display-3dp/mutations/'
await fs.mkdir(dir,{recursive:true})
const file='src/domain/units.ts'
const green=await fs.readFile(file,'utf8')
const before='  const displayedFraction = abs % 10 === 0 ? fracPart.slice(0, 3) : fracPart'
const after='  const displayedFraction = fracPart.slice(0, 3)'
assert(green.includes(before))
const patch=`--- a/src/domain/units.ts\n+++ b/src/domain/units.ts\n@@ -82,1 +82,1 @@\n-${before}\n+${after}\n`
await fs.writeFile(dir+'always-3dp.patch',patch)
const run=name=>{const r=spawnSync('npm',['test','--','src/domain/units.test.ts'],{encoding:'utf8'});return fs.writeFile(dir+name+'.log',(r.stdout??'')+(r.stderr??'')).then(()=>r.status)}
let red
try {
  await fs.writeFile(file,green.replace(before,after))
  red=await run('red-always-3dp')
  assert.notEqual(red,0,'Mutation survived')
} finally { await fs.writeFile(file,green) }
const restored=await run('green-restored')
assert.equal(restored,0)
const result={command:'npm test -- src/domain/units.test.ts',mutationExitCode:red,restoredExitCode:restored}
await fs.writeFile(dir+'results.json',JSON.stringify(result,null,2)+'\n')
console.log(result)
