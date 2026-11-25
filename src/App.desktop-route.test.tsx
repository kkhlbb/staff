// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteProjectDatabase } from './test/projectDb'
import App, { resolveDesktopHashRoute } from './App'

const originalCunlianDescriptor = Object.getOwnPropertyDescriptor(window, 'cunlian')

function restoreCunlian(): void {
  if (originalCunlianDescriptor) {
    Object.defineProperty(window, 'cunlian', originalCunlianDescriptor)
  } else {
    Reflect.deleteProperty(window, 'cunlian')
  }
}

beforeEach(async () => {
  window.location.hash = ''
  restoreCunlian()
  await deleteProjectDatabase()
})

afterEach(async () => {
  window.location.hash = ''
  restoreCunlian()
  await deleteProjectDatabase()
})

describe('resolveDesktopHashRoute：桌面工作台与旧工作台路由解析纯函数', () => {
  it('默认将 #/desktop 与桌面运行时空 hash 解析为新工作台', () => {
    expect(resolveDesktopHashRoute('#/desktop')).toBe('desktop-m1-workbench')
    expect(resolveDesktopHashRoute('', { isDesktopRuntime: true })).toBe('desktop-m1-workbench')
    expect(resolveDesktopHashRoute('', { isDesktopRuntime: false })).toBe('web')
    expect(resolveDesktopHashRoute('#/projects', { isDesktopRuntime: true })).toBe('web')
  })

  it('支持通过 defaultDesktopRoute=m1-workbench 一步将新工作台设为默认，同时保留 #/desktop-legacy 回切旧版', () => {
    expect(
      resolveDesktopHashRoute('#/desktop', { defaultDesktopRoute: 'm1-workbench' }),
    ).toBe('desktop-m1-workbench')
    expect(
      resolveDesktopHashRoute('', {
        isDesktopRuntime: true,
        defaultDesktopRoute: 'm1-workbench',
      }),
    ).toBe('desktop-m1-workbench')
    expect(
      resolveDesktopHashRoute('#/desktop-legacy', {
        isDesktopRuntime: true,
        defaultDesktopRoute: 'm1-workbench',
      }),
    ).toBe('desktop-legacy')
  })

  it('精确匹配既有 M0/M1 预览、只读、工作台与旧版路由，拒绝非精确相似路径', () => {
    expect(resolveDesktopHashRoute('#/desktop-m0-preview')).toBe('desktop-m0-preview')
    expect(resolveDesktopHashRoute('#/desktop-m1-readonly')).toBe('desktop-m1-readonly')
    expect(resolveDesktopHashRoute('#/desktop-m1-workbench')).toBe('desktop-m1-workbench')
    expect(resolveDesktopHashRoute('#/desktop-legacy')).toBe('desktop-legacy')

    expect(resolveDesktopHashRoute('#/desktop-legacy/')).toBe('web')
    expect(resolveDesktopHashRoute('#/desktop-m1-workbench/')).toBe('web')
    expect(resolveDesktopHashRoute('#/desktop/extra')).toBe('web')
  })
})

describe('App：新工作台与旧工作台入口衔接', () => {
  it('新工作台顶部提供返回旧工作台链接（#/desktop-legacy），点击/切换 hash 可平滑回切旧工作台', () => {
    window.location.hash = '#/desktop-m1-workbench'
    render(<App />)

    expect(screen.getByRole('main', { name: '寸链 M1 双入口工作台' })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('more-menu-btn'))
    const legacyLink = screen.getByRole('menuitem', { name: '返回旧工作台' })
    expect(legacyLink).toHaveAttribute('href', '#/desktop-legacy')

    act(() => {
      window.location.hash = '#/desktop-legacy'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(screen.queryByRole('main', { name: '寸链 M1 双入口工作台' })).not.toBeInTheDocument()
    expect(screen.getByRole('main', { name: '寸链启动页' })).toBeInTheDocument()
  })

  it.each(['', '#/desktop'])('桌面入口 %s 默认挂载新工作台', (hash) => {
    Object.defineProperty(window, 'cunlian', { configurable: true, value: {} })
    window.location.hash = hash
    render(<App />)

    expect(screen.getByRole('main', { name: '寸链 M1 双入口工作台' })).toBeInTheDocument()
  })
})
