import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
const [root]=process.argv.slice(2)
const hash=b=>createHash('sha256').update(b).digest('hex')
let count=0;const mismatches=[]
for(const line of fs.readFileSync(path.join(root,'SHA256SUMS'),'utf8').trimEnd().split('\n')) {
 const split=line.indexOf('  '),sha=line.slice(0,split),relative=line.slice(split+2)
 if(hash(fs.readFileSync(path.join(root,relative)))!==sha)mismatches.push(relative);count++
}
const result={checked:count,mismatches,manifestSha256:hash(fs.readFileSync(path.join(root,'SHA256SUMS'))),reportSha256:hash(fs.readFileSync(path.join(root,'REPORT.zh-CN.md')))}
console.log(JSON.stringify(result,null,2));process.exitCode=mismatches.length?1:0
