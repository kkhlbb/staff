import os,json,socket,urllib.request
from pathlib import Path
out=Path(__file__).resolve().parent
root=Path('/Users/aston/DSH/tmp/cunlian-v4/risk-closeout')
report={'scope':'read-only existence/configuration metadata; no decrypt, no credential values, no model generation','environment':{},'configs':[],'keyStores':[],'localPorts':[]}
for k in ('DEEPSEEK_API_KEY','OPENAI_API_KEY','OLLAMA_API_KEY','V40_REAL_MODEL','INTENT_REAL_MODEL'):
    report['environment'][k]={'present':bool(os.environ.get(k))}
bases=[root]
appsupport=Path.home()/'Library/Application Support'
for name in ('寸链','staff','Electron'):
    p=appsupport/name
    report.setdefault('userDataRoots',[]).append({'path':str(p),'exists':p.exists()})
    if p.exists():bases.append(p)
for base in bases:
    for folder,dirs,files in os.walk(base):
        dirs[:]=[d for d in dirs if d not in ('node_modules','.git','out','Cache','Code Cache','GPUCache','DawnGraphiteCache','docs','.vite')]
        if 'model-config.json' in files:
            p=Path(folder)/'model-config.json'
            try:
                data=json.loads(p.read_text()); url=urllib.request.urlparse(data.get('baseUrl','')) if False else None
                from urllib.parse import urlsplit
                u=urlsplit(data.get('baseUrl',''))
                report['configs'].append({'path':str(p),'host':u.hostname,'port':u.port,'modelConfigured':bool(data.get('model')),'keySource':data.get('keySource'),'configuredEnvKeyPresent':bool(os.environ.get(data.get('keyEnvVar','DEEPSEEK_API_KEY'))),'localEndpoint':u.hostname in ('localhost','127.0.0.1','::1')})
            except Exception as e: report['configs'].append({'path':str(p),'readError':type(e).__name__})
        if 'model-key-store.json' in files:
            p=Path(folder)/'model-key-store.json'
            try:
                data=json.loads(p.read_text())
                report['keyStores'].append({'path':str(p),'configuredAdapterCiphertextPresent':bool(data.get('entries',{}).get('openai-compatible-1')),'decryptAttempted':False})
            except Exception as e:report['keyStores'].append({'path':str(p),'readError':type(e).__name__})
for port in (11434,1234,8000,8080):
    s=socket.socket();s.settimeout(.5)
    try:opened=s.connect_ex(('127.0.0.1',port))==0
    finally:s.close()
    item={'host':'127.0.0.1','port':port,'listening':opened}
    if opened and port in (11434,1234):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}'+('/api/tags' if port==11434 else '/v1/models'),timeout=2) as r:
                data=json.load(r)
            item['listedModelCount']=len(data.get('models',data.get('data',[])))
        except Exception as e:item['metadataError']=type(e).__name__
    report['localPorts'].append(item)
report['result']='No new model requests authorized; key presence does not prove free quota. No paid endpoint probed.'
(out/'model-channel-discovery.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
