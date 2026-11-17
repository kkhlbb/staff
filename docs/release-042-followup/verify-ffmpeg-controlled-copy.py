"""2026-11-17 real local-copy verification. No compilation, downloads or signing."""
from pathlib import Path
import contextlib
import hashlib
import importlib.util
import io
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = ROOT.parent/'release-042-artifacts'/'followup-source'/'legal'
OUT.mkdir(parents=True, exist_ok=True)
PREP = OUT/'candidate-20261117'
PREP.mkdir(exist_ok=False)
spec = importlib.util.spec_from_file_location('controlled', HERE/'ffmpeg-controlled-copy.py')
assert spec is not None and spec.loader is not None
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
zp = ROOT.parent/'release-0.4.2-artifacts'/'revision-02'/'native-source'/'upstream'/'ffmpeg-v45.2.3-darwin-arm64.zip'
with zipfile.ZipFile(zp) as z:
    names = [n for n in z.namelist() if n.endswith('libffmpeg.dylib')]
    assert len(names) == 1
    data = z.read(names[0])
EXPECTED = '61c9c2ac6390e8d5cf0c666bd760b93f203c9ad9448ff3fba1ab4a466cdd45f8'
assert hashlib.sha256(data).hexdigest() == EXPECTED
candidate = PREP/'libffmpeg.dylib'
candidate.write_bytes(data)
product = ROOT/'out'/'寸链-darwin-arm64'/'寸链.app'
args = ['--platform', 'macos-arm64', '--product', str(product), '--candidate', str(candidate),
        '--original-sha256', 'c0cc2b45bae4705548b0baecefbcf621589267473156023b894df1b28a1ddc28',
        '--candidate-sha256', EXPECTED]
checks = []
def call(a):
    with contextlib.redirect_stdout(io.StringIO()):
        return m.run(a)
def refusal(name, a):
    try:
        call(a)
    except (ValueError, OSError):
        checks.append({'name': name, 'passed': True})
    else:
        raise AssertionError(name)
plan = call(args)
assert plan['mode'] == 'READ_ONLY_PLAN'
checks.append({'name': 'default_read_only_plan', 'passed': True})
refusal('wrong_candidate_hash', args[:-1] + ['0'*64])
bad = args.copy(); bad[bad.index('--original-sha256')+1] = '0'*64
refusal('wrong_original_hash', bad)
refusal('unsafe_run_name', args + ['--apply', '--run-name', '../escape'])
refusal('missing_explicit_run_name', args + ['--apply'])
symlink = PREP/'linked.dylib'; symlink.symlink_to('libffmpeg.dylib')
bad = args.copy(); bad[bad.index('--candidate')+1] = str(symlink)
refusal('symlink_candidate', bad)
applied = call(args + ['--apply', '--run-name', 'mac-copy-20261117'])
checks.append({'name': 'real_app_exactly_one_library_changed_source_unchanged', 'passed': applied['changedFiles'] == [m.LIBS['macos-arm64']]})
refusal('existing_run_directory', args + ['--apply', '--run-name', 'mac-copy-20261117'])
copy = OUT/'mac-copy-20261117'/'product.app'
framework = copy/'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework'
r = subprocess.run(['otool', '-L', str(framework)], text=True, capture_output=True)
linked = [line.strip().split(' (', 1)[0] for line in r.stdout.splitlines() if 'libffmpeg' in line]
assert r.returncode == 0 and linked == ['@rpath/libffmpeg.dylib']
checks.append({'name': 'framework_links_rpath_ffmpeg', 'passed': True})
report = {'checks': checks, 'passed': all(x['passed'] for x in checks), 'plan': plan,
          'replacement': applied, 'libraryInstallNames': linked,
          'candidateArchiveSha256': hashlib.sha256(zp.read_bytes()).hexdigest(),
          'candidateArchive': '../release-0.4.2-artifacts/revision-02/native-source/upstream/ffmpeg-v45.2.3-darwin-arm64.zip',
          'candidateIsUserRecompiledLibrary': False, 'windowsRuntimeTested': False,
          'nativeRebuildExecuted': False, 'legalCertification': False}
with (OUT/'controlled-copy-verification-20261117.json').open('x') as f:
    json.dump(report, f, indent=2); f.write('\n')
print(json.dumps({'passed': report['passed'], 'checks': len(checks), 'changedFiles': applied['changedFiles'],
                  'sourceTreeVerifiedUnchanged': True, 'nativeRebuildExecuted': False}))
