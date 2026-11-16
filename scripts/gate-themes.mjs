export const npmGate = (name, args = ['run', name], env = {}) => ({ name, command: 'npm', args, env })
const common = ['typecheck', 'typecheck:desktop', 'lint', 'test', 'test:desktop', 'build', 'package:desktop']
export const gateThemes = {
  'display-3dp': common.map(name => npmGate(name)),
  'v40-stage2': [npmGate('twelve-tests', ['exec', '--', 'vitest', 'run', '--config', 'vitest.desktop.config.ts', 'desktop/tests/agentScheduler.test.ts', '--reporter=verbose'], { V40_RECORD: '1' }), ...common.map(name => npmGate(name, ['run', name], { V40_RECORD: '0' }))],
  'ground-truth': [npmGate('typecheck'), npmGate('typecheck-desktop', ['run', 'typecheck:desktop']), npmGate('lint'), npmGate('test', ['test']), npmGate('test-desktop', ['run', 'test:desktop']), npmGate('test-mcp', ['run', 'test:mcp']), npmGate('build'), npmGate('test-real-docs', ['run', 'test:real-docs']), { name: 'metrics', command: 'node', args: ['scripts/real-doc-metrics.mjs'] }, npmGate('package-desktop', ['run', 'package:desktop']), npmGate('package-pdf-worker', ['run', 'check:package:pdf-worker'])],
  'ui-layout': ['typecheck', 'typecheck:desktop', 'lint', 'test', 'test:desktop', 'test:mcp', 'build', 'package:desktop', 'test:desktop:layout'].map((name, index) => npmGate(`${String(index + 1).padStart(2, '0')}-${name}`, name === 'test' ? ['test'] : ['run', name])),
  'ui-id': [npmGate('01-test', ['test']), npmGate('02-test-desktop', ['run', 'test:desktop']), npmGate('03-typecheck', ['run', 'typecheck']), npmGate('04-typecheck-desktop', ['run', 'typecheck:desktop']), npmGate('05-lint', ['run', 'lint']), npmGate('06-build', ['run', 'build']), npmGate('07-package-desktop', ['run', 'package:desktop', '--', '--arch=arm64']), npmGate('08-test-mcp', ['run', 'test:mcp'])],
}
