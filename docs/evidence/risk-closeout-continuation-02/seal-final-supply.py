from pathlib import Path
import json,hashlib,shutil
out=Path(__file__).resolve().parent; supply=out/'supply'; dist=supply/'distribution'
def rec(p):
 b=p.read_bytes();return {'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
for source,name in [(out/'font-audit/name-tables.json','font-name-tables.json'),(out/'font-audit/packaged-font-binding.json','packaged-font-binding.json'),(supply/'logs/font-tool-freeze.stdout.txt','font-audit-tools.txt')]:
 shutil.copyfile(source,dist/'review'/name)
# Preserve the superseded receipt before writing a final receipt.
(out/'pre-final-binding/delivery-receipt.json').write_bytes((supply/'delivery-receipt.json').read_bytes())
manifest={p.relative_to(dist).as_posix():rec(p) for p in sorted(dist.rglob('*')) if p.is_file() and p!=dist/'MANIFEST.json'}
(dist/'MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
receipt=json.loads((supply/'delivery-receipt.json').read_text())
receipt.update({'manifest':rec(dist/'MANIFEST.json'),'distributionFiles':len(manifest),'distributionBytes':sum(r['bytes'] for r in manifest.values()),'sourceCommit':json.loads((dist/'PRODUCT-BINDING.json').read_text())['sourceCommit'],'finalContinuationNote':'Test/docs-only source rebind; prior binding/receipt preserved in continuation-02/pre-final-binding. Font name tables independently parsed; legal approval remains BLOCKED.'})
(supply/'delivery-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'manifest':receipt['manifest'],'distributionFiles':len(manifest),'distributionBytes':receipt['distributionBytes'],'sourceCommit':receipt['sourceCommit']},ensure_ascii=False,indent=2))
