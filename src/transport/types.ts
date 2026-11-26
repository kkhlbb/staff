import type { CunlianApi } from '../../desktop/shared/contracts'
import type { M1StageChangeRequest, M1StageResult, M1WriterContext } from '../../desktop/main/project-agent/m1StageContracts'
import type { M1Activity, M1ContextFields, M1EventPageFields } from '../../desktop/shared/project-agent/m1-fields'
import type { M2CheckItem, M2ModelMeshInput, M2Result } from '../../desktop/shared/project-agent/m2-preview'
import type { M3CommitApprovedDraftRequest, M3CommitApprovedDraftResult } from '../../desktop/shared/project-agent/m3-lifecycle'
import type { ChainDefinition, ChainResult } from '../domain/types'
import type { MonteCarloOptions, StatisticalSummary } from '../domain/statistics'
import type { ReportViewportSnapshots } from '../report/types'
import type { EvidenceRef } from '../document-extraction/types'
import type {
  AssemblyModelV1, AssemblyPhysicsSpec, CompliantModelSpec, DatumDefinition,
  GdtFeatureControl, MicMatrixPayloadV1, ProjectFileAttachmentRef,
} from '../project-file/types'
import type { GdtValidationWarning } from '../project-file/assembly3d'

export type { GdtValidationWarning } from '../project-file/assembly3d'

export const FEATURE_3D_ASSEMBLY_M1 = false

export interface ProjectRef {
  projectId: string
}

export interface ProjectSummary extends ProjectRef {
  name: string
  baseRevision: string | null
  draftRevision: string | null
}

export interface CreateProjectRequest {
  name: string
  template: 'empty' | 'chain-demo' | 'builtin-mounting-plate' | 'builtin-shaft-spacer'
}

export interface ImportProjectRequest {
  kind: 'cunlian' | 'pdf' | 'step'
  fileName: string
  bytes: Uint8Array
}

export interface DraftRef extends ProjectRef {
  draftRevision: string
}

export interface WriterRequest extends ProjectRef {
  expectedWriterEpoch: number
}

export interface WriterState {
  writerEpoch: number
  baseRevision: string
  draftRevision: string | null
}

export interface CommitDraftRequest extends Omit<M3CommitApprovedDraftRequest, 'checkSetFingerprint'> {
  checksetFingerprint: string
  webhook?: { url: string }
}

export type CommitDraftResult = Omit<M3CommitApprovedDraftResult, 'checkSetFingerprint'> & {
  checksetFingerprint: string
}

export interface AttachmentUpload extends ProjectRef {
  kind: 'pdf' | 'stl' | 'step'
  fileName: string
  bytes: Uint8Array
}

export interface GeometryRequest extends DraftRef {
  assembly3d?: AssemblyModelV1
}

export interface CheckSet extends DraftRef {
  checksetFingerprint: string
  checks: readonly M2CheckItem[]
  evidenceByCheckId?: Readonly<Record<string, readonly EvidenceRef[]>>
}

export interface SimulationRequest extends DraftRef {
  chain: ChainDefinition
  monteCarlo?: MonteCarloOptions
}

export interface SimulationResult {
  extreme: ChainResult
  statistical: StatisticalSummary | null
  compliant?: CompliantSimulationSummary
  displacementFields?: readonly PartDisplacementField[]
}

export interface GdtContributionItem {
  gdtId: string
  label: string
  kind: GdtFeatureControl['kind']
  varianceSharePct: number
  bonusMeanMm: number
  datumShiftContributionPct: number
}

/** Draft-only upserts bound to the active writer and both revisions. */
interface GdtStageRequest<T> extends WriterRequest {
  baseRevision: string
  expectedDraftRevision: string | null
  idempotencyKey: string
  items: readonly { value: T; evidence: readonly EvidenceRef[] }[]
}

export type StageDatumRequest = GdtStageRequest<DatumDefinition>
export type StageGdtRequest = GdtStageRequest<GdtFeatureControl>

export interface GdtStageResult extends DraftRef {
  warnings: readonly GdtValidationWarning[]
}

export interface GdtWhatIfEdit {
  gdtId: string
  toleranceQ?: GdtFeatureControl['toleranceQ']
  modifier?: GdtFeatureControl['modifier']
}

export interface AnalyzeGdtStackupRequest extends DraftRef, WriterRequest {
  monteCarlo: MonteCarloOptions
  edits?: readonly GdtWhatIfEdit[]
}

export interface GdtStackupMetrics {
  cpk: number | null
  ppm: number
  threeSigmaIntervalMm: readonly [number, number]
  contributions: readonly GdtContributionItem[]
  warnings: readonly GdtValidationWarning[]
}

export interface AnalyzeGdtStackupResult extends DraftRef {
  monteCarlo: MonteCarloOptions
  baseline: GdtStackupMetrics
  whatIf?: GdtStackupMetrics
}

export type CompliantStackupMetrics = Pick<GdtStackupMetrics, 'cpk' | 'ppm' | 'threeSigmaIntervalMm'>

/** Uses the same variance percentage scale and denominator as GD&T contributions. */
export interface FlexContributionItem extends Pick<GdtContributionItem, 'label' | 'varianceSharePct'> {
  modelId: string
  kind: CompliantModelSpec['kind'] | 'mic-matrix'
}

export interface CompliantSimulationSummary {
  rigidBaseline: CompliantStackupMetrics
  compliantResult: CompliantStackupMetrics
  /** Compliant Cpk minus rigid Cpk, or null when either Cpk is unavailable. */
  flexDeltaCpk: number | null
  flexContributionItems: readonly FlexContributionItem[]
}

export interface PartDisplacementField {
  partId: string
  maxDisplacementMm: number
  minDisplacementMm: number
  samples: readonly {
    posMm: readonly [number, number, number]
    dispMm: readonly [number, number, number]
    magMm: number
  }[]
}

/** Adapter ID, such as calculix or gmsh, with the local probe result. */
export type FeaSidecarStatus = { solver: string } & (
  | { available: true; version: string }
  | { available: false; reason?: string }
)

interface PhysicsDraftWriteRequest extends WriterRequest {
  baseRevision: string
  expectedDraftRevision: string | null
  idempotencyKey: string
}

export type PhysicsPatch = Omit<AssemblyPhysicsSpec, 'micMatrixRef'>

export interface StagePhysicsRequest extends PhysicsDraftWriteRequest {
  /** Each supplied field replaces that field in the draft physics object. */
  physics: PhysicsPatch
  /** JSON Pointers relative to physics, with at least one EvidenceRef per changed engineering input. */
  evidenceByField: Readonly<Record<string, readonly EvidenceRef[]>>
}

export interface StagePhysicsResult extends DraftRef {
  physics: AssemblyPhysicsSpec
}

export interface ImportMicMatrixRequest extends PhysicsDraftWriteRequest {
  fileName: string
  payload: MicMatrixPayloadV1
  evidence: readonly EvidenceRef[]
}

export interface ImportMicMatrixResult extends DraftRef {
  attachment: ProjectFileAttachmentRef & { kind: 'mic-matrix' }
}

export interface AnalyzeCompliantStackupRequest extends DraftRef, WriterRequest {
  monteCarlo: MonteCarloOptions
  /** Temporary trial values. They are never written to a revision. */
  whatIf?: PhysicsPatch
}

export interface AnalyzeCompliantStackupResult extends DraftRef {
  monteCarlo: MonteCarloOptions
  summary: CompliantSimulationSummary
  displacementFields: readonly PartDisplacementField[]
}

export interface DrawingRequest extends DraftRef {
  format: 'svg' | 'dxf-r12' | 'dxf-2000'
}

export interface ExportSimulationReportRequest extends ProjectRef {
  format: 'html' | 'pdf' | 'csv' | 'json'
  includeSnapshots?: boolean
  viewportSnapshots?: ReportViewportSnapshots
  seed?: number
}

export type ExportSimulationReportResult = {
  fileName: string
  mimeType: 'text/html' | 'application/pdf' | 'text/csv' | 'application/json'
  /** Lowercase SHA-256 hex of the exported file bytes. */
  sha256: string
  revision: string
  checksetFingerprint: string
} & (
  /** PDF is base64; other inline formats carry UTF-8 text. */
  | { content: string; filePath?: never }
  | { filePath: string; content?: never }
)

export interface TransportCapabilities {
  attachments: readonly AttachmentUpload['kind'][]
  drawingFormats: readonly DrawingRequest['format'][]
  writerLeases: boolean
  modelConnection: boolean
  FEATURE_3D_ASSEMBLY_M1: boolean
}

/** Desktop adapter surface. Type-only dependency on the shared preload whitelist. */
export type PreloadTransport = CunlianApi

/** Shared project operations. Desktop adapters also preserve the preload-specific calls. */
export interface Transport {
  listProjects(): Promise<M2Result<{ projects: ProjectSummary[] }>>
  createProject(request: CreateProjectRequest): Promise<M2Result<ProjectSummary>>
  importProject(request: ImportProjectRequest): Promise<M2Result<ProjectSummary>>
  getProject(request: ProjectRef): Promise<M2Result<ProjectSummary>>
  readAttachmentBytes(request: ProjectRef & { attachmentId: string }): Promise<M2Result<Uint8Array>>
  capabilities(): Promise<M2Result<TransportCapabilities>>
  uploadAttachment(request: AttachmentUpload): Promise<M2Result<ProjectFileAttachmentRef>>
  buildGeometry(request: GeometryRequest): Promise<M2Result<DraftRef & { geometryFingerprint: string }>>
  triangulate(request: DraftRef): Promise<M2Result<M2ModelMeshInput>>
  runChecks(request: DraftRef): Promise<M2Result<CheckSet>>
  runSimulation(request: SimulationRequest): Promise<M2Result<SimulationResult>>
  /** Read-only, available on hosts implementing the simulation report export contract. */
  exportSimulationReport?(request: ExportSimulationReportRequest): Promise<M2Result<ExportSimulationReportResult>>
  getDrawing(request: DrawingRequest): Promise<M2Result<{ bytes: Uint8Array; fingerprint: string }>>
  acquireWriter(request: WriterRequest): Promise<M2Result<WriterState>>
  takeOverWriter(request: WriterRequest): Promise<M2Result<WriterState>>
  revokeWriter(request: ProjectRef): Promise<M2Result<{ revoked: true }>>
  readWriterContext(request: ProjectRef): Promise<M2Result<M1WriterContext & { mountingPlateDraftRevision?: string }>>
  stageChange(request: ProjectRef & { change: M1StageChangeRequest }): Promise<M2Result<M1StageResult>>
  /** Available on hosts implementing the gated GD&T tool contract. */
  stageDatum?(request: StageDatumRequest): Promise<M2Result<GdtStageResult>>
  stageGdt?(request: StageGdtRequest): Promise<M2Result<GdtStageResult>>
  analyzeGdtStackup?(request: AnalyzeGdtStackupRequest): Promise<M2Result<AnalyzeGdtStackupResult>>
  /** Optional until the host implements the M4 draft and analysis tools. */
  stagePhysics?(request: StagePhysicsRequest): Promise<M2Result<StagePhysicsResult>>
  importMicMatrix?(request: ImportMicMatrixRequest): Promise<M2Result<ImportMicMatrixResult>>
  analyzeCompliantStackup?(request: AnalyzeCompliantStackupRequest): Promise<M2Result<AnalyzeCompliantStackupResult>>
  /** Requires explicit, single-use human confirmation bound to this draft and check set. */
  commitDraft(request: CommitDraftRequest): Promise<M2Result<CommitDraftResult>>
  authorizeProject(request: ProjectRef): Promise<M2Result<ProjectRef & { authorized: true }>>
  getContext(request: ProjectRef): Promise<M2Result<M1ContextFields & { baseRevision: string }>>
  getExternalActivities(request: ProjectRef): Promise<M2Result<{ activities: M1Activity[]; draftRevision: string | null }>>
  readProjectEvents(request: ProjectRef & { afterSequence?: number; limit?: number }): Promise<M2Result<M1EventPageFields>>
  getReview(request: DraftRef): Promise<M2Result<{ review: CheckSet; summary: string; baseRevision: string | null }>>
  getCommitStatus(request: DraftRef): Promise<M2Result<
    { state: 'awaiting-confirmation' } | { state: 'committed'; result: CommitDraftResult }
  >>
  getConnectionStatus: PreloadTransport['getM1ConnectionStatus']
  testModelConnection: PreloadTransport['testM1ModelApiConnection']
  listModels: PreloadTransport['listM1ModelApiModels']
}

export type DesktopTransport = Transport & PreloadTransport
