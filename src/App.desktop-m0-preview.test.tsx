// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
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

describe('App：M0 预览独立路由隔离', () => {
  it('精确匹配 #/desktop-m0-preview 时进入 M0 只读模拟预览且默认为未连接/未授权', () => {
    window.location.hash = '#/desktop-m0-preview'
    render(<App />)

    expect(screen.getAllByText(/M0 只读模拟预览/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/未连接/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/未授权/).length).toBeGreaterThan(0)
    expect(screen.queryByText('模拟')).not.toBeInTheDocument()
    expect(screen.queryByText(/打开项目，继续设计/)).not.toBeInTheDocument()
  })

  it('精确匹配 #/desktop 时进入新工作台 且不显示 M0 预览', () => {
    window.location.hash = '#/desktop'
    render(<App />)

    expect(screen.getByRole('main', { name: '寸链 M1 双入口工作台' })).toBeInTheDocument()
    expect(screen.queryByText(/M0 只读模拟预览/)).not.toBeInTheDocument()
  })

  it('存在 window.cunlian 且 hash 为空时默认进入新工作台 而非 M0 预览', () => {
    window.location.hash = ''
    Object.defineProperty(window, 'cunlian', {
      configurable: true,
      writable: true,
      value: {
        onMenuAction: () => () => undefined,
        onEditorFlush: () => () => undefined,
        reattachSession: async () => ({ ok: true as const, value: { session: null } }),
        listRecent: async () => ({ ok: true as const, value: { items: [] } }),
        listRecovery: async () => ({ ok: true as const, value: { items: [] } }),
        takePendingDxf: async () => ({ ok: true as const, value: null }),
      },
    })

    render(<App />)

    expect(screen.getByRole('main', { name: '寸链 M1 双入口工作台' })).toBeInTheDocument()
    expect(screen.queryByText(/M0 只读模拟预览/)).not.toBeInTheDocument()
  })

  it.each([
    '#/desktop-m0-preview/',
    '#/desktop-m0-preview-extra',
    '#/desktop-m0',
  ])('非精确相似 hash %s 不应进入 M0 预览', async (hash) => {
    window.location.hash = hash
    render(<App />)

    expect(await screen.findByText(/还没有项目/)).toBeInTheDocument()
    expect(screen.queryByText(/M0 只读模拟预览/)).not.toBeInTheDocument()
  })
})
