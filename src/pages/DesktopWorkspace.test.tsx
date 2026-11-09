// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopWorkspace } from './DesktopWorkspace'
import App from '../App'

afterEach(() => { cleanup(); window.location.hash = ''; vi.unstubAllGlobals() })

describe('桌面工作台骨架', () => {
  it('通过独立入口显示真实空状态，不冒充工程已保存或复核', () => {
    window.location.hash = '#/desktop'
    render(<App />)
    expect(screen.getByRole('main', { name: '寸链桌面工作台' })).toBeInTheDocument()
    expect(screen.getByText('Rev —')).toBeInTheDocument()
    expect(screen.getByText('○ 尚无保存记录')).toBeInTheDocument()
    expect(screen.getAllByRole('group')).toHaveLength(5)
    expect(screen.getByRole('button', { name: '生成 SVG 图纸' })).toBeDisabled()
  })
  it('选择保留在切换标签后，标签支持方向键与 Home/End', () => {
    render(<DesktopWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: '未载入零件' }))
    expect(screen.getByRole('heading', { name: '属性 · 零件' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('tab', { name: '工程图' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: '3D' })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('B1/B2 批次未实现')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('当前选择：零件')
    fireEvent.keyDown(screen.getByRole('tab', { name: '3D' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: '尺寸链' })).toHaveAttribute('aria-selected', 'true')
  })
  it('支持侧栏折叠、键盘调整分隔线、展开复核与导出禁用原因', () => {
    render(<DesktopWorkspace />)
    const splitter = screen.getByRole('separator', { name: '项目树宽度' })
    fireEvent.keyDown(splitter, { key: 'ArrowRight' })
    expect(splitter).toHaveAttribute('aria-valuenow', '240')
    fireEvent.click(screen.getByRole('button', { name: '收起项目树' }))
    expect(screen.queryByRole('complementary', { name: '项目树' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /复核与变更/ }))
    expect(screen.getByRole('heading', { name: '校核' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: '复核区高度' })).toHaveAttribute('aria-valuenow', '200')
    fireEvent.click(screen.getByRole('button', { name: '导出 PDF ▾' }))
    expect(screen.getByRole('button', { name: '导出图纸 PDF · C 批次未实现' })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('无图纸，无法导出')).not.toBeInTheDocument()
  })
  it('⌘O / ⌘S / ⇧⌘S 明报契约未接通，而不是成功', () => {
    render(<DesktopWorkspace />)
    for (const [key, shiftKey, label] of [['o', false, '打开项目'], ['s', false, '保存'], ['s', true, '另存为']] as const) {
      fireEvent.keyDown(window, { key, metaKey: true, shiftKey })
      expect(screen.getByRole('status')).toHaveTextContent(`${label}未接通`)
    }
  })
  it('接收现有菜单及屏障，卸载时注销，不臆造会话', () => {
    const unmenu = vi.fn(); const unflush = vi.fn(); const respondEditorFlush = vi.fn()
    const onMenuAction = vi.fn<(listener: (payload: { action: 'saveAs' }) => void) => () => void>(() => unmenu)
    const onEditorFlush = vi.fn<(listener: (payload: { requestId: string }) => void) => () => void>(() => unflush)
    vi.stubGlobal('cunlian', { onMenuAction, onEditorFlush, respondEditorFlush })
    const { unmount } = render(<DesktopWorkspace />)
    act(() => { onMenuAction.mock.calls[0]?.[0]?.({ action: 'saveAs' }) })
    expect(screen.getByRole('status')).toHaveTextContent('另存为未接通')
    onEditorFlush.mock.calls[0]?.[0]?.({ requestId: 'flush-1' })
    expect(respondEditorFlush).toHaveBeenCalledWith({ requestId: 'flush-1' })
    expect(within(screen.getByRole('main')).getByText('Rev —')).toBeInTheDocument()
    unmount(); expect(unmenu).toHaveBeenCalled(); expect(unflush).toHaveBeenCalled()
  })
})
