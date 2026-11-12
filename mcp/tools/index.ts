/** 五个工具的注册表：server 只认这里列出的名字，不提供未实现/空壳工具。 */

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

export function findTool(name: string): ToolSpec | null {
  return TOOLS.find((tool) => tool.definition.name === name) ?? null
}
