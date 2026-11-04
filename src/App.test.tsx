// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteProjectDatabase } from './test/projectDb'
import App from './App'

beforeEach(async () => {
  window.location.hash = ''
  await deleteProjectDatabase()
})

afterEach(async () => {
  window.location.hash = ''
  await deleteProjectDatabase()
})

describe('App：项目列表与工作台路由', () => {
  it('从列表新建项目进入工作台，再返回列表', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText(/还没有项目/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '新建' }))
    await screen.findByRole('button', { name: '增加行' })

    expect(
      screen.getByRole('button', { name: '返回项目列表' }),
    ).toBeInTheDocument()
    expect(window.location.hash).toMatch(/^#\/projects\//)

    await user.click(
      screen.getByRole('button', { name: '返回项目列表' }),
    )

    expect(await screen.findByRole('heading', { name: '项目列表' })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: '项目列表' })
    await waitFor(() => {
      expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    })
    expect(window.location.hash).toBe('#/projects')
  })

  it('新建两个项目后返回列表，列表显示两条', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText(/还没有项目/)

    for (let index = 0; index < 2; index += 1) {
      await user.click(screen.getByRole('button', { name: '新建' }))
      await screen.findByRole('button', { name: '增加行' })
      await user.click(
        screen.getByRole('button', { name: '返回项目列表' }),
      )
      await screen.findByRole('heading', { name: '项目列表' })
    }

    const list = await screen.findByRole('list', { name: '项目列表' })
    await waitFor(() => {
      expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    })
  })
})
