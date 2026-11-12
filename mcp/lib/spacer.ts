/**
 * 隔套参数 → 尺寸链的**接线**（不是算法）。
 *
 * 链结构来自主进程的新建项目模板 `createNewProjectSnapshot`；参数解析与预览
 * 重算分别调用既有的 `parseSpacerParameters` 与 `computeChange`（后者内部走
 * `src/domain/calculate.ts`）。本文件只决定“用哪些既有函数、传什么数据”，
 * 不写任何公差/极限公式。
 */
import { parseSpacerParameters } from '../../src/parts/spacerParameters'
import { SPACER_PARAMETER_IDS, SPACER_PART_ID, USER_INPUT_BASIS } from '../../src/drawing/types'
import { DEFAULT_FRAME_FIELDS, computeChange } from '../../src/revisions/compute'
import type { ChangeComputation } from '../../src/revisions/types'
import type {
  ProjectFileParameterBindingLink,
  ProjectFileSnapshot,
  ProjectFileSpacerParameter,
} from '../../src/project-file/types'
import { createNewProjectSnapshot } from '../../desktop/main/newProject'
import type { DrawingFrameFields } from '../../src/drawing/types'
import { formatMm } from '../../src/domain/units'
import { mcpLog } from './log'

const MCP_EPOCH = '1970-01-01T00:00:00.000Z'

/** 只读计算用的固定项目身份：同一输入必须得到同一图纸/链结果。 */
export const MCP_PROJECT_ID = 'project-mcp-readonly'
export const MCP_REVISION_ID = 'rev-mcp-readonly'
export const MCP_DRAWING_ID = 'drawing:project-mcp-readonly:spacer'

export const MCP_PROVENANCE_NOTE = '全部数值来自 MCP 调用参数（用户输入），无外部文件出处。'

function spacerFactorySnapshot(): ProjectFileSnapshot {
  const snapshot = createNewProjectSnapshot({
    name: 'MCP 只读计算',
    template: 'chain-demo',
    appVersion: 'mcp-server',
    electronVersion: 'n/a',
    now: () => new Date(MCP_EPOCH),
    newId: () => 'mcp-readonly',
  })
  return {
    ...snapshot,
    project: { ...snapshot.project, id: MCP_PROJECT_ID, currentRevisionId: MCP_REVISION_ID },
  }
}

/** 隔套三参数（q）→ 已校验的项目参数记录；非法值由 parseSpacerParameters 报错。 */
export function spacerParametersFromQ(input: {
  innerDiameterQ: number
  outerDiameterQ: number
  lengthQ: number
}): ProjectFileSpacerParameter[] {
  const parsed = parseSpacerParameters({
    innerDiameter: formatMm(input.innerDiameterQ),
    outerDiameter: formatMm(input.outerDiameterQ),
    length: formatMm(input.lengthQ),
  })
  if (!parsed.ok) {
    throw new Error(`${parsed.field}: ${parsed.message}`)
  }
  return parsed.parameters.map((parameter) => ({ ...parameter, parameterRevision: 1 }))
}

function lengthBinding(): ProjectFileParameterBindingLink {
  return {
    kind: 'parameter-binding',
    bindingId: 'binding:mcp:spacer-length',
    termId: 't-s',
    partId: SPACER_PART_ID,
    parameterId: SPACER_PARAMETER_IDS.length,
    syncField: 'nominal',
    createdAt: MCP_EPOCH,
  }
}

/**
 * 与服务端预览完全同一条计算路径：参数 → 绑定 → computeChange → calculateChain。
 * 返回的 `result` 是内核的 ChainResult，q 可直接与服务端对数。
 */
export function computeSpacerChain(input: {
  innerDiameterQ: number
  outerDiameterQ: number
  lengthQ: number
}): ChangeComputation {
  const snapshot = spacerFactorySnapshot()
  const parameters = spacerParametersFromQ(input)
  mcpLog(
    `calc_chain: 走 computeChange（project=${MCP_PROJECT_ID}，lengthQ=${input.lengthQ}），未在 MCP 内另写公式`,
  )
  return computeChange(
    snapshot,
    { parameters, bindings: [lengthBinding()] },
    { revisionId: MCP_REVISION_ID, now: MCP_EPOCH },
  )
}

/** 出图用的标题栏：依据栏强制写「用户输入，无外部原文件」。 */
export function mcpFrameFields(versionText: string): DrawingFrameFields {
  return { ...DEFAULT_FRAME_FIELDS, version: versionText, basis: USER_INPUT_BASIS }
}
