import { isM1SpacerDraft } from '../../../desktop/shared/project-agent/m1-fields.ts'
import type {
  M1Activity,
  M1ContextFields,
  M1CreateSpacerDraft,
  M1SpacerDraft,
} from '../../../desktop/shared/project-agent/m1-fields.ts'
import type { M1Anchor, M1Question } from './m1FieldPresentation.ts'

export const M1_SYNTHETIC_FIXTURE_META = Object.freeze({
  synthetic: true as const,
  badge: '模拟' as const,
  productionApiConnected: false as const,
  formalSaveEnabled: false as const,
})

const HEX_64 = 'a'.repeat(64)

function resolveSyntheticFingerprint(): string {
  const candidates = [HEX_64, `sha256:${HEX_64}`]
  for (const candidate of candidates) {
    const probe: M1SpacerDraft = {
      draftRevision: 'rev-probe',
      innerDiameterQ: 200000,
      outerDiameterQ: 320000,
      lengthQ: 150000,
      sources: {
        innerDiameterQ: { type: 'userInput' },
        outerDiameterQ: { type: 'userInput' },
        lengthQ: {
          type: 'document',
          anchor: {
            documentRef: 'doc-probe',
            documentFingerprint: candidate,
            page: 1,
            region: null,
            excerpt: 'L = 15 mm',
          },
        },
      },
      question: null,
    }
    if (isM1SpacerDraft(probe)) {
      return candidate
    }
  }
  return HEX_64
}

export const M1_SYNTHETIC_DOCUMENT_FINGERPRINT = resolveSyntheticFingerprint()

export function createSyntheticM1Anchor(overrides?: Partial<M1Anchor>): M1Anchor {
  return {
    documentRef: 'doc-shaft-spec-01',
    documentFingerprint: M1_SYNTHETIC_DOCUMENT_FINGERPRINT,
    page: 2,
    region: {
      x: 12000,
      y: 24000,
      width: 18000,
      height: 4500,
      unit: 'pdfPoint1000',
    },
    excerpt: '隔套尺寸：内径 20 mm，外径 32 mm，长度 15 mm',
    ...overrides,
  }
}

export function createSyntheticM1Question(overrides?: Partial<M1Question>): M1Question {
  return {
    questionId: 'q-spacer-length-01',
    reason: 'conflict',
    prompt: '图纸标注长度存在两处不同值，请确认最终长度',
    anchors: [createSyntheticM1Anchor()],
    ...overrides,
  }
}

export function createSyntheticM1SpacerDraft(
  overrides?: Partial<M1SpacerDraft>,
): M1SpacerDraft {
  return {
    draftRevision: 'draft-rev-1',
    innerDiameterQ: 200000,
    outerDiameterQ: 320000,
    lengthQ: 150000,
    sources: {
      innerDiameterQ: { type: 'userInput' },
      outerDiameterQ: {
        type: 'document',
        anchor: createSyntheticM1Anchor(),
      },
      lengthQ: {
        type: 'document',
        anchor: createSyntheticM1Anchor({ region: null, excerpt: '长度 15.0000 mm' }),
      },
    },
    question: null,
    ...overrides,
  }
}

export function createSyntheticM1CreateSpacerDraft(
  overrides?: Partial<M1CreateSpacerDraft>,
): M1CreateSpacerDraft {
  return {
    type: 'createSpacerDraft',
    innerDiameterQ: 200000,
    outerDiameterQ: 320000,
    lengthQ: 150000,
    ...overrides,
  }
}

export function createSyntheticM1Activity(overrides?: Partial<M1Activity>): M1Activity {
  return {
    taskId: 'task-01',
    projectId: 'proj-alpha',
    source: 'internal',
    baseRevision: 'base-rev-1',
    draftRevision: 'draft-rev-1',
    status: 'running',
    lastStep: '解析隔套参数',
    question: null,
    errorCode: null,
    updatedAtMs: 1700000000000,
    ...overrides,
  }
}

export function createSyntheticM1ContextFields(
  overrides?: {
    snapshot?: Partial<M1ContextFields['snapshot']>
    activities?: M1Activity[]
  },
): M1ContextFields {
  const snapshot: M1ContextFields['snapshot'] = {
    projectId: 'proj-alpha',
    draftRevision: 'draft-rev-1',
    cursor: 10,
    connection: 'connected',
    authorization: { authorized: true, canWrite: true },
    writer: { epoch: 2, occupied: true },
    spacerDraft: createSyntheticM1SpacerDraft(),
    ...overrides?.snapshot,
  }
  const activities = overrides?.activities ?? [
    createSyntheticM1Activity({ projectId: snapshot.projectId }),
  ]
  return { snapshot, activities }
}

export function createSyntheticM1ContextFixture(
  overrides?: {
    snapshot?: Partial<M1ContextFields['snapshot']>
    activities?: M1Activity[]
  },
): Readonly<typeof M1_SYNTHETIC_FIXTURE_META & { readonly data: M1ContextFields }> {
  return Object.freeze({
    ...M1_SYNTHETIC_FIXTURE_META,
    data: createSyntheticM1ContextFields(overrides),
  })
}
