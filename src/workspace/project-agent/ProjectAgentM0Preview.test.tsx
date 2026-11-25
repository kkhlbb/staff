// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ProjectAgentM0Preview } from './ProjectAgentM0Preview'
import { M0_FIXTURE_IDS } from './m0PreviewFixtures'

afterEach(cleanup)

describe('ProjectAgentM0Preview', () => {
  it('defaults to honest disconnected empty observation without simulation badge or auto fixture', () => {
    render(<ProjectAgentM0Preview />)
    expect(screen.getByText('M0 只读模拟预览')).toBeTruthy()
    expect(screen.getByText('未连接')).toBeTruthy()
    expect(screen.getByText('未授权')).toBeTruthy()
    expect(screen.queryByText('模拟')).toBeNull()
    expect(screen.queryByText('旧正式版')).toBeNull()
    expect(screen.getByText(/expired-confirmation/)).toBeTruthy()
    const saveBtn = screen.getByRole('button', { name: /正式保存/ }) as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
  })

  it('loads synthetic fixtures only after explicit click and preserves selected drawing tab in narrow mode', () => {
    render(<ProjectAgentM0Preview />)
    fireEvent.click(screen.getByRole('button', { name: '图纸' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '打开模拟样本' }))
    expect(screen.getByText('模拟')).toBeTruthy()
    const select = screen.getByLabelText('选择模拟样本') as HTMLSelectElement
    expect(select.options.length).toBe(M0_FIXTURE_IDS.length)
    fireEvent.change(select, { target: { value: 'aligned-per-step-attempts' } })
    expect(screen.getByText(/仅看图纸/)).toBeTruthy()
    const saveBtn = screen.getByRole('button', { name: /正式保存/ }) as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
  })
})
