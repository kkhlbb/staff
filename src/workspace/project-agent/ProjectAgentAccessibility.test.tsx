// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'
import { getArtifactStatusMeta } from './M2CenterCanvas'
import { focusRecoveryElement, isEditableFocusTarget } from './focusRecovery'
import type { M1WorkbenchBridge, M1WorkbenchIncomingEvent } from './m1WorkbenchBridge'
import type {
  M2CheckItem,
  M2PreviewEvent,
  M2WorkbenchBridge,
} from './m2WorkbenchBridge'

describe('focusRecovery 与产物状态纯函数', () => {
  it('正确识别输入控件（INPUT/TEXTAREA/SELECT/contentEditable）并在其中拒绝抢占焦点', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const editableDiv = document.createElement('div')
    editableDiv.setAttribute('contenteditable', 'true')
    const nonEditableDiv = document.createElement('div')
    nonEditableDiv.setAttribute('contenteditable', 'false')
    const targetBtn = document.createElement('button')
    targetBtn.textContent = '恢复'

    document.body.append(input, textarea, select, editableDiv, nonEditableDiv, targetBtn)
    try {
      expect(isEditableFocusTarget(input)).toBe(true)
      expect(isEditableFocusTarget(textarea)).toBe(true)
      expect(isEditableFocusTarget(select)).toBe(true)
      expect(isEditableFocusTarget(editableDiv)).toBe(true)
      expect(isEditableFocusTarget(nonEditableDiv)).toBe(false)
      expect(isEditableFocusTarget(targetBtn)).toBe(false)

      // 焦点在 INPUT 时不抢占
      input.focus()
      expect(focusRecoveryElement(targetBtn)).toBe(false)
      expect(document.activeElement).toBe(input)

      // 焦点在 TEXTAREA 时不抢占
      textarea.focus()
      expect(focusRecoveryElement(targetBtn)).toBe(false)
      expect(document.activeElement).toBe(textarea)

      // 焦点在 SELECT 时不抢占
      select.focus()
      expect(focusRecoveryElement(targetBtn)).toBe(false)
      expect(document.activeElement).toBe(select)

      // 焦点在 contentEditable 时不抢占
      editableDiv.tabIndex = 0
      editableDiv.focus()
      expect(focusRecoveryElement(targetBtn)).toBe(false)
      expect(document.activeElement).toBe(editableDiv)

      // 焦点在非输入区时自动落到恢复按钮
      editableDiv.blur()
      expect(focusRecoveryElement(targetBtn)).toBe(true)
      expect(document.activeElement).toBe(targetBtn)

      // 禁用按钮不接受焦点
      targetBtn.blur()
      targetBtn.disabled = true
      expect(focusRecoveryElement(targetBtn)).toBe(false)
      expect(document.activeElement).not.toBe(targetBtn)
    } finally {
      input.remove()
      textarea.remove()
      select.remove()
      editableDiv.remove()
      nonEditableDiv.remove()
      targetBtn.remove()
    }
  })

  it('getArtifactStatusMeta 为就绪/草稿/生成中/失败/空状态全部提供图形标识与文字', () => {
    const readyFormal = getArtifactStatusMeta(
      { status: 'ready', revision: 'v1', revisionOrder: 1, isDraft: false, fingerprint: 'fp-1' },
      '模型',
    )
    expect(readyFormal).toMatchObject({ symbol: '✓', stateKey: 'ready', toneClass: 'pa-tone-pass' })
    expect(readyFormal.text).toContain('模型就绪')

    const readyDraft = getArtifactStatusMeta(
      { status: 'ready', revision: 'draft-2', revisionOrder: 2, isDraft: true, fingerprint: 'fp-2' },
      '模型',
    )
    expect(readyDraft).toMatchObject({ symbol: '✓', stateKey: 'draft-ready' })
    expect(readyDraft.text).toContain('草稿')
    expect(readyDraft.text).toContain('✎')

    const building = getArtifactStatusMeta(
      { status: 'building', revision: 'draft-3', revisionOrder: 3, isDraft: true, fingerprint: null },
      '图纸',
    )
    expect(building).toMatchObject({ symbol: '◌', stateKey: 'building', toneClass: 'pa-tone-action' })
    expect(building.text).toContain('图纸生成中')

    const failed = getArtifactStatusMeta(
      { status: 'ready', revision: 'draft-2', revisionOrder: 2, isDraft: true, fingerprint: 'fp-2' },
      '图纸',
      { failedRevision: 'draft-3', failedRevisionOrder: 3, reason: '投影失败', retryable: true },
    )
    expect(failed).toMatchObject({ symbol: '✕', stateKey: 'failed', toneClass: 'pa-tone-danger' })
    expect(failed.text).toContain('图纸失败')
    expect(failed.text).toContain('草稿 2')

    const empty = getArtifactStatusMeta(
      { status: 'empty', revision: null, revisionOrder: null, isDraft: false, fingerprint: null },
      '图纸',
    )
    expect(empty).toMatchObject({ symbol: '○', stateKey: 'empty', toneClass: 'pa-tone-muted' })
    expect(empty.text).toContain('图纸未生成')
  })
})

describe('第一部分 §3 错误后焦点自动落点（5 类场景 + 不抢占输入焦点）', () => {
  it('1) 断线后自动将焦点落到「重连」按钮；若焦点在输入控件内则不抢占', async () => {
    let pushM1Event: ((event: M1WorkbenchIncomingEvent) => void) | null = null
    const bridge: M1WorkbenchBridge = {
      subscribeM1WorkbenchEvents: async (_req, listener) => {
        pushM1Event = listener
        return { ok: true, value: { subscriptionId: 'sub-disc-1' } }
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialDraftRevision="draft-2"
        initialConnectionSnapshot={{
          connectionState: 'connected',
          source: 'local-agent',
          clientName: 'Claude Desktop',
          authorizationState: 'authorized-writable',
        }}
      />,
    )

    act(() => {
      pushM1Event?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 1,
        sequence: 1,
        type: 'connection_changed',
        connectionState: 'disconnected',
      })
    })

    const reconnectBtn = screen.getByRole('button', { name: '重连' })
    expect(document.activeElement).toBe(reconnectBtn)
  })

  it('1b) 焦点位于输入框内时发生断线，不抢占用户当前输入焦点', () => {
    let pushM1Event: ((event: M1WorkbenchIncomingEvent) => void) | null = null
    const bridge: M1WorkbenchBridge = {
      subscribeM1WorkbenchEvents: async (_req, listener) => {
        pushM1Event = listener
        return { ok: true, value: { subscriptionId: 'sub-disc-2' } }
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={true}
        initialDraftRevision="draft-2"
        initialConnectionSnapshot={{
          connectionState: 'connected',
          source: 'model-api',
          clientName: 'gpt-4.1',
          authorizationState: 'authorized-writable',
        }}
      />,
    )

    // 切到模型 API 面板并聚焦到服务地址输入框
    fireEvent.click(screen.getByRole('button', { name: /使用模型 API/ }))
    const baseUrlInput = screen.getByLabelText('服务地址')
    baseUrlInput.focus()
    expect(document.activeElement).toBe(baseUrlInput)

    act(() => {
      pushM1Event?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 1,
        sequence: 2,
        type: 'connection_changed',
        connectionState: 'disconnected',
      })
    })

    expect(screen.getByRole('button', { name: '重连' })).toBeInTheDocument()
    expect(document.activeElement).toBe(baseUrlInput)
  })

  it('2) 图纸生成失败后焦点自动落到「重试图纸」按钮，重试再次失败仍落回该按钮', async () => {
    const user = userEvent.setup()
    let pushM2Event: ((event: M2PreviewEvent) => void) | null = null
    const retryM2Drawing = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'PROJECTION_ERROR', message: '投影依然超时' },
    })
    const bridge: M2WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushM2Event = listener
        return { ok: true, value: { subscriptionId: 'sub-draw-fail' } }
      },
      retryM2Drawing,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialDraftRevision="draft-7"
        initialPreviewSnapshot={{
          currentRevision: 'draft-7',
          model: { status: 'ready', revision: 'draft-7', revisionOrder: 7, isDraft: true, fingerprint: 'fp-7' },
          drawing: { status: 'ready', revision: 'draft-7', revisionOrder: 7, isDraft: true, fingerprint: 'fp-7' },
        }}
      />,
    )

    act(() => {
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 10,
        revision: 'draft-8',
        revisionOrder: 8,
        isDraft: true,
        fingerprint: 'fp-8',
        type: 'model_ready',
      })
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 11,
        revision: 'draft-8',
        revisionOrder: 8,
        isDraft: true,
        type: 'drawing_failed',
        errorReason: '草稿 8 投影失败',
      })
    })

    const retryBtn = screen.getByRole('button', { name: '重试图纸' })
    expect(document.activeElement).toBe(retryBtn)

    await user.click(retryBtn)
    expect(retryM2Drawing).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(retryBtn)
  })

  it('3) 模型 API 鉴权或工具往返失败后焦点自动落到「测试连接」按钮', async () => {
    const user = userEvent.setup()
    const bridge: M1WorkbenchBridge = {
      testM1ModelApiConnection: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'AUTH_FAILED', message: 'API 密钥无效' },
      }),
    }

    render(<ProjectAgentM1Workbench bridge={bridge} initialShowOnboarding={true} />)

    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    await user.type(screen.getByLabelText('密钥'), 'sk-invalid-key')
    const testBtn = screen.getByRole('button', { name: '测试连接' })
    await user.click(testBtn)

    expect(await screen.findByText(/API 密钥无效/)).toBeInTheDocument()
    expect(document.activeElement).toBe(testBtn)
  })

  it('4) 内置聊天运行失败后焦点自动落到「重试」按钮', async () => {
    const user = userEvent.setup()
    const bridge: M1WorkbenchBridge = {
      testM1ModelApiConnection: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          availableModels: ['gpt-4.1'],
          selectedModel: 'gpt-4.1',
          toolCallSupported: true,
          toolRoundTripPassed: true,
          toolRoundTripName: 'describe_project',
        },
      }),
      sendM1ChatMessage: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'UPSTREAM_TIMEOUT', message: '模型响应超时' },
      }),
    }

    render(<ProjectAgentM1Workbench bridge={bridge} initialShowOnboarding={true} />)

    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    await user.type(screen.getByLabelText('密钥'), 'sk-valid-key')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    await user.click(await screen.findByRole('button', { name: '进入内置建模对话' }))

    await user.type(screen.getByLabelText('内置对话输入框'), '把右孔向右移 1 mm')
    await user.click(screen.getByRole('button', { name: '发送' }))

    const retryChatBtn = await screen.findByRole('button', { name: '重试' })
    expect(document.activeElement).toBe(retryChatBtn)
  })

  it('5) 完成视图必需检查阻塞时：可撤销则聚焦「撤销本次被阻塞修改」，不可撤销则聚焦首个阻塞条款「定位来源与特征」', () => {
    const blockedCheck: M2CheckItem = {
      checkId: 'chk-right-margin',
      requirementId: 'req-right-margin',
      title: '右孔至右端面剩余材料 ≥ 13 mm',
      required: true,
      status: 'fail',
      summary: '最差边距 12.75 mm，低于要求 0.25 mm',
      linkedFeatureIds: ['obj-right-hole'],
      linkedAnnotationIds: ['ann-right-margin'],
    }

    // 5a: 可撤销场景 -> 焦点落到撤销按钮
    const { unmount } = render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialShowCompletionView={true}
        initialDraftRevision="draft-8"
        initialConnectionSnapshot={{
          connectionState: 'connected',
          source: 'local-agent',
          clientName: 'Claude Desktop',
          authorizationState: 'authorized-writable',
        }}
        initialUncommittedDrafts={[
          {
            draftRevision: 'draft-8',
            baseRevision: 'v1',
            updatedAtLabel: '刚刚',
            status: 'blocked',
            summary: '右孔右移后边距阻塞',
            canUndo: true,
          },
        ]}
        initialPreviewSnapshot={{
          currentRevision: 'draft-8',
          model: { status: 'ready', revision: 'draft-8', revisionOrder: 8, isDraft: true, fingerprint: 'fp-8' },
          drawing: { status: 'ready', revision: 'draft-8', revisionOrder: 8, isDraft: true, fingerprint: 'fp-8' },
          checks: [blockedCheck],
        }}
      />,
    )

    const undoBtn = screen.getByRole('button', { name: '撤销本次被阻塞修改' })
    expect(undoBtn).not.toBeDisabled()
    expect(document.activeElement).toBe(undoBtn)
    unmount()

    // 5b: 不可撤销场景（canUndo: false）-> 焦点落到首个阻塞条款的「定位来源与特征」按钮
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialShowCompletionView={true}
        initialDraftRevision="draft-8"
        initialConnectionSnapshot={{
          connectionState: 'connected',
          source: 'local-agent',
          clientName: 'Claude Desktop',
          authorizationState: 'authorized-writable',
        }}
        initialUncommittedDrafts={[
          {
            draftRevision: 'draft-8',
            baseRevision: 'v1',
            updatedAtLabel: '刚刚',
            status: 'blocked',
            summary: '初始导入即存在阻塞，无上一步可撤销',
            canUndo: false,
          },
        ]}
        initialPreviewSnapshot={{
          currentRevision: 'draft-8',
          model: { status: 'ready', revision: 'draft-8', revisionOrder: 8, isDraft: true, fingerprint: 'fp-8' },
          drawing: { status: 'ready', revision: 'draft-8', revisionOrder: 8, isDraft: true, fingerprint: 'fp-8' },
          checks: [blockedCheck],
        }}
      />,
    )

    expect(screen.getByRole('button', { name: '撤销本次被阻塞修改' })).toBeDisabled()
    const firstLocateBtn = screen.getAllByRole('button', { name: '定位来源与特征' })[0]
    expect(document.activeElement).toBe(firstLocateBtn)
  })
})

describe('第一部分 §3 文字+图形状态标识、窄屏降级与键盘全区切换', () => {
  it('6 种检查状态全部同时包含图形标识与文字，且窄屏降级保留模型与图纸的就绪/失败/草稿状态', () => {
    const allStatusChecks: readonly M2CheckItem[] = [
      { checkId: 'c1', requirementId: 'r1', title: '条款1', required: true, status: 'pass', summary: '通过', linkedFeatureIds: [], linkedAnnotationIds: [] },
      { checkId: 'c2', requirementId: 'r2', title: '条款2', required: true, status: 'fail', summary: '失败', linkedFeatureIds: [], linkedAnnotationIds: [] },
      { checkId: 'c3', requirementId: 'r3', title: '条款3', required: false, status: 'needsClarification', summary: '待澄清', linkedFeatureIds: [], linkedAnnotationIds: [] },
      { checkId: 'c4', requirementId: 'r4', title: '条款4', required: false, status: 'uncovered', summary: '未覆盖', linkedFeatureIds: [], linkedAnnotationIds: [] },
      { checkId: 'c5', requirementId: 'r5', title: '条款5', required: false, status: 'executionFailed', summary: '执行失败', linkedFeatureIds: [], linkedAnnotationIds: [] },
      { checkId: 'c6', requirementId: 'r6', title: '条款6', required: false, status: 'checking', summary: '检查中', linkedFeatureIds: [], linkedAnnotationIds: [] },
    ]

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialSidebarSection="checks"
        initialViewMode="split"
        forceNarrowViewport={true}
        initialDraftRevision="draft-8"
        initialPreviewSnapshot={{
          currentRevision: 'draft-8',
          model: { status: 'ready', revision: 'draft-8', revisionOrder: 8, isDraft: true, fingerprint: 'fp-8' },
          drawing: { status: 'ready', revision: 'draft-7', revisionOrder: 7, isDraft: true, fingerprint: 'fp-7' },
          drawingFailure: {
            failedRevision: 'draft-8',
            failedRevisionOrder: 8,
            reason: '投影超时',
            retryable: true,
          },
          checks: allStatusChecks,
        }}
      />,
    )

    // 检查面板：6 种检查状态同时包含图形标识与中文标签
    const checksPanel = screen.getByLabelText('检查结果面板')
    expect(within(checksPanel).getByLabelText('检查状态：通过')).toHaveTextContent('✓ 通过')
    expect(within(checksPanel).getByLabelText('检查状态：失败')).toHaveTextContent('✕ 失败')
    expect(within(checksPanel).getByLabelText('检查状态：待澄清')).toHaveTextContent('? 待澄清')
    expect(within(checksPanel).getByLabelText('检查状态：未覆盖')).toHaveTextContent('○ 未覆盖')
    expect(within(checksPanel).getByLabelText('检查状态：执行失败')).toHaveTextContent('! 执行失败')
    expect(within(checksPanel).getByLabelText('检查状态：检查中')).toHaveTextContent('◌ 检查中')

    // 窄屏降级状态栏：同时展示模型就绪(草稿)与图纸失败(保留旧图)的图形+文字
    const narrowStatus = screen.getByRole('status', { name: '窄屏标签页降级状态' })
    expect(narrowStatus).toHaveTextContent(/✓\s*模型就绪 · ✎ 草稿/)
    expect(narrowStatus).toHaveTextContent(/✕\s*图纸失败（保留 草稿 7）/)

    // 窄屏标签按钮本身也保留可访问名称与状态属性
    const viewTabs = screen.getByRole('tablist', { name: '中央画布视图切换' })
    expect(within(viewTabs).getByRole('tab', { name: '模型' })).toHaveAttribute(
      'data-artifact-status',
      'draft-ready',
    )
    expect(within(viewTabs).getByRole('tab', { name: '图纸' })).toHaveAttribute(
      'data-artifact-status',
      'failed',
    )
    expect(within(viewTabs).getByRole('tab', { name: '并排' })).toBeDisabled()
  })

  it('键盘 F6 / Shift+F6 / Alt+1..3 可在对象列表、中央画布与侧栏间完整循环切换，对象列表支持方向键/Home/End', () => {
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-2"
      />,
    )

    const workbench = screen.getByRole('main', { name: '寸链 M1 双入口工作台' })
    const objectListRegion = screen.getByLabelText('对象列表')
    const canvasRegion = screen.getByLabelText('中央画布')
    const sidebarRegion = screen.getByLabelText('主工作台侧栏')

    // F6 正向循环：对象列表 -> 中央画布 -> 侧栏 -> 对象列表
    fireEvent.keyDown(workbench, { key: 'F6' })
    expect(document.activeElement).toBe(objectListRegion)

    fireEvent.keyDown(workbench, { key: 'F6' })
    expect(document.activeElement).toBe(canvasRegion)

    fireEvent.keyDown(workbench, { key: 'F6' })
    expect(document.activeElement).toBe(sidebarRegion)

    fireEvent.keyDown(workbench, { key: 'F6' })
    expect(document.activeElement).toBe(objectListRegion)

    // Shift+F6 反向循环：对象列表 -> 侧栏 -> 中央画布
    fireEvent.keyDown(workbench, { key: 'F6', shiftKey: true })
    expect(document.activeElement).toBe(sidebarRegion)

    fireEvent.keyDown(workbench, { key: 'F6', shiftKey: true })
    expect(document.activeElement).toBe(canvasRegion)

    // Alt+1 / Alt+2 / Alt+3 直达
    fireEvent.keyDown(workbench, { key: '1', altKey: true })
    expect(document.activeElement).toBe(objectListRegion)
    fireEvent.keyDown(workbench, { key: '3', altKey: true })
    expect(document.activeElement).toBe(sidebarRegion)
    fireEvent.keyDown(workbench, { key: '2', altKey: true })
    expect(document.activeElement).toBe(canvasRegion)

    // 对象列表内部 ArrowDown / ArrowUp / End / Home
    const objButtons = within(objectListRegion).getAllByRole('button')
    expect(objButtons.length).toBeGreaterThanOrEqual(2)
    fireEvent.keyDown(objectListRegion, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(objButtons[0])
    fireEvent.keyDown(objectListRegion, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(objButtons[1])
    fireEvent.keyDown(objectListRegion, { key: 'End' })
    expect(document.activeElement).toBe(objButtons[objButtons.length - 1])
    fireEvent.keyDown(objectListRegion, { key: 'Home' })
    expect(document.activeElement).toBe(objButtons[0])
    fireEvent.keyDown(objectListRegion, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(objButtons[objButtons.length - 1])
  })
})
