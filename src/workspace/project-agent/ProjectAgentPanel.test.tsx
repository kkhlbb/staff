// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ProjectAgentPanel } from './ProjectAgentPanel'
import { resolveM0Fixture } from './m0PreviewFixtures'

afterEach(cleanup)

describe('ProjectAgentPanel', () => {
  it('renders offline-reopen with fallback old formal revision, disconnected/unauthorized, and disabled save', () => {
    const { snapshot, needsSnapshot } = resolveM0Fixture('offline-reopen')
    render(<ProjectAgentPanel snapshot={snapshot} needsSnapshot={needsSnapshot} synthetic narrow={false} selectedTab="model" />)
    expect(screen.getByText('模拟')).toBeTruthy()
    expect(screen.getByText('未连接')).toBeTruthy()
    expect(screen.getByText('未授权')).toBeTruthy()
    expect(screen.getAllByText('旧正式版').length).toBeGreaterThan(0)
    const saveBtn = screen.getByRole('button', { name: /正式保存/ }) as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
  })

  it('separates connected handshake from unauthorized project status', () => {
    const { snapshot, needsSnapshot } = resolveM0Fixture('connected-unapproved')
    render(<ProjectAgentPanel snapshot={snapshot} needsSnapshot={needsSnapshot} synthetic narrow={false} selectedTab="model" />)
    expect(screen.getByLabelText('连接：已连接')).toBeTruthy()
    expect(screen.getByLabelText('授权：未授权')).toBeTruthy()
    const saveBtn = screen.getByRole('button', { name: /正式保存/ }) as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
  })

  it('renders model before drawing in model-before-drawing', () => {
    const { snapshot, needsSnapshot } = resolveM0Fixture('model-before-drawing')
    const { container } = render(<ProjectAgentPanel snapshot={snapshot} needsSnapshot={needsSnapshot} synthetic narrow={false} selectedTab="model" />)
    const text = container.textContent ?? ''
    expect(text.indexOf('模型')).toBeLessThan(text.indexOf('图纸'))
    expect(screen.getByText('模拟')).toBeTruthy()
  })

  it('does not advertise cancelled-late-result as current ready', () => {
    const { snapshot, needsSnapshot } = resolveM0Fixture('cancelled-late-result')
    render(<ProjectAgentPanel snapshot={snapshot} needsSnapshot={needsSnapshot} synthetic narrow={false} selectedTab="model" />)
    expect(screen.getByText(/未同版就绪/)).toBeTruthy()
    const saveBtn = screen.getByRole('button', { name: /正式保存/ }) as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
  })

  it('shows snapshot recovery notice on sequence-gap and refresh-context', () => {
    for (const id of ['sequence-gap', 'refresh-context']) {
      cleanup()
      const { snapshot, needsSnapshot } = resolveM0Fixture(id)
      render(<ProjectAgentPanel snapshot={snapshot} needsSnapshot={needsSnapshot} synthetic narrow={false} selectedTab="model" />)
      expect(screen.getByText('需重新获取快照')).toBeTruthy()
    }
  })

  it('keeps save disabled on aligned-per-step-attempts, respects narrow drawing tab, and never styles uncovered/fail green', () => {
    const { snapshot, needsSnapshot } = resolveM0Fixture('aligned-per-step-attempts')
    render(<ProjectAgentPanel snapshot={snapshot} needsSnapshot={needsSnapshot} synthetic narrow={false} selectedTab="model" />)
    expect(screen.getByText(/分栏视图/)).toBeTruthy()
    expect(screen.getByText('通过')).toBeTruthy()
    const saveBtn = screen.getByRole('button', { name: /正式保存/ }) as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
    cleanup()
    render(<ProjectAgentPanel snapshot={snapshot} needsSnapshot={needsSnapshot} synthetic narrow selectedTab="drawing" />)
    expect(screen.getByText(/仅看图纸/)).toBeTruthy()
    if (snapshot.currentManifest) {
      cleanup()
      const modified = {
        ...snapshot,
        currentManifest: {
          ...snapshot.currentManifest,
          checks: snapshot.currentManifest.checks.map((c) => ({ ...c, status: 'uncovered' as const })),
        },
      }
      render(<ProjectAgentPanel snapshot={modified} synthetic narrow={false} selectedTab="model" />)
      const badge = screen.getByText('未覆盖')
      expect(badge.className).not.toContain('pa-tone-pass')
    }
  })
})
