import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 旧桥回归：window.cunlian 原有 18 个函数必须存在；B2 只允许新增。
 * 这里做静态源码检查，补足“签名由类型系统保证、行为由既有测试保证”的缺口。
 */
const PRELOAD = fileURLToPath(new URL('../preload/index.ts', import.meta.url))

const LEGACY_FUNCTIONS = [
  'newProject',
  'openProject',
  'stageDraft',
  'saveProject',
  'saveProjectAs',
  'listRecent',
  'relinkRecent',
  'listRecovery',
  'restoreRecovery',
  'reattachSession',
  'readAttachment',
  'revealProject',
  'requestClose',
  'inspectV2',
  'commitV2',
  'onMenuAction',
  'onEditorFlush',
  'respondEditorFlush',
] as const

const ADDED_FUNCTIONS = [
  'pickModel',
  'readModel',
  'commitModel',
  'releaseModel',
  'linkModel',
  // C：图纸更新与两种矢量导出（仍只增不改旧函数）。
  'updateSpacerDrawing',
  'exportDrawingPdf',
  'exportDrawingSvg',
  // D：参数联动草稿/预览/确认/绑定/对比/恢复。
  'stageChangeDraft',
  'previewChange',
  'applyChange',
  'bindParameter',
  'unbindParameter',
  'compareDrawings',
  'restoreRevisionDraft',
  // V3.5：桌面 PDF 与任务书条款。
  'importSource',
  'stageRequirementEdit',
  'confirmRequirement',
  // V3.6：任务书 PDF 提取与逐条决定（仍只增不改旧函数）。
  'runExtraction',
  'decideExtraction',
  'cancelExtraction',
  // V3.6 多草稿：删除被取代的旧规则版本草稿（仍只增不改旧函数）。
  'deleteExtractionDraft',
  // V4 stage 1: only specific tool functions, no generic invoke escape.
  'getProjectContext', 'getConfirmedInputs', 'applyConfirmedInputs',
  'stageParameterChange', 'previewAndCheck',
  // V4 stage 3: 任务侧栏、授权提交与来源定位（仍只增不改旧函数）。
  'agentStart', 'agentCancel', 'agentResume', 'agentTaskState', 'agentProviderStatus',
  'agentPreviewSummary', 'issueAgentApproval', 'commitApprovedDraft', 'locateEvidence',
  // V4 stage 4: 真实供应商配置（只写 Keychain）、连接测试与受控导出（仍只增不改）。
  'saveAgentProvider', 'testAgentProvider', 'clearAgentProviderKey', 'exportApprovedVersion',
  'onAgentEvent',
  // DXF 导出 v1：R12 / 2000（仍只增不改旧函数）。
  'exportDrawingDxfR12', 'exportDrawingDxf2000',
  // 内置 DXF 看图（只读）：对话框选文件与启动参数排队文件（仍只增不改旧函数）。
  'openDxf', 'takePendingDxf',
  // ADR-001 第 3 步：无任务书入口（用户界面触发；仍只增不改旧函数）。
  'intentCreateProject', 'intentState', 'intentApply', 'intentPreview',
  'intentConfirmCandidate', 'intentIssueApproval',
] as const

describe('B2/C preload 契约', () => {
  const source = readFileSync(PRELOAD, 'utf8')

  it('原有 18 个函数仍在 api 对象中，B2/C 只允许新增具体函数', () => {
    for (const name of [...LEGACY_FUNCTIONS, ...ADDED_FUNCTIONS]) {
      expect(source).toContain(`\n  ${name}:`)
    }
    // 除上述具体函数外，不得暴露通用 invoke/send/on 转义口。
    const apiBlock = source.slice(source.indexOf('const api: CunlianApi = {'), source.indexOf('contextBridge.exposeInMainWorld'))
    const keys = [...apiBlock.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => match[1])
    expect(keys.sort()).toEqual([...LEGACY_FUNCTIONS, ...ADDED_FUNCTIONS].sort())
    expect(apiBlock).not.toMatch(/^ {2}(invoke|send|on):/m)
  })

  it('5 个模型通道各有独立 channel 常量，不复用 source:read', () => {
    expect(source).toContain('IPC_CHANNELS.modelPick')
    expect(source).toContain('IPC_CHANNELS.modelRead')
    expect(source).toContain('IPC_CHANNELS.modelCommit')
    expect(source).toContain('IPC_CHANNELS.modelRelease')
    expect(source).toContain('IPC_CHANNELS.modelLink')
    // source:read 仍只服务 readAttachment 一处，模型读取走 modelRead。
    expect(source.match(/IPC_CHANNELS\.sourceRead/g) ?? []).toHaveLength(1)
  })
})
