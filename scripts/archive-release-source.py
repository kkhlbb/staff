"""Build the reviewed public source archive; no Git history or private originals are shipped.
python3 scripts/archive-release-source.py --output DIR --images PRIVATE_MAPPING
"""
import argparse, hashlib, io, json, pathlib, subprocess, tarfile
p = argparse.ArgumentParser()
p.add_argument('--output', required=True)
p.add_argument('--images', required=True)
a = p.parse_args()
r = pathlib.Path(__file__).resolve().parents[1]
def git(*args):
    return subprocess.check_output(['git', *args], cwd=r)
def sha(b):
    return hashlib.sha256(b).hexdigest()
assert not git('status', '--porcelain'), 'commit the reviewed inputs before archiving'
head = git('rev-parse', 'HEAD').decode().strip()
manifest_bytes = (r/'release/source-privacy-manifest.json').read_bytes()
# Same independent trust anchor as the test verifier; never accept an arbitrary mapping.
assert sha(manifest_bytes) == '715f43e743a57c72a65ec928710573be51cae6819f8ea19359578034c37f67f9'
manifest = json.loads(manifest_bytes)
images = json.loads(pathlib.Path(a.images).read_text())
out = pathlib.Path(a.output);out.mkdir(parents=True, exist_ok=False)
rows = [];seen = set()
with tarfile.open(fileobj=io.BytesIO(git('archive', '--format=tar', head))) as source, tarfile.open(out/'cunlian-v0.4.2-beta-source.tar.gz', 'w:gz') as archive:
    for member in source:
        if not member.isfile():
            archive.addfile(member);continue
        name = member.name;b = source.extractfile(member).read();v = b;rule = 'unchanged'
        row = manifest['files'].get(name)
        if row:
            seen.add(name)
            assert sha(b) == row['originalSha256'], name
            rule = row['rule']
            if rule == 'previously-reviewed-historical-image-display-derivative':
                v = pathlib.Path(images[name]['derivedFile']).read_bytes()
            else:
                for edit in reversed(row['edits']):
                    i, n = edit['offset'], edit['length']
                    assert sha(b[i:i+n]) == edit['originalFragmentSha256']
                    assert edit['replacement'] == 'fixture-user'
                    v = v[:i] + edit['replacement'].encode() + v[i+n:]
            assert sha(v) == row['publishedSha256'], name
        rows.append({'path': name, 'originalSha256': sha(b), 'derivedSha256': sha(v), 'changed': b != v, 'rule': rule})
        member.size = len(v);archive.addfile(member, io.BytesIO(v))
assert seen == set(manifest['files'])
obj = {'sourceCommit': head, 'privacyManifestSha256': sha(manifest_bytes), 'allTrackedFilesPreserved': True,
       'disclosure': 'Exact public display derivatives, not byte-exact Git archive. Private historical originals remain in Git only. npm test authenticates published evidence independently without Git.', 'files': rows}
(out/'SOURCE-DERIVATION.json').write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'sourceCommit': head, 'files': len(rows), 'changedFiles': sum(x['changed'] for x in rows), 'manifestEntries': len(seen), 'archiveSha256': sha((out/'cunlian-v0.4.2-beta-source.tar.gz').read_bytes())}))
