// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectOpenValue, SnapshotDto } from '../../../desktop/shared/contracts'
import { DesktopAgentWorkspace } from './DesktopAgentWorkspace'
import { ProjectAgentM1ReadonlyEntry } from './ProjectAgentM1ReadonlyEntry'

const originalCunlianDescriptor = Object.getOwnPropertyDescriptor(window, 'cunlian')

function restoreCunlian(): void {
  if (originalCunlianDescriptor) {
    Object.defineProperty(window, 'cunlian', originalCunlianDescriptor)
  } else {
    Reflect.deleteProperty(window, 'cunlian')
  }
}

function makeSnapshot(projectId: string, projectName: string): SnapshotDto {
  return {
    project: {
      id: projectId,
      name: projectName,
      description: '',
      unit: 'mm',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    chains: [],
    snapshots: [],
  } as unknown as SnapshotDto
}

function makeOpenValue(params: {
  sessionId: string
  projectId: string
  projectName: string
  path?: string | null
  fingerprint?: string | null
}): ProjectOpenValue {
  return {
    sessionId: params.sessionId,
    path: params.path === undefined ? `/tmp/${params.projectId}.cunlian` : params.path,
    fingerprint:
      params.fingerprint === undefined ? 'a'.repeat(64) : params.fingerprint,
    snapshot: makeSnapshot(params.projectId, params.projectName),
    editSeq: 0,
    recovery: 'none',
    warnings: [],
  } as unknown as ProjectOpenValue
}

function installDesktopCunlianMock(overrides: {
  reattachSession?: () => Promise<unknown>
  openProject?: () => Promise<unknown>
  requestM1ProjectAuthorization?: (req: {
    projectId: string
    requestId: string
    requestGeneration: number
  }) => Promise<unknown>
}) {
  const reattachSession = vi.fn(
    overrides.reattachSession ?? (async () => ({ ok: true as const, value: { session: null } })),
  )
  const openProject = vi.fn(
    overrides.openProject ??
      (async () => ({
        ok: true as const,
        value: makeOpenValue({
          sessionId: 'sess-opened-1',
          projectId: 'project-a',
          projectName: '隔套实测项目',
        }),
      })),
  )
  const requestM1ProjectAuthorization = vi.fn(
    overrides.requestM1ProjectAuthorization ??
      (async (req: {
        projectId: string
        requestId: string
        requestGeneration: number
      }) => ({
        ok: true as const,
        value: {
          projectId: req.projectId,
          authorizationRef: `auth-ref-${req.projectId}`,
          requestGeneration: req.requestGeneration,
        },
      })),
  )
  const api = {
    reattachSession,
    openProject,
    onMenuAction: vi.fn(() => () => {}),
    onEditorFlush: vi.fn(() => () => {}),
    respondEditorFlush: vi.fn(),
    requestM1ProjectAuthorization,
  }
  Object.defineProperty(window, 'cunlian', {
    configurable: true,
    writable: true,
    value: api,
  })
  return { reattachSession, openProject, requestM1ProjectAuthorization }
}

afterEach(() => {
  restoreCunlian()
})

describe('DesktopAgentWorkspace：申请原生只读授权直接拉起回归测试', () => {
  it('首次启动未绑定 .cunlian 文件时，点击「申请原生只读授权」直接拉起文件选择器并在打开后自动触发原生只读授权', async () => {
    const user = userEvent.setup()
    const { openProject, requestM1ProjectAuthorization } = installDesktopCunlianMock({})

    render(<DesktopAgentWorkspace />)

    const authCard = screen.getByRole('region', { name: '项目授权状态' })
    await user.click(within(authCard).getByRole('button', { name: '申请原生只读授权' }))

    await waitFor(() => {
      expect(openProject).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(requestM1ProjectAuthorization).toHaveBeenCalledTimes(1)
    })
    expect(requestM1ProjectAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-a' }),
    )
    expect(await screen.findByText(/已完成项目 project-a 的原生只读授权/)).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: '项目授权状态' })).getByText('已授权（只读）'),
    ).toBeInTheDocument()
  })

  it('未绑定文件时取消文件选择器，诚实提示取消且不误触发原生只读授权', async () => {
    const user = userEvent.setup()
    const { openProject, requestM1ProjectAuthorization } = installDesktopCunlianMock({
      openProject: async () => ({
        ok: false as const,
        error: { code: 'CANCELLED', message: '已取消打开项目' },
      }),
    })

    render(<DesktopAgentWorkspace />)

    const authCard = screen.getByRole('region', { name: '项目授权状态' })
    await user.click(within(authCard).getByRole('button', { name: '申请原生只读授权' }))

    expect(
      await screen.findByText(/已取消选择本地 \.cunlian 项目文件，未发起原生只读授权/),
    ).toBeInTheDocument()
    expect(openProject).toHaveBeenCalledTimes(1)
    expect(requestM1ProjectAuthorization).not.toHaveBeenCalled()
    expect(within(authCard).getByText('未授权')).toBeInTheDocument()
  })

  it('窗口已通过 reattachSession 绑定本地 .cunlian 文件时，点击「申请原生只读授权」直接拉起原生授权框而不重复弹文件选择', async () => {
    const user = userEvent.setup()
    const { openProject, requestM1ProjectAuthorization } = installDesktopCunlianMock({
      reattachSession: async () => ({
        ok: true as const,
        value: {
          ...makeOpenValue({
            sessionId: 'sess-reattached',
            projectId: 'project-reattached',
            projectName: '已绑定装配项目',
          }),
          savedSeq: 0,
        },
      }),
    })

    render(<DesktopAgentWorkspace />)

    await screen.findByRole('heading', { name: '已绑定装配项目' })
    const authCard = screen.getByRole('region', { name: '项目授权状态' })
    await user.click(within(authCard).getByRole('button', { name: '申请原生只读授权' }))

    await waitFor(() => {
      expect(requestM1ProjectAuthorization).toHaveBeenCalledTimes(1)
    })
    expect(openProject).not.toHaveBeenCalled()
    expect(requestM1ProjectAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-reattached' }),
    )
    expect(
      await screen.findByText(/已完成项目 project-reattached 的原生只读授权/),
    ).toBeInTheDocument()
  })

  it('在已绑定项目上切换到内置模板后，点击顶部连接胶囊内的「申请原生只读授权」会先拉起文件选择并自动完成新项目授权', async () => {
    const user = userEvent.setup()
    const { openProject, requestM1ProjectAuthorization } = installDesktopCunlianMock({
      reattachSession: async () => ({
        ok: true as const,
        value: {
          ...makeOpenValue({
            sessionId: 'sess-initial',
            projectId: 'project-initial',
            projectName: '初始项目',
          }),
          savedSeq: 0,
        },
      }),
      openProject: async () => ({
        ok: true as const,
        value: makeOpenValue({
          sessionId: 'sess-reopened',
          projectId: 'project-reopened',
          projectName: '重新打开项目',
        }),
      }),
    })

    render(<DesktopAgentWorkspace />)

    await screen.findByRole('heading', { name: '初始项目' })
    await user.click(screen.getByRole('button', { name: '先跳过，直接体验工作台' }))
    await user.click(screen.getByRole('button', { name: '打开项目 安装板项目' }))

    // Now on built-in template proj-plate-01 (!== project-initial): trigger from TopBar popover
    await user.click(screen.getByTestId('connection-capsule-btn'))
    const popover = screen.getByRole('dialog', { name: '连接与授权详情' })
    await user.click(within(popover).getByRole('button', { name: '申请原生只读授权' }))

    await waitFor(() => {
      expect(openProject).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(requestM1ProjectAuthorization).toHaveBeenCalledTimes(1)
    })
    expect(requestM1ProjectAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-reopened' }),
    )
    expect(
      await screen.findByText(/已完成项目 project-reopened 的原生只读授权/),
    ).toBeInTheDocument()
  })
})

describe('授予项目只读权限界面：关闭 / 退出按钮与 Esc / 外部点击退出', () => {
  it('WorkbenchTopBar 连接与授权弹层具备右上角 ×、底部「取消 / 退出」、Esc 与点击外部关闭', async () => {
    const user = userEvent.setup()
    installDesktopCunlianMock({})
    render(<DesktopAgentWorkspace />)

    // Close onboarding first to inspect workbench topbar popover
    await user.click(screen.getByTestId('close-onboarding-wizard-btn'))
    expect(screen.queryByRole('region', { name: '首次启动与连接向导' })).not.toBeInTheDocument()

    // 1. Top-right × button
    await user.click(screen.getByTestId('connection-capsule-btn'))
    const dialog1 = screen.getByRole('dialog', { name: '连接与授权详情' })
    const closeX = within(dialog1).getByRole('button', { name: '关闭连接与授权详情' })
    expect(closeX).toBeVisible()
    await user.click(closeX)
    expect(screen.queryByRole('dialog', { name: '连接与授权详情' })).not.toBeInTheDocument()

    // 2. Bottom「取消 / 退出」button
    await user.click(screen.getByTestId('connection-capsule-btn'))
    const dialog2 = screen.getByRole('dialog', { name: '连接与授权详情' })
    const exitBtn = within(dialog2).getByRole('button', { name: '取消 / 退出' })
    expect(exitBtn).toBeVisible()
    await user.click(exitBtn)
    expect(screen.queryByRole('dialog', { name: '连接与授权详情' })).not.toBeInTheDocument()

    // 3. Esc key
    await user.click(screen.getByTestId('connection-capsule-btn'))
    expect(screen.getByRole('dialog', { name: '连接与授权详情' })).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '连接与授权详情' })).not.toBeInTheDocument()

    // 4. Outside click
    await user.click(screen.getByTestId('connection-capsule-btn'))
    expect(screen.getByRole('dialog', { name: '连接与授权详情' })).toBeVisible()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog', { name: '连接与授权详情' })).not.toBeInTheDocument()
  })

  it('OnboardingWizard 具备右上角 ×、底部「取消 / 退出」、Esc 与点击外层遮罩关闭', async () => {
    const user = userEvent.setup()
    installDesktopCunlianMock({})
    render(<DesktopAgentWorkspace />)

    const reopenWizard = async () => {
      await user.click(screen.getByTestId('connection-capsule-btn'))
      await user.click(screen.getByRole('button', { name: '切换连接' }))
      expect(screen.getByRole('region', { name: '首次启动与连接向导' })).toBeVisible()
    }

    // 1. Top-right × button
    const closeX = screen.getByRole('button', { name: '收起向导' })
    expect(closeX).toBeVisible()
    await user.click(closeX)
    expect(screen.queryByRole('region', { name: '首次启动与连接向导' })).not.toBeInTheDocument()

    // 2. Bottom「取消 / 退出」button
    await reopenWizard()
    const exitBtn = screen.getByRole('button', { name: '取消 / 退出' })
    expect(exitBtn).toBeVisible()
    await user.click(exitBtn)
    expect(screen.queryByRole('region', { name: '首次启动与连接向导' })).not.toBeInTheDocument()

    // 3. Esc key
    await reopenWizard()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: '首次启动与连接向导' })).not.toBeInTheDocument()

    // 4. Backdrop click
    await reopenWizard()
    fireEvent.click(screen.getByTestId('onboarding-wizard-backdrop'))
    expect(screen.queryByRole('region', { name: '首次启动与连接向导' })).not.toBeInTheDocument()
  })

  it('ProjectAgentM1ReadonlyEntry 具备右上角 ×、底部「取消 / 退出」与 Esc 返回工作台', async () => {
    const user = userEvent.setup()
    const onExit = vi.fn()
    render(<ProjectAgentM1ReadonlyEntry onExit={onExit} />)

    const closeX = screen.getByRole('button', { name: '关闭只读授权视图' })
    const exitBtn = screen.getByRole('button', { name: '取消 / 退出' })
    expect(closeX).toBeVisible()
    expect(exitBtn).toBeVisible()

    await user.click(closeX)
    expect(onExit).toHaveBeenCalledTimes(1)

    await user.click(exitBtn)
    expect(onExit).toHaveBeenCalledTimes(2)

    await user.keyboard('{Escape}')
    expect(onExit).toHaveBeenCalledTimes(3)
  })
})

