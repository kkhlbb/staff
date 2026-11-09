/**
 * 新建项目的默认聚合（A-04）。
 *
 * 只构造 A 批次允许的内容：单条尺寸链 + 一个初始文件版本；
 * parts/parameters/modelRevisions/dimensionLinks/drawings 一律为空，
 * 不为未来 3D/图纸伪造数据，也不建立 Part/DimensionLink。
 *
 * 模板：
 * - `chain-demo`：任务卡 §7 A-MAC-2 的尺寸链示例（H=52.20±0.02，
 *   B1/B2=20.00±0.01，S=12.00±0.01，目标 [0.1000, 0.3000]）；
 * - `empty`：两个空白组成环的起点（领域校验要求 2..20 环且基本尺寸 > 0，
 *   所以“空”只能是没有业务含义的占位值，不是零环）。
 */
import { randomUUID } from 'node:crypto'
import { ENGINE_VERSION } from '../../src/domain/calculate'
import type { ChainDefinition, DimensionTerm } from '../../src/domain/types'
import { formatMm } from '../../src/domain/units'
import type { ProjectFileProject, ProjectFileSnapshot } from '../../src/project-file/types'
import type { WorkspaceDraft } from '../../src/workspace/draft'

export type NewProjectTemplate = 'empty' | 'chain-demo'

export interface NewProjectOptions {
  name: string
  template: NewProjectTemplate
  appVersion: string
  electronVersion: string
  now?: () => Date
  newId?: () => string
}

function term(
  id: string,
  symbol: string,
  name: string,
  nominalQ: number,
  deviationQ: number,
  sign: 1 | -1,
): DimensionTerm {
  return {
    id,
    symbol,
    name,
    nominalQ,
    lowerDeviationQ: -deviationQ,
    upperDeviationQ: deviationQ,
    sign,
    sourceNote: '',
    termRevision: 1,
  }
}

function demoChain(): ChainDefinition {
  return {
    terms: [
      term('t-h', 'H', '总长', 522000, 200, 1),
      term('t-b1', 'B1', '左轴承', 200000, 100, -1),
      term('t-s', 'S', '隔套', 120000, 100, -1),
      term('t-b2', 'B2', '右轴承', 200000, 100, -1),
    ],
    target: { minQ: 1000, maxQ: 3000 },
    assumptions: '尺寸链示例（A）',
  }
}

function emptyChain(): ChainDefinition {
  return {
    terms: [
      term('t-a', 'A', '组成环 A', 100000, 0, 1),
      term('t-b', 'B', '组成环 B', 100000, 0, -1),
    ],
    target: null,
    assumptions: '',
  }
}

/** 领域链 → 输入草稿；与 src/workspace/draft.ts 的 chainToDraft 同规则，不引入 React。 */
function chainToDraft(chain: ChainDefinition): WorkspaceDraft {
  return {
    terms: chain.terms.map((item) => ({
      id: item.id,
      symbol: item.symbol,
      name: item.name,
      nominal: formatMm(item.nominalQ),
      lower: formatMm(item.lowerDeviationQ),
      upper: formatMm(item.upperDeviationQ),
      sign: item.sign,
      sourceNote: item.sourceNote,
      termRevision: item.termRevision,
    })),
    targetMin: chain.target === null ? '' : formatMm(chain.target.minQ),
    targetMax: chain.target === null ? '' : formatMm(chain.target.maxQ),
    assumptions: chain.assumptions,
    relationRevision: 0,
  }
}

export function createNewProjectSnapshot(options: NewProjectOptions): ProjectFileSnapshot {
  const now = options.now ?? (() => new Date())
  const newId = options.newId ?? (() => randomUUID())
  const createdAt = now().toISOString()
  const chain = options.template === 'chain-demo' ? demoChain() : emptyChain()
  const projectId = `project-${newId()}`
  const revisionId = `rev-${newId()}`

  const project: ProjectFileProject = {
    id: projectId,
    schemaVersion: 3,
    name: options.name,
    currentRevisionId: revisionId,
    dimensionChain: chain,
    engineVersion: ENGINE_VERSION,
    createdAt,
    updatedAt: createdAt,
    relationRevision: 0,
    relationReview: null,
    migration: null,
    baseline: null,
    parts: [],
    parameters: [],
    modelRevisions: [],
    dimensionLinks: [],
    drawings: [],
  }

  return {
    project,
    draft: chainToDraft(chain),
    documents: [],
    revisions: [],
    bindings: [],
    blobs: [],
    events: [],
    analysisSnapshots: [],
    importSnapshots: [],
    migrationBackups: [],
    legacyArchive: null,
    fileRevisions: [
      {
        revisionId,
        parentId: null,
        createdAt,
        reason: '新建项目',
        project,
      },
    ],
    attachments: [],
    missingAttachments: [],
    snapshotReferences: [],
    manifestMeta: {
      createdAt,
      writer: {
        appVersion: options.appVersion,
        electronVersion: options.electronVersion,
        engineVersion: ENGINE_VERSION,
      },
      migration: null,
    },
  }
}
