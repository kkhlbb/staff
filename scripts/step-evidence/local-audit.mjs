import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
const [evidenceRoot]=process.argv.slice(2),root=path.resolve(evidenceRoot),final=path.join(root,'final')
const sha=file=>{const h=createHash('sha256'),fd=fs.openSync(file,'r'),buf=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null)))h.update(buf.subarray(0,n));return h.digest('hex')}finally{fs.closeSync(fd)}}
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'))
const commands=[]
for(const dir of [path.join(root,'logs'),path.join(final,'logs')])for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.json')).sort()){
 const r=json(path.join(dir,name));if(r.argv && typeof r.status==='number')commands.push({log:path.relative(root,path.join(dir,name)),status:r.status,argv:r.argv})
}
const tests=[['logs/app-tests.json',1455],['final/logs/desktop.json',373],['logs/mcp.json',22]].map(([file,expected])=>{const r=json(path.join(root,file)),match=r.stdout.match(/Tests\s+(\d+) passed/);assert.equal(r.status,0);assert.equal(Number(match?.[1]),expected);return {file,passed:Number(match[1])}})
const negatives=json(path.join(final,'negative-summary.json'));assert.equal(negatives.length,10);assert.ok(negatives.every(c=>c.status===0))
const processes=[]
for(const relative of ['packaged-default','packaged-local',...negatives.map(n=>'packaged-negative/'+n.name)]) {
 const exit=json(path.join(final,relative,'process-exit.json'));assert.equal(exit.code,0);assert.equal(exit.signal,null);processes.push({relative,...exit})
 assert.ok(!fs.readdirSync(path.join(final,relative)).some(n=>n.endsWith('.step-tmp')))
}
const readers=[]
for(const [dir,names] of [['product',['base','odd']],['packaged-default',['packaged','odd-packaged','restored']],['packaged-local',['packaged','odd-packaged','restored']]])for(const name of names){const relative=dir+'/'+name+'.step.native.json',r=json(path.join(final,relative));assert.equal(r.status,'ACCEPTED');assert.equal(r.linearThresholdMm,1e-6);assert.equal(r.repairFreeImportProven,false);readers.push({relative,status:r.status,sha256:r.sha256})}
const manifest=json(path.join(final,'snapshot-manifest.json')),sourceDifferences=[]
for(const f of manifest.files)if(sha(path.join(process.cwd(),f.relative))!==f.sha256)sourceDifferences.push(f.relative)
assert.ok(sourceDifferences.every(f=>f.startsWith('docs/')||f.startsWith('scripts/step-evidence/')))
const links=[],artifacts=[]
function walk(dir){for(const name of fs.readdirSync(dir).sort()){if(name==='snapshot')continue;const p=path.join(dir,name),rel=path.relative(root,p);if(['artifact-hashes.json','audit.json'].includes(rel))continue;const s=fs.lstatSync(p);if(s.isSymbolicLink())links.push({relative:rel,target:fs.readlinkSync(p)});else if(s.isDirectory())walk(p);else if(s.isFile())artifacts.push({relative:rel,bytes:s.size,sha256:sha(p)})}}
walk(root);walk(path.join(final,'snapshot/out'))
assert.equal(new Set(artifacts.map(a=>a.relative)).size,artifacts.length)
const hashesFile=path.join(root,'artifact-hashes.json');fs.writeFileSync(hashesFile,JSON.stringify({artifacts,links},null,2),{flag:'wx'})
const appAsar=path.join(final,'snapshot/out/寸链-darwin-arm64/寸链.app/Contents/Resources/app.asar')
const git=args=>{const r=spawnSync('git',args,{encoding:'utf8'});assert.equal(r.status,0);return r.stdout.trim()}
const ports=spawnSync('lsof',['-nP','-iTCP:9491','-iTCP:9492'],{encoding:'utf8'});assert.equal(ports.stdout,'')
const currentBom=json(path.join(process.cwd(),'STEP-SBOM.cdx.json'))
const originalBom=spawnSync('git',['show','220a45f:STEP-SBOM.cdx.json'],{encoding:'utf8'});assert.equal(originalBom.status,0)
assert.deepEqual(currentBom.metadata.properties,JSON.parse(originalBom.stdout).metadata.properties)
const gate=spawnSync('git',['show','220a45f:scripts/check-step-release.mjs']);assert.equal(gate.status,0)
assert.deepEqual(fs.readFileSync('scripts/check-step-release.mjs'),gate.stdout)
const scriptHashes=fs.readdirSync('scripts/step-evidence').filter(f=>f.endsWith('.mjs')).sort().map(f=>({relative:'scripts/step-evidence/'+f,sha256:sha('scripts/step-evidence/'+f)}))
const audit={scriptHashes,releaseGateBytesUnchanged:true,sbomReleasePropertiesUnchanged:true,branch:git(['branch','--show-current']),head:git(['rev-parse','HEAD']),worktree:git(['status','--short']),commands,commandExitCounts:Object.fromEntries([...new Set(commands.map(c=>c.status))].map(s=>[s,commands.filter(c=>c.status===s).length])),tests,totalMainPassed:tests.reduce((sum,t)=>sum+t.passed,0),skipped:17,negatives,processes,readers,sourceCompared:manifest.files.length,sourceDifferences,appAsarSha256:sha(appAsar),candidateSha256:sha(path.join(final,'candidate/modified.wasm')),artifactCount:artifacts.length,artifactManifestSha256:sha(hashesFile),debugListeners:ports.stdout,release:'BLOCKED: four original gate entries unchanged',limits:'No source-rebuilt whole OCCT WASM/relink proof; data behavior modification only. Worker is not an OS sandbox/RSS hard bound. Full Electron sandbox probe failed; exact loader permission-denial control succeeded.'}
fs.writeFileSync(path.join(root,'audit.json'),JSON.stringify(audit,null,2),{flag:'wx'})
console.log(JSON.stringify({tests,totalMainPassed:audit.totalMainPassed,commandExitCounts:audit.commandExitCounts,negativeCases:negatives.length,nativeAccepted:readers.length,cleanProcessExits:processes.length,sourceDifferences,appAsarSha256:audit.appAsarSha256,candidateSha256:audit.candidateSha256,artifactCount:artifacts.length,artifactManifestSha256:audit.artifactManifestSha256},null,2))
