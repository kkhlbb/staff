import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { serializeEvidence } from '/Users/aston/DSH/tmp/cunlian-v4/risk-closeout/scripts/evidence-json.ts'
const root='/Users/aston/DSH/tmp/cunlian-v4/risk-closeout'
const out='/Users/aston/DSH/tmp/cunlian-v4/risk-closeout-evidence/continuation-02'
const doc=root+'/docs/evidence/risk-closeout-continuation-02'
mkdirSync(doc,{recursive:true})
for(const [source,name] of [
 ['model-channel-discovery.json','model-channel-discovery.json'],
 ['mechanical-preservation.json','mechanical-preservation.json'],
 ['parent-verification.json','parent-verification.json'],
 ['supply/delivery-receipt.json','final-delivery-receipt.json'],
 ['supply/distribution/PRODUCT-BINDING.json','final-product-binding.json'],
 ['supply/distribution/MANIFEST.json','final-manifest.json'],
 ['font-audit/name-tables.json','font-name-tables.json'],
 ['font-audit/packaged-font-binding.json','packaged-font-binding.json'],
])writeFileSync(doc+'/'+name,serializeEvidence(JSON.parse(readFileSync(out+'/'+source,'utf8'))))
cpSync(out+'/remaining-model-review.md',doc+'/remaining-model-review.md')
cpSync(out+'/supply/commands.jsonl',doc+'/commands.jsonl')
cpSync(out+'/supply/logs',doc+'/logs',{recursive:true})
for(const name of ['verify-and-bind-final.py','seal-final-supply.py','discover-model-channels.py','migrate-mechanical.py','extract-packaged-fonts.mjs','parse-font-names.py','archive-final.mjs'])cpSync(out+'/'+name,doc+'/'+name)
const old=readFileSync('/Users/aston/DSH/tmp/cunlian-v4/step-distribution-closeout/evidence-notes/团队日志.md')
const sha=createHash('sha256').update(old).digest('hex')
const append=`\n\n## 风险收尾 continuation-02（保留旧全文的新副本）\n\n2026-11-15 | 代达罗斯 | 接续完成 | agent/risk-closeout 自72de5b6干净开工。92931c9官方依赖供给脚本TDD，c9e22c5初始供给证据；3654c73将A40-09/07c-2原样迁出真模型门控并补AST门控回归，RED exit1后禁网4pass/15skip。真实模型调用0，不借fake消除15skip。\n\n2026-11-15 | 代达罗斯 | 机械实测 | 桌面380pass/15skip，浏览器及MCP全量另见本轮最终日志；两typecheck/lint/build/audit exit0。禁网全桌面曾因回环listen EPERM导致10fail，原始失败保留，关闭真模型开关后正常重跑exit0。当前包291全树核对、21Resources绑定，真实Electron IPC/worker/STEP落盘及三份原生读回ACCEPTED。依赖20节点/19官方版本SRI和许可证原文齐备；独立解析实包两字体name表，本地工具仅安装于continuation-02/tools。\n\n2026-11-15 | 代达罗斯 | 精确外部阻塞 | 实际Resources release gate exit1、packageVerification=VERIFIED，FORMAL_SOURCE_DELIVERY/TRANSITIVE_NOTICE_REVIEW/LGPL_LEGAL_REVIEW保留。15模型项逐项说明真实必要性与费用条件；只查键存在和本地端口，未找到可证明免费且合法的运行渠道。未merge/push/tag/release/delete/付费/改权限/全局安装，不动其他工作树。证据 ../risk-closeout-evidence/continuation-02/ 与本目录README。\n\n承接原日志SHA-256 ${sha}；旧材料只读保留。\n`
writeFileSync(doc+'/团队日志.md',Buffer.concat([old,Buffer.from(append)]))
writeFileSync(out+'/团队日志.md',Buffer.concat([old,Buffer.from(append)]))
console.log('Archived normalized evidence; retained exact prior team log prefix SHA256 '+sha)
