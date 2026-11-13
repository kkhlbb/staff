// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { calculateChain } from '../domain/calculate'
import { ASSUMPTION_NOTE, DEFAULT_MC_SEED, UI_MC_SAMPLES } from '../domain/statistics'
import type { ChainDefinition, DimensionTerm } from '../domain/types'
import { parseMm } from '../domain/units'
import { StatisticalReference } from './StatisticalReference'

function term(
  id: string,
  sign: 1 | -1,
  nominal: string,
  lower: string,
  upper: string,
): DimensionTerm {
  return {
    id,
    symbol: id,
    name: id,
    nominalQ: parseMm(nominal),
    lowerDeviationQ: parseMm(lower),
    upperDeviationQ: parseMm(upper),
    sign,
    sourceNote: '',
    termRevision: 1,
  }
}

function chainOf(lengthMm: string, target = { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') }) {
  const chain: ChainDefinition = {
    terms: [
      term('H', 1, '52.2000', '-0.0200', '0.0200'),
      term('B1', -1, '20.0000', '-0.0100', '0.0100'),
      term('S', -1, lengthMm, '-0.0100', '0.0100'),
      term('B2', -1, '20.0000', '-0.0100', '0.0100'),
    ],
    target,
    assumptions: '统计参考组件用例',
  }
  return chain
}

describe('统计参考面板：三法并列、极值法在前、判定不被改写', () => {
  it('按 极值法 → RSS → 蒙特卡洛 的顺序并列展示，并标注判定依据', () => {
    const chain = chainOf('12.0500')
    const result = calculateChain(chain)
    const { container } = render(<StatisticalReference chain={chain} result={result} />)

    const panel = screen.getByTestId('statistical-reference')
    const order = ['stat-extreme', 'stat-rss', 'stat-monte-carlo'].map((id) =>
      within(panel).getByTestId(id),
    )
    // DOM 顺序即展示顺序：极值法必须在最前。
    for (let index = 1; index < order.length; index += 1) {
      expect(
        order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
    expect(within(panel).getByTestId('stat-extreme')).toHaveTextContent('判定依据')
    expect(within(panel).getByTestId('stat-extreme')).toHaveTextContent('0.1000 mm')
    expect(within(panel).getByTestId('stat-extreme')).toHaveTextContent('0.2000 mm')

    // 极值法的结果仍来自 calculateChain 的判定，组件不改写。
    expect(result.status).toBe('within')
    expect(container.textContent).toContain('极值法')
  })

  it('蒙特卡洛写明种子与样本数，交叉验证给出具体偏差百分比', () => {
    const chain = chainOf('12.0500')
    const result = calculateChain(chain)
    render(<StatisticalReference chain={chain} result={result} />)

    const monteCarlo = screen.getByTestId('stat-monte-carlo')
    expect(monteCarlo).toHaveTextContent(`种子 ${DEFAULT_MC_SEED}`)
    expect(monteCarlo).toHaveTextContent(UI_MC_SAMPLES.toLocaleString('zh-CN'))
    expect(monteCarlo).toHaveTextContent('P0.135')

    const crossCheck = screen.getByTestId('stat-cross-check')
    // 正态分布下偏差应在 2% 容差内，并且把百分比数字显示出来。
    expect(crossCheck).toHaveTextContent('在容差内')
    expect(crossCheck.textContent).toMatch(/\d+\.\d{2}%/)
  })

  it('假设文案固定写清三法差异，不暗示统计法更宽松更好', () => {
    const chain = chainOf('12.0500')
    render(<StatisticalReference chain={chain} result={calculateChain(chain)} />)
    const note = screen.getByTestId('stat-assumption')
    expect(note).toHaveTextContent(ASSUMPTION_NOTE)
    expect(note.textContent).toContain('仍是条款判定的唯一依据')
    expect(note.textContent).toContain('不代表装配更容易合格')
  })

  it('切到均匀分布：偏差如实超出容差，不隐藏、不调参', async () => {
    const user = userEvent.setup()
    const chain = chainOf('12.0500')
    render(<StatisticalReference chain={chain} result={calculateChain(chain)} />)

    const select = screen.getByLabelText('蒙特卡洛分布')
    await user.selectOptions(select, 'uniform')
    const crossCheck = screen.getByTestId('stat-cross-check')
    expect(crossCheck).toHaveTextContent('超出容差')
    expect(crossCheck).toHaveTextContent('不调参凑数')
    expect(screen.getByTestId('stat-monte-carlo')).toHaveTextContent('均匀')
  })

  it('无有效链或结果时只显示空态，不编造统计值', () => {
    render(<StatisticalReference chain={null} result={null} />)
    expect(screen.getByTestId('statistical-reference')).toHaveTextContent('暂无')
    expect(screen.queryByTestId('stat-rss')).toBeNull()
    expect(screen.queryByTestId('stat-monte-carlo')).toBeNull()
  })
})
