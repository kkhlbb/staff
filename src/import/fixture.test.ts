import { describe, expect, it } from 'vitest'
import csvFixture from '../fixtures/import-table-quotes.csv?raw'
import {
  candidateDirectionValue,
  directionTokens,
  suggestMapping,
} from './mapColumns'
import { parseTableText } from './parseTable'
import { validateImport } from './validateImport'

describe('CSV fixture：引号、逗号与空白行', () => {
  it('fixture 中的备注不串列，换行保留，空白行计入忽略数', () => {
    const parsed = parseTableText(csvFixture)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }

    const mapping = suggestMapping(parsed.table, true)
    const directionValues: typeof mapping.directionValues = {}
    for (const token of directionTokens(parsed.table, mapping)) {
      const candidate = candidateDirectionValue(token)
      if (candidate !== null) {
        directionValues[token] = candidate
      }
    }
    const result = validateImport(parsed.table, {
      ...mapping,
      directionValues,
    })

    expect(result.ignoredBlankRows).toBe(1)
    expect(result.validTerms).toHaveLength(2)
    expect(result.validTerms[0]).toMatchObject({
      symbol: 'H',
      name: '机架',
      sourceNote: '含"引号"和,逗号',
      sign: 1,
    })
    expect(result.validTerms[1].sourceNote).toBe('第一行\n第二行')
  })
})
