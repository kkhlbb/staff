import json,subprocess,hashlib,tarfile,re
from pathlib import Path
root=Path('/Users/aston/DSH/tmp/cunlian-v4/risk-closeout'); out=Path(__file__).resolve().parent
p=out/'model-channel-discovery.json'; data=json.loads(p.read_text())
r=subprocess.run(['security','find-generic-password','-s','com.kkhlbb.cunlian.model','-a','openai-compatible-1'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
data['legacyKeychain']={'itemMetadataFound':r.returncode==0,'exitCode':r.returncode,'secretRequested':False,'note':'metadata only; no -w/-g, no decryption, no account quota probe'}
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
print('legacy Keychain metadata:',json.dumps(data['legacyKeychain']))
# Compare relocated whole test bodies to the original git tree, not to a fabricated fixture.
original=subprocess.check_output(['git','show','72de5b6:desktop/tests/realModelA40.test.ts'],cwd=root).decode()
current=(root/'desktop/tests/realModelA40.test.ts').read_text()
for marker in ('A40-09：','A40-07c-2：'):
    def block(s):
        a=s.index("  it('"+marker);b=s.index('  }, 600_000)',a)+len('  }, 600_000)');return s[a:b]
    assert block(original)==block(current),marker
# Independently inspect exact application/STEP/supply evidence returned by the child.
supply=out/'supply'; dist=supply/'distribution'; app=supply/'app/寸链.app'
def rec(p):
    b=p.read_bytes();return {'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
tree=json.loads((dist/'APP-TREE.json').read_text()); actual={}
for p in app.rglob('*'):
    if p.is_symlink():actual[p.relative_to(app).as_posix()]={'symlink':str(p.readlink())}
    elif p.is_file():actual[p.relative_to(app).as_posix()]=rec(p)
assert actual==tree
for name in ('native-packaged','native-odd','native-restored'):
    assert json.loads((supply/(name+'.json')).read_text())['status']=='ACCEPTED'
assert json.loads((supply/'packaged-step/process-exit.json').read_text())=={'code':0,'signal':None}
archive=rec(supply/'寸链-dependency-fixed-arm64.app.tar.gz')
assert archive['sha256']=='ff9a9f1fb78980ea2aeaee8c4f63fa1ddfd67e6f9be6133fc572ecb8e5d963f8'
# Bind final executable-equivalent source, including migrated tests, while preserving prior supply artifacts.
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
base='92931c9daaf85458cc60b2327595142d1ef7a59d'
diff=subprocess.check_output(['git','diff','--name-only',base,head],cwd=root,text=True).splitlines()
assert all(x.startswith(('docs/','desktop/tests/')) for x in diff),diff
backup=out/'pre-final-binding';backup.mkdir(exist_ok=False)
for name in ('PRODUCT-BINDING.json','MANIFEST.json','PACKAGE-FILES.cdx.json','closeout-source.tar.gz'):
    (backup/name).write_bytes((dist/name).read_bytes())
subprocess.run(['git','archive','--format=tar.gz','--output='+str(dist/'closeout-source.tar.gz'),head],cwd=root,check=True)
binding=json.loads((dist/'PRODUCT-BINDING.json').read_text());binding['sourceCommit']=head
binding['sourceBindingNote']='Final test/docs-only continuation source; executable inputs unchanged from prior bound source; no kernel rebuild.'
(dist/'PRODUCT-BINDING.json').write_text(json.dumps(binding,ensure_ascii=False,indent=2)+'\n')
bom=json.loads((dist/'PACKAGE-FILES.cdx.json').read_text())
for prop in bom['metadata']['properties']:
    if prop['name']=='cunlian:sourceCommit':prop['value']=head
(dist/'PACKAGE-FILES.cdx.json').write_text(json.dumps(bom,ensure_ascii=False,indent=2)+'\n')
manifest={p.relative_to(dist).as_posix():rec(p) for p in sorted(dist.rglob('*')) if p.is_file() and p.name!='MANIFEST.json'}
(dist/'MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
with tarfile.open(dist/'closeout-source.tar.gz') as tf:
    for name in ('package-lock.json','desktop/tests/realModelA40.test.ts','desktop/tests/a40Gate.test.ts'):
        assert tf.extractfile(name).read()==(root/name).read_bytes()
commands=[json.loads(x) for x in (supply/'commands.jsonl').read_text().splitlines()]
summary=[]
for name in ('gate-red','gate-green','full-desktop','full-desktop-loopback','full-browser','full-mcp','desktop-typecheck','app-typecheck','lint','build'):
    c=next(c for c in commands if c['name']==name)
    text=(supply/'logs'/(name+'.stdout.txt')).read_text()
    lines=[x.strip() for x in text.splitlines() if re.search(r'Test Files|Tests\s+|Errors\s+',x)]
    summary.append({'name':name,'exitCode':c['exitCode'],'resultLines':lines})
result={'sourceCommit':head,'productFilesChangedSinceSupply':False,'changedPaths':diff,'exactMechanicalTestBodiesPreserved':True,'actualAppEntriesVerified':len(actual),'appArchive':archive,'manifest':rec(dist/'MANIFEST.json'),'supplyFiles':len(manifest),'nativeReadback':'3 ACCEPTED','testSummary':summary,'releaseApproval':'BLOCKED'}
(out/'parent-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
