/**
 * A-02 测试夹具：一个结构完整、引用自洽的 `.cunlian` 聚合。
 *
 * 只用于单元测试，不进入产品路径；尺寸链使用既有整数 q（1q=0.0001mm），
 * 不复制任何计算公式。
 */
import type { AnalysisSnapshot } from '../../history/snapshots'
import type { ChainDefinition } from '../../domain/types'
import { sha256Hex } from '../../sources/hash'
import type { ProjectFileSnapshot } from '../types'

export const SAMPLE_PROJECT_ID = 'project-a'
export const SAMPLE_PDF_BYTES = new TextEncoder().encode('%PDF-1.7 sample attachment bytes')

export function sampleChain(): ChainDefinition {
  return {
    terms: [
      {
        id: 't-h',
        symbol: 'H',
        name: '总长',
        nominalQ: 522000,
        lowerDeviationQ: -200,
        upperDeviationQ: 200,
        sign: 1,
        sourceNote: '',
        termRevision: 1,
      },
      {
        id: 't-b1',
        symbol: 'B1',
        name: '左轴承',
        nominalQ: 200000,
        lowerDeviationQ: -100,
        upperDeviationQ: 100,
        sign: -1,
        sourceNote: '',
        termRevision: 1,
      },
      {
        id: 't-s',
        symbol: 'S',
        name: '隔套',
        nominalQ: 120000,
        lowerDeviationQ: -100,
        upperDeviationQ: 100,
        sign: -1,
        sourceNote: '',
        termRevision: 1,
      },
      {
        id: 't-b2',
        symbol: 'B2',
        name: '右轴承',
        nominalQ: 200000,
        lowerDeviationQ: -100,
        upperDeviationQ: 100,
        sign: -1,
        sourceNote: '',
        termRevision: 1,
      },
    ],
    target: { minQ: 1000, maxQ: 3000 },
    assumptions: '合成示例数据',
  }
}

export async function createSampleSnapshot(): Promise<ProjectFileSnapshot> {
  const sha256 = await sha256Hex(SAMPLE_PDF_BYTES)
  const createdAt = '2026-11-09T08:00:00.000Z'
  const chain = sampleChain()
  const project = {
    id: SAMPLE_PROJECT_ID,
    schemaVersion: 4 as const,
    name: '隔套间隙演示',
    currentRevisionId: 'rev-a1',
    dimensionChain: chain,
    engineVersion: '0.1.0',
    createdAt,
    updatedAt: createdAt,
    relationRevision: 1,
    relationReview: null,
    migration: null,
    baseline: null,
    sourceFormatVersion: 2 as const,
    parts: [],
    parameters: [],
    modelRevisions: [],
    dimensionLinks: [],
    drawings: [],
  }
  const draft = {
    terms: chain.terms.map((term) => ({
      id: term.id,
      symbol: term.symbol,
      name: term.name,
      nominal: (term.nominalQ / 10000).toFixed(2),
      lower: (term.lowerDeviationQ / 10000).toFixed(2),
      upper: (term.upperDeviationQ / 10000).toFixed(2),
      sign: term.sign,
      sourceNote: term.sourceNote,
      termRevision: term.termRevision,
    })),
    targetMin: '0.1000',
    targetMax: '0.3000',
    assumptions: chain.assumptions,
    relationRevision: 1,
  }
  const document = {
    id: 'doc-1',
    projectId: SAMPLE_PROJECT_ID,
    title: '轴系装配图.pdf',
    latestRevisionId: 'sr-1',
  }
  const revision = {
    id: 'sr-1',
    projectId: SAMPLE_PROJECT_ID,
    documentId: 'doc-1',
    fileName: '轴系装配图.pdf',
    sha256,
    byteSize: SAMPLE_PDF_BYTES.byteLength,
    pageCount: 2,
    createdAt,
    blobKey: 'blob-1',
  }
  const blob = {
    blobKey: 'blob-1',
    projectId: SAMPLE_PROJECT_ID,
    sha256,
    byteSize: SAMPLE_PDF_BYTES.byteLength,
  }
  const binding = {
    id: 'bind-1',
    projectId: SAMPLE_PROJECT_ID,
    termId: 't-s',
    revisionId: 'sr-1',
    documentId: 'doc-1',
    page: 1,
    rectPdf: [10, 10, 110, 30] as [number, number, number, number],
    pageBoxPdf: [0, 0, 595, 842] as [number, number, number, number],
    note: '',
    createdAt,
    reviewedTermRevision: null,
    reviewedAt: null,
    historicalAcceptance: null,
  }
  const analysisSnapshot = {
    id: 'snap-1',
    projectId: SAMPLE_PROJECT_ID,
    projectName: project.name,
    createdAt,
    engineVersion: '0.1.0',
    reviewRulesVersion: 'rules-1',
    inputFingerprint: 'fingerprint-sample',
    definition: chain,
    draft,
    result: {
      nominalQ: 2000,
      minQ: 1500,
      maxQ: 2500,
      lowerDeviationQ: -500,
      upperDeviationQ: 500,
      toleranceQ: 1000,
      status: 'within',
      lowerMarginQ: 500,
      upperMarginQ: 500,
      contributions: [],
    },
    review: {
      items: [],
      status: 'pending',
      pendingCount: 0,
      summary: { passed: 0, pending: 0, failed: 0 },
    },
    sourceManifest: {
      documents: [document],
      revisions: [revision],
      bindings: [],
      unboundTermIds: [],
      availability: 'complete',
    },
    baseline: null,
    comparison: null,
    status: 'pending',
    pendingCount: 0,
  } as unknown as AnalysisSnapshot

  return {
    project,
    draft,
    documents: [document],
    revisions: [revision],
    bindings: [binding],
    blobs: [blob],
    events: [
      {
        id: 'event-1',
        projectId: SAMPLE_PROJECT_ID,
        type: 'source_import',
        createdAt,
      },
    ],
    analysisSnapshots: [analysisSnapshot],
    importSnapshots: [],
    migrationBackups: [],
    legacyArchive: null,
    fileRevisions: [
      {
        revisionId: 'rev-a1',
        parentId: null,
        createdAt,
        reason: '初始版本',
        project,
      },
    ],
    attachments: [{ blobKey: 'blob-1', bytes: SAMPLE_PDF_BYTES }],
    missingAttachments: [],
    snapshotReferences: [
      { snapshotId: 'snap-1', revisionIds: ['sr-1'], blobKeys: ['blob-1'] },
    ],
    manifestMeta: {
      createdAt,
      writer: {
        appVersion: '0.0.0-test',
        electronVersion: '45.2.3',
        engineVersion: '0.1.0',
      },
      migration: null,
    },
  }
}
