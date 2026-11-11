"""Read-only scope audit against the requested baseline; no parser/math/coordinate edits."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
def baseline(path):
    return subprocess.check_output(['git', 'show', f'9f437b9:{path}'], cwd=root, text=True)

def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print('PASS', message)

path = 'src/domain/units.ts'
old = baseline(path).split('export function formatMm')[0].rsplit('/**', 1)[0]
new = (root / path).read_text().split('export function formatMm')[0].rsplit('/**', 1)[0]
check(old == new, 'units parser, constants and precision unchanged byte-for-byte')
for path in ['src/domain/calculate.ts', 'src/domain/types.ts', 'src/project-file/validation.ts',
             'src/document-extraction/types.ts', 'desktop/main/pdfCheck.ts',
             'src/components/ExtractionReviewPanel.tsx', 'src/components/RequirementRevisionHistory.tsx',
             'src/pages/PrintReport.tsx']:
    check(baseline(path) == (root / path).read_text(), path + ' unchanged byte-for-byte')
path = 'src/components/DesktopSessionViews.tsx'
function = 'formatRequirementRect'
def block(text):
    return text.split('function ' + function, 1)[1].split('\n}', 1)[0]
check(block(baseline(path)) == block((root / path).read_text()), function + ' PDF points unchanged')
