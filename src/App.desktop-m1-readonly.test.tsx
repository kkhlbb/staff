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

describe('App：M1 本地只读授权独立路由挂载与隔离', () => {
  it('精确匹配 #/desktop-m1-readonly 时挂载 M1 本地只读入口，桥接缺失时诚实显示不可用', () => {
    window.location.hash = '#/desktop-m1-readonly'
    render(<App />)

    expect(screen.getByRole('heading', { name: 'M1 本地只读授权入口' })).toBeInTheDocument()
    expect(screen.getByText('不可用')).toBeInTheDocument()
    expect(screen.getAllByText(/生产 API：未接通/).length).toBeGreaterThan(0)
    expect(screen.getByText(/正式保存：禁用/)).toBeInTheDocument()
    expect(screen.queryByText(/M0 只读模拟预览/)).not.toBeInTheDocument()
    expect(screen.queryByText(/打开项目，继续设计/)).not.toBeInTheDocument()
  })

  it('精确匹配 #/desktop-m1-readonly 且 window.cunlian 具备 4 个只读桥接方法时显示桥接可用但不自动授权', () => {
    window.location.hash = '#/desktop-m1-readonly'
    let authCalls = 0
    Object.defineProperty(window, 'cunlian', {
      configurable: true,
      writable: true,
      value: {
        requestM1ProjectAuthorization: async () => {
          authCalls += 1
          return { ok: false as const, error: { code: 'AUTH_REQUIRED', message: 'cancelled' } }
        },
        revokeM1ProjectAuthorization: async () => ({
          ok: true as const,
          value: { revoked: true as const },
        }),
        getM1ProjectContext: async () => ({
          ok: false as const,
          error: { code: 'AUTH_REQUIRED', message: 'auth required' },
        }),
        readM1ProjectEvents: async () => ({
          ok: false as const,
          error: { code: 'AUTH_REQUIRED', message: 'auth required' },
        }),
      },
    })

    render(<App />)

    expect(screen.getByRole('heading', { name: 'M1 本地只读授权入口' })).toBeInTheDocument()
    expect(screen.getByText('本地只读桥接可用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '申请只读授权' })).not.toBeDisabled()
    expect(authCalls).toBe(0)
  })

  it.each([
    '#/desktop-m1-readonly/',
    '#/desktop-m1-readonly-extra',
    '#/desktop-m1',
  ])('非精确相似 hash %s 不应进入 M1 本地只读入口', async (hash) => {
    window.location.hash = hash
    render(<App />)

    expect(await screen.findByText(/还没有项目/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'M1 本地只读授权入口' })).not.toBeInTheDocument()
  })
})
