// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../workspace/useWorkspace'
import {
  ChainDiagram,
  type ChainDiagramTerm,
} from './ChainDiagram'

function caseATerms(): ChainDiagramTerm[] {
  return [
    { id: 'H', symbol: 'H', sign: 1, nominal: '100.0000' },
    { id: 'B1', symbol: 'B1', sign: -1, nominal: '20.0000' },
    { id: 'S', symbol: 'S', sign: -1, nominal: '59.8000' },
    { id: 'B2', symbol: 'B2', sign: -1, nominal: '20.0000' },
  ]
}

function groups(container: HTMLElement): SVGGElement[] {
  return Array.from(container.querySelectorAll<SVGGElement>('[data-term-id]'))
}

function groupById(container: HTMLElement, id: string): SVGGElement {
  const result = container.querySelector<SVGGElement>(`[data-term-id="${id}"]`)
  expect(result).not.toBeNull()
  if (result === null) {
    throw new Error(`未找到组成环 ${id}`)
  }
  return result
}

function lineX(group: SVGGElement): { x1: number; x2: number } {
  const line = group.querySelector('[data-segment-line]')
  expect(line).not.toBeNull()
  if (line === null) {
    throw new Error('未找到段线')
  }
  return {
    x1: Number(line.getAttribute('x1')),
    x2: Number(line.getAttribute('x2')),
  }
}

interface LabelBox {
  id: string
  left: number
  right: number
  top: number
  bottom: number
}

/** 读取渲染时使用的标签块几何，用于检查同屏标签是否重叠。 */
function labelBoxes(container: HTMLElement): LabelBox[] {
  return groups(container).map((group) => {
    const id = group.getAttribute('data-term-id') ?? ''
    const centerX = Number(group.getAttribute('data-label-x'))
    const labelY = Number(group.getAttribute('data-label-y'))
    const width = Number(group.getAttribute('data-label-width'))
    const height = Number(group.getAttribute('data-label-height'))
    return {
      id,
      left: centerX - width / 2,
      right: centerX + width / 2,
      // 标签块从第一行文字上方 14 开始，总高 36。
      top: labelY - 14,
      bottom: labelY - 14 + height,
    }
  })
}

function boxesOverlap(left: LabelBox, right: LabelBox): boolean {
  return (
    left.left < right.right &&
    right.left < left.right &&
    left.top < right.bottom &&
    right.top < left.bottom
  )
}

/** REAL-01（MITCalc 例 1）七环：A + / B - / C - / D + / E - / F + / G -。 */
function real01Terms(): ChainDiagramTerm[] {
  return [
    { id: 'A', symbol: 'A', sign: 1, nominal: '208.0000' },
    { id: 'B', symbol: 'B', sign: -1, nominal: '1.7500' },
    { id: 'C', symbol: 'C', sign: -1, nominal: '23.0000' },
    { id: 'D', symbol: 'D', sign: 1, nominal: '20.0000' },
    { id: 'E', symbol: 'E', sign: -1, nominal: '200.0000' },
    { id: 'F', symbol: 'F', sign: 1, nominal: '20.0000' },
    { id: 'G', symbol: 'G', sign: -1, nominal: '23.0000' },
  ]
}

describe('ChainDiagram：几何与方向', () => {
  it('按输入顺序绘制四段，正项向右、负项向左且首尾相接', () => {
    const { container } = render(
      <ChainDiagram terms={caseATerms()} onSelect={vi.fn()} />,
    )

    const rendered = groups(container)
    expect(rendered).toHaveLength(4)
    expect(rendered.map((group) => group.getAttribute('data-term-id'))).toEqual([
      'H',
      'B1',
      'S',
      'B2',
    ])

    const expected = [
      { id: 'H', sign: '1', direction: 'right' },
      { id: 'B1', sign: '-1', direction: 'left' },
      { id: 'S', sign: '-1', direction: 'left' },
      { id: 'B2', sign: '-1', direction: 'left' },
    ]

    for (const item of expected) {
      const group = groupById(container, item.id)
      expect(group.getAttribute('data-sign')).toBe(item.sign)
      expect(group.getAttribute('data-direction')).toBe(item.direction)

      const { x1, x2 } = lineX(group)
      if (item.direction === 'right') {
        expect(x2).toBeGreaterThan(x1)
      } else {
        expect(x2).toBeLessThan(x1)
      }
    }

    // 首尾相接：下一段的起点就是上一段的终点。
    for (let index = 1; index < rendered.length; index += 1) {
      const previous = lineX(rendered[index - 1])
      const current = lineX(rendered[index])
      expect(current.x1).toBeCloseTo(previous.x2, 6)
    }
  })

  it('每段同时标注代号与基本尺寸', () => {
    const { container } = render(
      <ChainDiagram terms={caseATerms()} onSelect={vi.fn()} />,
    )

    for (const [id, nominal] of [
      ['H', '100.0000'],
      ['B1', '20.0000'],
      ['S', '59.8000'],
      ['B2', '20.0000'],
    ]) {
      const text = groupById(container, id).textContent
      expect(text).toContain(id)
      expect(text).toContain(nominal)
    }
  })

  it('REAL-01 七环的代号与基本尺寸标签互不重叠，并继续标注“非比例”', () => {
    const { container } = render(
      <ChainDiagram terms={real01Terms()} onSelect={vi.fn()} />,
    )

    const rendered = groups(container)
    expect(rendered).toHaveLength(7)
    for (const term of real01Terms()) {
      const text = groupById(container, term.id).textContent
      expect(text).toContain(term.symbol)
      expect(text).toContain(term.nominal)
    }

    const boxes = labelBoxes(container)
    for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < boxes.length;
        rightIndex += 1
      ) {
        expect(
          boxesOverlap(boxes[leftIndex], boxes[rightIndex]),
          `${boxes[leftIndex].id} 与 ${boxes[rightIndex].id} 的标签重叠`,
        ).toBe(false)
      }
    }

    expect(screen.getByText('非比例')).toBeInTheDocument()
  })

  it('title、可见标题与“非比例”标注都存在，svg 以 img 角色暴露可读名称', () => {
    const { container } = render(
      <ChainDiagram terms={caseATerms()} onSelect={vi.fn()} />,
    )

    expect(screen.getByText('尺寸链关系示意，非装配图')).toBeInTheDocument()
    expect(screen.getByText('非比例')).toBeInTheDocument()

    const svg = screen.getByRole('img', {
      name: /尺寸链关系示意，非装配图。共 4 段/,
    })
    expect(svg).toBeInTheDocument()

    const title = container.querySelector('title')
    expect(title).not.toBeNull()
    expect(title?.textContent).toContain('H')
    expect(title?.textContent).toContain('向右')
    expect(title?.textContent).toContain('减小封闭环')
  })

  it('selectedTermId 对应段高亮并设置 aria-pressed', () => {
    const { container } = render(
      <ChainDiagram
        terms={caseATerms()}
        selectedTermId="S"
        onSelect={vi.fn()}
      />,
    )

    const selected = groupById(container, 'S')
    expect(selected.getAttribute('data-selected')).toBe('true')
    expect(selected.getAttribute('aria-pressed')).toBe('true')

    const other = groupById(container, 'H')
    expect(other.getAttribute('data-selected')).toBe('false')
    expect(other.getAttribute('aria-pressed')).toBe('false')

    const selectedLine = selected.querySelector('[data-segment-line]')
    const otherLine = other.querySelector('[data-segment-line]')
    expect(selectedLine?.getAttribute('stroke-width')).toBe('6')
    expect(otherLine?.getAttribute('stroke-width')).toBe('3')
  })
})

describe('ChainDiagram：交互', () => {
  it('点击段触发 onSelect(termId)', () => {
    const onSelect = vi.fn()
    render(<ChainDiagram terms={caseATerms()} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /B1/ }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('B1')
  })

  it('段可用键盘 Enter 或空格激活', () => {
    const onSelect = vi.fn()
    render(<ChainDiagram terms={caseATerms()} onSelect={onSelect} />)

    const h = screen.getByRole('button', { name: /H/ })
    fireEvent.keyDown(h, { key: 'Enter' })
    expect(onSelect).toHaveBeenLastCalledWith('H')

    const s = screen.getByRole('button', { name: /S/ })
    fireEvent.keyDown(s, { key: ' ' })
    expect(onSelect).toHaveBeenLastCalledWith('S')
    expect(onSelect).toHaveBeenCalledTimes(2)
  })
})

describe('ChainDiagram：空链与无效尺寸', () => {
  it('空链不报错，显示空状态且没有可点击段', () => {
    const { container } = render(
      <ChainDiagram terms={[]} onSelect={vi.fn()} />,
    )

    expect(screen.getByText('尺寸链关系示意，非装配图')).toBeInTheDocument()
    expect(screen.getByText('非比例')).toBeInTheDocument()
    expect(screen.getByText('尚未添加组成环')).toBeInTheDocument()
    expect(groups(container)).toHaveLength(0)

    const svg = screen.getByRole('img', {
      name: /当前还没有组成环/,
    })
    expect(svg).toBeInTheDocument()
  })

  it('零宽与非正/无效尺寸仍保留为点标记，不会被静默丢弃', () => {
    const terms: ChainDiagramTerm[] = [
      { id: 'Z', symbol: 'Z', sign: 1, nominal: '0.0000' },
      { id: 'X', symbol: 'X', sign: -1, nominal: '不是数字' },
      { id: 'N', symbol: 'N', sign: -1, nominal: '-2.0000' },
    ]
    const onSelect = vi.fn()
    const { container } = render(
      <ChainDiagram terms={terms} onSelect={onSelect} />,
    )

    const rendered = groups(container)
    expect(rendered).toHaveLength(3)
    expect(
      container.querySelectorAll('[data-zero-width-marker="true"]'),
    ).toHaveLength(3)

    for (const group of rendered) {
      expect(group.getAttribute('data-zero-width')).toBe('true')
      expect(group.getAttribute('data-invalid')).toBe('true')
      expect(group.querySelector('[data-segment-line]')).toBeNull()
    }

    const z = groupById(container, 'Z')
    expect(z.textContent).toContain('0.0000')
    expect(z.getAttribute('data-direction')).toBe('right')

    const x = groupById(container, 'X')
    expect(x.textContent).toContain('不是数字')
    expect(x.getAttribute('data-direction')).toBe('left')

    fireEvent.click(screen.getByRole('button', { name: /X/ }))
    expect(onSelect).toHaveBeenCalledWith('X')
  })

  it('也接受领域链的整数 nominalQ，并用 formatMm 显示', () => {
    const { container } = render(
      <ChainDiagram
        terms={[
          { id: 'H', symbol: 'H', sign: 1, nominalQ: 1_000_000 },
          { id: 'B1', symbol: 'B1', sign: -1, nominalQ: 200_000 },
        ]}
        onSelect={vi.fn()}
      />,
    )

    expect(groupById(container, 'H').textContent).toContain('100.0000')
    expect(groupById(container, 'B1').textContent).toContain('20.0000')
  })
})

describe('ChainDiagram：与 useWorkspace 草稿数据衔接', () => {
  it('接收真实 reducer 的 draft.terms，并在重排后按新顺序重绘', () => {
    function WorkspaceHarness() {
      const { draft, dispatch } = useWorkspace({
        terms: [
          {
            id: 'H',
            symbol: 'H',
            name: '机架',
            nominal: '100.0000',
            lower: '0.0000',
            upper: '0.1000',
            sign: 1,
            sourceNote: '',
            termRevision: 1,
          },
          {
            id: 'B1',
            symbol: 'B1',
            name: '轴承 1',
            nominal: '20.0000',
            lower: '-0.0200',
            upper: '0.0000',
            sign: -1,
            sourceNote: '',
            termRevision: 1,
          },
          {
            id: 'S',
            symbol: 'S',
            name: '隔套',
            nominal: '59.8000',
            lower: '-0.0500',
            upper: '0.0500',
            sign: -1,
            sourceNote: '',
            termRevision: 1,
          },
          {
            id: 'B2',
            symbol: 'B2',
            name: '轴承 2',
            nominal: '20.0000',
            lower: '-0.0200',
            upper: '0.0000',
            sign: -1,
            sourceNote: '',
            termRevision: 1,
          },
        ],
        targetMin: '0.1000',
        targetMax: '0.3000',
        relationRevision: 0,
        assumptions: '案例 A',
      })

      return (
        <>
          <button
            type="button"
            onClick={() =>
              dispatch({ type: 'moveTerm', termId: 'H', direction: 'down' })
            }
          >
            下移 H
          </button>
          <ChainDiagram
            terms={draft.terms}
            selectedTermId={draft.terms[1]?.id ?? null}
            onSelect={(termId) =>
              dispatch({
                type: 'updateField',
                termId,
                field: 'name',
                value: '已选择',
              })
            }
          />
        </>
      )
    }

    const { container } = render(<WorkspaceHarness />)
    const order = () =>
      groups(container).map((group) => group.getAttribute('data-term-id'))

    expect(order()).toEqual(['H', 'B1', 'S', 'B2'])

    fireEvent.click(screen.getByRole('button', { name: '下移 H' }))

    expect(order()).toEqual(['B1', 'H', 'S', 'B2'])
    expect(groupById(container, 'H').getAttribute('data-direction')).toBe(
      'right',
    )
  })
})
