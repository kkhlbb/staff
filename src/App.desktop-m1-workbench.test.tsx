// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteProjectDatabase } from './test/projectDb'
import App from './App'

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

describe('App：M1-FE-02 双入口工作台路由挂载与 #/desktop-m1-readonly 兼容', () => {
  it('精确匹配 #/desktop-m1-workbench 时挂载连接向导与双入口工作台', () => {
    window.location.hash = '#/desktop-m1-workbench'
    render(<App />)

    expect(screen.getByRole('main', { name: '寸链 M1 双入口工作台' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '首次启动与连接向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /连接本地 Agent/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /使用模型 API/ })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('more-menu-btn'))
    expect(screen.getByRole('menuitem', { name: '只读授权视图' })).toHaveAttribute(
      'href',
      '#/desktop-m1-readonly',
    )
  })

  it('保留 #/desktop-m1-readonly 路由兼容并提供切换到 #/desktop-m1-workbench 的可见入口', () => {
    window.location.hash = '#/desktop-m1-readonly'
    render(<App />)

    expect(screen.getByRole('heading', { name: 'M1 本地只读授权入口' })).toBeInTheDocument()
    const switchLink = screen.getByRole('link', { name: '切换至 M1 双入口工作台' })
    expect(switchLink).toHaveAttribute('href', '#/desktop-m1-workbench')

    // 模拟 hashchange 切换到双入口工作台
    act(() => {
      window.location.hash = '#/desktop-m1-workbench'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(screen.getByRole('main', { name: '寸链 M1 双入口工作台' })).toBeInTheDocument()
  })

  it.each([
    '#/desktop-m1-workbench/',
    '#/desktop-m1-workbench-extra',
  ])('非精确相似 hash %s 不应误入 M1 双入口工作台', async (hash) => {
    window.location.hash = hash
    render(<App />)

    expect(await screen.findByText(/还没有项目/)).toBeInTheDocument()
    expect(screen.queryByRole('main', { name: '寸链 M1 双入口工作台' })).not.toBeInTheDocument()
  })
})
