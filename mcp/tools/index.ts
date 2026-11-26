/** 冻结的五个通用工具及本地源码 stdio 扩展。 */

import { assembly3dDefinition, runAssembly3d } from './assembly-3d'
import { calcChainDefinition, runCalcChain } from './calc-chain'
import { checkRequirementDefinition, runCheckRequirement } from './check-requirement'
import { describeProjectDefinition, runDescribeProject } from './describe-project'
import { readTaskbookDefinition, runReadTaskbook } from './read-taskbook'
import { renderDrawingDefinition, runRenderDrawing } from './render-drawing'

export interface ToolSpec {
  readonly definition: {
    readonly name: string
    readonly title: string
    readonly description: string
    readonly inputSchema: Record<string, unknown>
    readonly outputSchema?: Record<string, unknown>
    readonly annotations?: Record<string, unknown>
  }
  readonly run: (arguments_: unknown) => Promise<Record<string, unknown>>
}

export const TOOLS: readonly ToolSpec[] = [
  { definition: readTaskbookDefinition, run: runReadTaskbook },
  { definition: calcChainDefinition, run: runCalcChain },
  { definition: checkRequirementDefinition, run: runCheckRequirement },
  { definition: renderDrawingDefinition, run: runRenderDrawing },
  { definition: describeProjectDefinition, run: runDescribeProject },
]

export const STDIO_TOOLS: readonly ToolSpec[] = [
  ...TOOLS,
  { definition: assembly3dDefinition, run: runAssembly3d },
]

export function findTool(name: string): ToolSpec | null {
  return STDIO_TOOLS.find((tool) => tool.definition.name === name) ?? null
}
