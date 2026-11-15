from pathlib import Path
import hashlib,json
root=Path('/Users/aston/DSH/tmp/cunlian-v4/risk-closeout')
p=root/'desktop/tests/realModelA40.test.ts'
s=p.read_text()
blocks=[]
for name in ('A40-09：','A40-07c-2：'):
    start=s.index("  it('"+name)
    end=s.index('  }, 600_000)',start)+len('  }, 600_000)')
    block=s[start:end]
    blocks.append(block)
    s=s[:start]+s[end:]
s += "\n\n// These exact test bodies are mechanical; no provider probe or model permission is required.\ndescribe('A40 离线机械验收（不调用模型）', () => {\n  afterAll(cleanupAll)\n\n"+'\n\n'.join(blocks)+'\n})\n'
p.write_text(s)
report={'strategy':'relocate exact original it bodies; shared helpers unchanged; no model hooks in offline describe','cases':[{'id':name,'beforeSha256':hashlib.sha256(b.encode()).hexdigest(),'exactBodyPreserved':b in s} for name,b in zip(('A40-09','A40-07c-2'),blocks)]}
Path(__file__).with_name('mechanical-preservation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
