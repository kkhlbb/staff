// The scoped override is needed until typescript-estree permits minimatch 11.
// Exercise its actual call shape (useProgramFromProjectService.js: dot: true)
// and the parser's allowDefaultProject path, not just an installed version.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const fromEstree = createRequire(require.resolve('@typescript-eslint/typescript-estree'))
const { minimatch } = fromEstree('minimatch')
const { parseForESLint } = require('@typescript-eslint/parser')
const root = fileURLToPath(new URL('../', import.meta.url))

test('scoped minimatch preserves project-service pattern matching with dot:true', () => {
  for (const [file, pattern, expected] of [
    ['probe.ts', '*.ts', true],
    ['probe.js', '*.ts', false],
    ['.probe.ts', '*.ts', true],
    ['src/probe.ts', '*.ts', false],
    ['src/.probe.ts', 'src/*.ts', true],
    ['probe.ts', '*.{ts,tsx}', true],
    ['probe.tsx', '*.{ts,tsx}', true],
    ['probe.js', '*.{ts,tsx}', false],
    ['probe.ts', '@(probe|other).ts', true],
  ]) assert.equal(minimatch(file, pattern, { dot: true }), expected, `${file} / ${pattern}`)
})

test('real TypeScript parser project service accepts only allowDefaultProject match', () => {
  const options = {
    filePath: path.join(root, 'risk-closeout-probe.ts'),
    tsconfigRootDir: root,
    projectService: { allowDefaultProject: ['risk-closeout-probe.ts'] },
  }
  const result = parseForESLint('const value: number = 1; value;', options)
  assert.equal(result.ast.type, 'Program')
  assert.ok(result.services.program)
  const checker = result.services.program.getTypeChecker()
  const identifier = result.services.esTreeNodeToTSNodeMap.get(result.ast.body[0].declarations[0].id)
  assert.equal(checker.typeToString(checker.getTypeAtLocation(identifier)), 'number')
  assert.throws(() => parseForESLint('const other: number = 2;', {
    ...options, filePath: path.join(root, 'risk-closeout-unmatched.ts'),
  }), /not found by the project service/)
})
