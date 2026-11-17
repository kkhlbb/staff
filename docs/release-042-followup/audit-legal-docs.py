"""2026-11-17 read-only verification of quotes, notice dates, gates and docs scope."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = ROOT.parent/'release-042-artifacts'/'followup-source'/'legal'
license_text = ' '.join((ROOT/'desktop/main/cad/licenses/LICENSE_LGPL_21.txt').read_text().split())
doc = (HERE/'LICENSE-DECISIONS.zh-CN.md').read_text()
quotes = [q for q in re.findall('“([^”]+)”', doc) if q not in ('material from a header file',)]
for q in quotes:
    assert q in license_text, q
exception = (ROOT/'desktop/main/cad/licenses/OCCT_LGPL_EXCEPTION.txt').read_text()
assert 'material from a header file' in exception
review = ROOT.parent/'release-042-artifacts'/'supply'/'review'
dates = json.loads((review/'modified-file-date-review.json').read_text())
assert len(dates) == 26
assert all(x['annotationDate'] == '2026-11-14' and x['historicalModificationDate'] == 'NOT_INFERRED' for x in dates)
for p in HERE.iterdir():
    if p.is_file():
        assert (chr(47) + 'Users' + chr(47)) not in p.read_text(), p.name
# Gate output has no local paths and is safe to retain separately from old evidence.
gates = {}
for platform, resource in {
    'macos-arm64': ROOT/'out'/'寸链-darwin-arm64'/'寸链.app'/'Contents'/'Resources',
    'windows-x64': ROOT/'out'/'寸链-win32-x64'/'resources',
}.items():
    r = subprocess.run(['node', 'scripts/check-step-release.mjs', str(resource)], cwd=ROOT, capture_output=True, text=True)
    data = json.loads(r.stderr)
    assert r.returncode == 1 and data['status'] == 'BLOCKED_PROVENANCE_AND_LGPL_SOURCE_SUPPLY' and data['packageVerification'] == 'VERIFIED'
    assert len(data['blockers']) == 3
    gates[platform] = {'exitCode': r.returncode, **data}
changes = subprocess.check_output(['git', 'status', '--short', '--untracked-files=all'], cwd=ROOT, text=True).splitlines()
# Parent agent may be working elsewhere concurrently; report rather than attribute those edits.
new_docs = [line[3:] for line in changes if line[3:].startswith('docs/release-042-followup/')]
report = {'quoteChecksPassed': len(quotes) + 1, 'noticeRecords': len(dates),
          'historicalDatesNotInvented': True, 'newDocs': new_docs, 'gates': gates,
          'copyEvidence': json.loads((OUT/'controlled-copy-verification-20261117.json').read_text()),
          'runtimeEvidence': json.loads((OUT/'mac-runtime-20261117'/'runtime.json').read_text()),
          'documentationSha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(HERE.iterdir()) if p.is_file()},
          'legalCertification': False}
with (OUT/'legal-docs-audit-20261117.json').open('x') as f:
    json.dump(report, f, indent=2, ensure_ascii=False); f.write('\n')
print(json.dumps({'quoteChecksPassed': report['quoteChecksPassed'], 'noticeRecords': len(dates),
                  'gates': gates, 'runtimeStatus': report['runtimeEvidence']['status'],
                  'docsHaveNoPersonalAbsolutePaths': True}, ensure_ascii=False, indent=2))
