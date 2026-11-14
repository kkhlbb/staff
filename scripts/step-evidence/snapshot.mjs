import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const [destination]=process.argv.slice(2)
if(!destination || fs.existsSync(destination))throw Error('Need fresh snapshot directory')
const root=process.cwd(),out=path.resolve(destination)
fs.mkdirSync(out,{recursive:true})
const listing=spawnSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8'})
if(listing.status!==0)throw Error(listing.stderr)
const files=[...new Set(listing.stdout.split('\0').filter(Boolean))].sort(),manifest=[]
for(const relative of files){const source=path.join(root,relative),target=path.join(out,relative);if(!fs.statSync(source).isFile())throw Error(relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);const sha=b=>createHash('sha256').update(b).digest('hex');const sourceSha=sha(fs.readFileSync(source)),targetSha=sha(fs.readFileSync(target));if(sourceSha!==targetSha)throw Error(relative);manifest.push({relative,sha256:sourceSha})}
const clone=spawnSync('cp',['-cR',path.join(root,'node_modules'),path.join(out,'node_modules')],{encoding:'utf8'})
if(clone.status!==0)throw Error(clone.stderr)
fs.writeFileSync(path.join(out,'../snapshot-manifest.json'),JSON.stringify({source:root,snapshot:out,files:manifest},null,2),{flag:'wx'})
console.log(JSON.stringify({snapshot:out,sourceFiles:manifest.length,nodeModulesCloneExit:clone.status}))
