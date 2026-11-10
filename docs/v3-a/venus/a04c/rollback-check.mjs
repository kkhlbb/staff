import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
const files = ['src/pages/DesktopWorkspace.tsx', 'src/workspace/useDesktopSession.ts', 'src/workspace/desktopAdapter.ts', 'src/components/PdfViewer.tsx']
const saved = new Map(files.map(path => [path, readFileSync(path)]))
try {
  for (const path of files) writeFileSync(path, execFileSync('git', ['show', `2cbbd23:${path}`]))
  const run = spawnSync('npm', ['test', '--', 'src/pages/DesktopWorkspace.test.tsx', '-t', 'A-04c'], { encoding: 'utf8' })
  writeFileSync('docs/v3-a/venus/a04c/rollback-red.log', run.stdout + run.stderr)
  console.log('baseline implementation, new A-04c tests: exit', run.status)
  if (run.status !== 1) throw new Error('Expected red test exit=1')
} finally {
  for (const [path, bytes] of saved) writeFileSync(path, bytes)
  console.log('implementation restored; branch and HEAD unchanged')
}
