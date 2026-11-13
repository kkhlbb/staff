// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Panel } from './Panel'
import { SplitPane, Splitter } from './SplitPane'
import { ScrollArea } from './ScrollArea'
import { LAYOUT_BUDGETS, layoutBudgetForWidth, treeWidthLimit } from './budgets'

afterEach(cleanup)
const text = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

describe('纯布局原语', () => {
  it('Panel最小宽度、折叠态、默认局部滚动；不吞掉内部内容', () => {
    const { rerender } = render(<Panel aria-label="panel" minWidth={360}><button>原有操作</button></Panel>)
    expect(screen.getByRole('region', { name: 'panel' })).toHaveStyle({ minWidth: '360px', overflow: 'auto' })
    expect(screen.getByRole('button', { name: '原有操作' })).toBeVisible()
    rerender(<Panel aria-label="panel" collapsed overflow="hidden"><button>原有操作</button></Panel>)
    expect(screen.getByRole('button', { name: '原有操作', hidden: true })).not.toBeVisible()
    expect(screen.getByRole('region', { hidden: true })).toHaveStyle({ overflow: 'hidden' })
  })

  it('ScrollArea边界与SplitPane可配置比例轨道，不持有业务数据', () => {
    render(<SplitPane data-testid="split" style={{ gridTemplateColumns: '1fr 2fr' }}><ScrollArea data-testid="scroll">完整长内容</ScrollArea></SplitPane>)
    expect(screen.getByTestId('split')).toHaveStyle({ gridTemplateColumns: '1fr 2fr' })
    expect(screen.getByTestId('scroll')).toHaveTextContent('完整长内容')
    expect(text('./layout.css')).toMatch(/\.layout-scroll-area\s*\{[^}]*min-width: 0;[^}]*min-height: 0;[^}]*overflow: auto/)
  })

  it('分割条键盘步进及上下限约束', () => {
    const change = vi.fn()
    render(<Splitter label="轨道" value={280} min={240} max={280} onChange={change} />)
    const separator = screen.getByRole('separator', { name: '轨道' })
    fireEvent.keyDown(separator, { key: 'ArrowRight' }); expect(change).toHaveBeenLastCalledWith(280)
    fireEvent.keyDown(separator, { key: 'ArrowLeft' }); expect(change).toHaveBeenLastCalledWith(272)
    fireEvent.keyDown(separator, { key: 'Home' }); expect(change).toHaveBeenLastCalledWith(240)
    fireEvent.keyDown(separator, { key: 'End' }); expect(change).toHaveBeenLastCalledWith(280)
  })

  it('分割条pointer capture是真拖动，反向轨道和取消后不再移动', () => {
    const change = vi.fn()
    render(<Splitter label="拖动" value={260} min={240} max={280} reverse onChange={change} />)
    const separator = screen.getByRole('separator', { name: '拖动' })
    separator.setPointerCapture = vi.fn()
    const pointer = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true })
      Object.defineProperties(event, { clientX: { value: x }, pointerId: { value: 7 } })
      fireEvent(separator, event)
    }
    pointer('pointerdown', 100); pointer('pointermove', 110)
    expect(separator.setPointerCapture).toHaveBeenCalledWith(7)
    expect(change).toHaveBeenLastCalledWith(250)
    pointer('pointermove', 200); expect(change).toHaveBeenLastCalledWith(240)
    pointer('pointercancel', 200); change.mockClear(); pointer('pointermove', 110)
    expect(change).not.toHaveBeenCalled()
  })
})

describe('契约静态守卫（真实几何由Electron e2e验证）', () => {
  it.each(LAYOUT_BUDGETS)('$width × $height 文档、代码、CSS值一致', b => {
    const doc = text('../../../docs/ui-layout-contract.md')
    expect(doc).toContain(`{ width: ${b.width}, height: ${b.height}, sidebar: ${b.sidebar}, centerMin: ${b.centerMin}, bottom: ${b.bottom}, collapsed: ${b.collapsed} }`)
    expect(layoutBudgetForWidth(b.width)).toEqual(b)
    const css = text('./tokens.css')
    const rule = b.width === 960 ? css.match(/@media \(max-width: 1123px\)\s*\{([\s\S]*?)\n\}/)![1]
      : b.width === 1440 ? css.match(/@media \(min-width: 1400px\)\s*\{([\s\S]*?)\n\}/)![1] : css.split('@media')[0]
    expect(rule).toContain(`--panel-sidebar-w: ${b.sidebar}px`)
    expect(rule).toContain(`--panel-center-min: ${b.centerMin}px`)
    expect(css).toContain(`${b.collapsed ? '--panel-bottom-collapsed-h' : '--panel-bottom-h'}: ${b.bottom}px`)
  })

  it('960至1440逐像素预算可容纳默认轨道和项目树拖动上限', () => {
    for (let width = 960; width <= 1440; width++) {
      const b = layoutBudgetForWidth(width)
      expect(232 + 12 + b.sidebar + b.centerMin).toBeLessThanOrEqual(width)
      expect(treeWidthLimit(width) + 12 + b.sidebar + b.centerMin).toBeLessThanOrEqual(width)
    }
    expect(layoutBudgetForWidth(1123).centerMin).toBe(360)
    expect(layoutBudgetForWidth(1124).centerMin).toBe(560)
    expect(treeWidthLimit(1124)).toBe(232)
  })

  it('52处台账无重复，N36/M16；每条变量已引用，每个保留项有对应代码注释', () => {
    const rows = text('../../../docs/ui-layout-width-inventory.md').split('\n').filter(r => /^\| W\d\d \|/.test(r))
    expect(rows).toHaveLength(52)
    expect(new Set(rows.map(r => r.split('|')[1].trim())).size).toBe(52)
    expect(rows.filter(r => r.includes('| 变量 '))).toHaveLength(36)
    expect(rows.filter(r => r.includes('| 保留：'))).toHaveLength(16)
    for (const row of rows) {
      const id = row.split('|')[1].trim()
      const file = row.match(/`(src\/[^:]+):\d+`/)![1]
      const css = text(`../../../${file}`)
      if (row.includes('| 变量 ')) {
        const name = row.match(/变量 `(.*?)`/)![1]
        expect(css).toContain(`var(${name})`)
        expect(text('./tokens.css')).toContain(`${name}:`)
      } else expect(css).toContain(`/* ${id}:`)
    }
  })

  it('工作区使用原语；展开中央保留min-width，draw区域不再hidden裁切', () => {
    const component = text('../../pages/DesktopWorkspace.tsx')
    expect(component).toMatch(/<Panel[^>]*aria-label="中央工作区" minWidth="var\(--panel-center-min\)"/)
    expect(component).toContain('<SplitPane className="desktop-workspace__body">')
    expect(component).toContain('<ScrollArea key={name} role="tabpanel"')
    const css = text('../../pages/DesktopWorkspace.css')
    expect(css).toMatch(/\.desktop-workspace__drawing-tab\s*\{[^}]*overflow: auto/)
  })
})
