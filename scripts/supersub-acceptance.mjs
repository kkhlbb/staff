#!/usr/bin/env node
/** Run exact acceptance commands with OS-level network denial; keep unedited stdout/stderr. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const directory='docs/evidence/supersub-fix/logs'
mkdirSync(directory,{recursive:true})
const commands=[
 ['01-test',['test']],
 ['02-desktop',['run','test:desktop']],
 ['03-typecheck',['run','typecheck']],
 ['04-lint',['run','lint']],
 ['05-real-docs',['run','test:real-docs']],
 ['06-metrics',['run','metrics:real-docs']],
 ['08-typecheck-desktop',['run','typecheck:desktop']],
 ['09-mcp',['run','test:mcp']],
 ['10-build',['run','build']],
]
const results=[]
for(const [name,args] of commands) {
 const policy = name==='02-desktop'
  ? '(version 1)(allow default)(deny network*)(allow network-bind (local ip "localhost:*"))(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))'
  : '(version 1)(allow default)(deny network*)'
 const child=spawnSync('sandbox-exec',['-p',policy,'npm',...args],
  {encoding:'utf8',maxBuffer:20*1024*1024,env:{...process.env,NO_COLOR:'1'}})
 if(child.error) throw child.error
 const command=`sandbox-exec -p '${policy}' npm ${args.join(' ')}`
 writeFileSync(`${directory}/${name}.log`,`$ ${command}\n${child.stdout}${child.stderr}\nexit=${child.status}\n`)
 console.log(`${name}: exit=${child.status}`)
 results.push(`${command} => exit=${child.status}`)
}
writeFileSync(`${directory}/acceptance-summary.txt`,results.join('\n')+'\n')
if(results.some(r=>!r.endsWith('exit=0'))) process.exitCode=1
