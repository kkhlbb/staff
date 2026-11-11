import ts from 'typescript'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'})
const files=git('diff','9f437b9','--name-only','--','*.test.ts','*.test.tsx').trim().split('\n')
function assertions(text){
 const sf=ts.createSourceFile('test.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 const out=[]
 function rooted(n){if(ts.isCallExpression(n))return ts.isIdentifier(n.expression)&&n.expression.text==='expect';if(ts.isPropertyAccessExpression(n))return rooted(n.expression);return false}
 function visit(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&rooted(n.expression.expression))out.push({line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,text:n.getText(sf)});ts.forEachChild(n,visit)}
 visit(sf);return out
}
const results=[]
for(const file of files){
 const before=assertions(git('show',`9f437b9:${file}`)),after=assertions(fs.readFileSync(file,'utf8'))
 if(before.length!==after.length)throw new Error('Changed existing assertion count '+file)
 let changed=after.filter((n,i)=>n.text!==before[i].text)
 if(file.includes('ChainDiagram'))changed=changed.filter(x=>!x.text.includes('toContain(symbol)'))
 const dataConsumers=file==='src/domain/units.test.ts'?after.filter(x=>x.text.startsWith('expect(formatMm(')).map(x=>x.line):file.includes('ChainDiagram')?after.filter(x=>x.text==='expect(text).toContain(nominal)'&&!changed.some(c=>c.line===x.line)).map(x=>x.line):[]
 results.push({file,count:changed.length+dataConsumers.length,changedLines:changed.map(x=>x.line),externalExpectedTableConsumers:dataConsumers})
}
const report={basis:'9f437b9',definition:'Existing matcher call sites, including inline callbacks; external expectation-table consumer sites counted once, not each row/iteration. Excludes symbol-only rename and DOM query. New MmInput assertions are additional, not migration.',total:results.reduce((n,r)=>n+r.count,0),files:results}
fs.writeFileSync('docs/evidence/display-3dp/assertion-count.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
