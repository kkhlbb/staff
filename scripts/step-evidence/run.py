"""Capture exact command exits and output. Never overwrite an earlier evidence run."""
import sys,subprocess,time,json,os
from pathlib import Path
root=Path(__file__).resolve().parents[2]
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
label=sys.argv[2];argv=sys.argv[3:];start=time.monotonic()
p=subprocess.run(argv,cwd=root,env=os.environ.copy(),capture_output=True,text=True)
record={'argv':argv,'exitCode':p.returncode,'elapsedSeconds':time.monotonic()-start,'stdout':p.stdout,'stderr':p.stderr}
with (out/(label+'.json')).open('x') as f:json.dump(record,f,indent=2)
with (out/(label+'.log')).open('x') as f:f.write(p.stdout+'\nSTDERR:\n'+p.stderr)
print(label,'exit',p.returncode,'elapsed',round(record['elapsedSeconds'],3));print(p.stdout[-2000:]);print(p.stderr[-2000:]);sys.exit(p.returncode)
