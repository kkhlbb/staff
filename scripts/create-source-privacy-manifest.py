"""Maintainer-only: authenticate baseline, record exact display edits; never emits originals.
Usage: python3 scripts/create-source-privacy-manifest.py --images PRIVATE_MAPPING --baseline COMMIT
Review/pin the generated manifest hash in source-privacy.ts; this is NOT run by npm test.
"""
import argparse, hashlib, json, pathlib, re, subprocess
p = argparse.ArgumentParser()
p.add_argument('--images', required=True)
p.add_argument('--baseline', required=True)
a = p.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root)
def sha(b):
    return hashlib.sha256(b).hexdigest()
images = json.loads(pathlib.Path(a.images).read_text())
# Only the username component of explicit local-home display paths is replaced.
home = re.compile(rb'(?<=/(?:Users)/)[A-Za-z0-9_.@-]+(?=/)')
# Separate expressions keep lookbehind fixed-width on Python 3.9 too.
patterns = [home, re.compile(rb'(?<=/home/)[A-Za-z0-9_.@-]+(?=/)'),
            re.compile(rb'(?<=Users\\)[A-Za-z0-9_. @-]+(?=\\)')]
rows = {}
legacy = re.findall(r"'(docs/evidence/[^']+\.json)': '([a-f0-9]{64})'", (root/'scripts/evidence-json.ts').read_text())
legacy = dict(legacy)
for name in git('ls-tree', '-r', '--name-only', a.baseline).decode().splitlines():
    b = git('show', a.baseline + ':' + name)
    if name == 'src/test/evidenceRepro.test.ts':
        continue  # This verifier is changed in the followup; its paths are public test fixtures.
    edits = []
    for regex in patterns:
        for match in regex.finditer(b):
            if match.group() == b'fixture-user':
                continue
            edits.append({'offset': match.start(), 'length': len(match.group()),
                          'originalFragmentSha256': sha(match.group()), 'replacement': 'fixture-user'})
    edits.sort(key=lambda e: e['offset'])
    v = b
    for edit in reversed(edits):
        v = v[:edit['offset']] + edit['replacement'].encode() + v[edit['offset']+edit['length']:]
    rule = 'exact-home-username-display-edits' if edits else 'unchanged'
    if name in images:
        x = images[name]
        assert sha(b) == x['originalSha256']
        v = pathlib.Path(x['derivedFile']).read_bytes()
        assert sha(v) == x['derivedSha256']
        assert not edits
        rule = 'previously-reviewed-historical-image-display-derivative'
    if b != v:
        allowed = name.startswith(('docs/', 'scripts/')) or (name.startswith(('src/', 'desktop/tests/')) and ('.test.' in name or '/test/' in name or '/__tests__/' in name or name.startswith('desktop/tests/')))
        assert allowed, 'unapproved implementation input: ' + name
    if b != v or name in legacy or (name.startswith('docs/') and name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))):
        if name in legacy:
            assert sha(b) == legacy[name]
            assert sha(git('show', '9fe22fd:' + name)) == legacy[name]
        rows[name] = {'originalSha256': sha(b), 'publishedSha256': sha(v), 'rule': rule, 'edits': edits}
manifest = {'schemaVersion': 1, 'baselineCommit': git('rev-parse', a.baseline).decode().strip(),
            'frozenHistoryCommit': '9fe22fd', 'policy': 'Exact allowlisted offsets only; all other bytes unchanged. No original private strings included. Image derivation authenticated by original/published hashes, not claimed pixel-equivalent.',
            'files': rows}
out = root/'release/source-privacy-manifest.json'
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'manifestSha256': sha(out.read_bytes()), 'entries': len(rows), 'displayEdits': sum(len(x['edits']) for x in rows.values())}))
