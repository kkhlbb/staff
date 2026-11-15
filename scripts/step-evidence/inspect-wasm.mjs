import fs from 'node:fs'
const b=fs.readFileSync('node_modules/replicad-opencascadejs/dist/replicad_single.wasm')
let p=8
function u(){let n=0,s=0,x; do{x=b[p++];n+=(x&127)*2**s;s+=7}while(x&128);return n}
while(p<b.length){const id=b[p++],len=u(),end=p+len;if(id===4 || id===5)console.log('table/memory section',id,p,len,[...b.subarray(p,end)]);p=end}
for(const text of ['Open CASCADE STEP processor','Open CASCADE','8.0']) {let pos=-1;while((pos=b.indexOf(text,pos+1))>=0)console.log(text,pos,b.subarray(pos,pos+90).toString())}
const m=new WebAssembly.Module(b);console.log('imports',WebAssembly.Module.imports(m));console.log('exports',WebAssembly.Module.exports(m).length)
