// @vitest-environment node
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const text = readFileSync(new URL('./realModelA40.test.ts', import.meta.url), 'utf8')
const source = ts.createSourceFile('realModelA40.test.ts', text, ts.ScriptTarget.Latest, true)
function tests(node: ts.Node): string[] {
  const names: string[] = []
  function visit(child: ts.Node) {
    if (ts.isCallExpression(child) && child.expression.getText(source) === 'it'
      && child.arguments[0] && ts.isStringLiteral(child.arguments[0])) names.push(child.arguments[0].text)
    ts.forEachChild(child, visit)
  }
  visit(node)
  return names
}
const suites = source.statements.filter(ts.isExpressionStatement)
  .map((statement) => statement.expression).filter(ts.isCallExpression)

describe('A40 gate regression: mechanical cases must run without model permission', () => {
  it('keeps exactly the two original mechanical cases outside the real-model gate', () => {
    const offline = suites.find((call) => call.arguments[0] && ts.isStringLiteral(call.arguments[0])
      && call.arguments[0].text === 'A40 离线机械验收（不调用模型）')
    expect(offline).toBeDefined()
    expect(offline?.expression.getText(source)).toBe('describe')
    expect(offline && tests(offline)).toEqual([
      'A40-09：范围内外样例停在可解释状态（英制/扫描件/超精度）',
      'A40-07c-2：取消落在保存原子步骤 → 回执与磁盘一致（真的装配导出端口）',
    ])
    expect(offline?.getText(source)).not.toMatch(/runTask\(|adapterFor\(|testConnection\(|startTask\(/u)
  })
  it('retains the real API gate for all twelve remaining A40 scenarios and their probe', () => {
    const gated = suites.find((call) => call.expression.getText(source) === 'describe.skipIf(!ENABLED)')
    expect(gated).toBeDefined()
    expect(gated && tests(gated)).toHaveLength(12)
    expect(gated?.getText(source)).toContain('adapterFor().testConnection()')
    expect(text).toContain("process.env.V40_REAL_MODEL === '1' && KEY !== ''")
    expect(gated && tests(gated).some((name) => name.startsWith('A40-09：') || name.startsWith('A40-07c-2：'))).toBe(false)
  })
})
