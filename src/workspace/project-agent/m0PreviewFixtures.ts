import rawCases from '../../../desktop/shared/project-agent/__fixtures__/synthetic/snapshot-cases.json'
import {
  M0_CAPABILITIES,
  PROJECT_AGENT_VERSION,
  reduceProjectAgentEvent,
  startProjectAgentStream,
} from '../../../desktop/shared/project-agent'
import type { ProjectAgentViewInput } from './presentation'

type Snapshot = ProjectAgentViewInput['snapshot']
type StreamEvent = Parameters<typeof reduceProjectAgentEvent>[1]

export const M0_FIXTURE_IDS = [
  'offline-reopen',
  'connected-unapproved',
  'model-before-drawing',
  'duplicate-sequence',
  'late-old-revision',
  'sequence-gap',
  'cancelled-late-result',
  'refresh-context',
  'aligned-per-step-attempts',
] as const

type FixtureEntry = { id: string; snapshot: Snapshot; events: StreamEvent[] }

function isSnapshot(value: unknown): value is Snapshot {
  return typeof value === 'object' && value !== null && 'draftRevision' in value
}

function isEvent(value: unknown): value is StreamEvent {
  return typeof value === 'object' && value !== null
}

function parseFixtures(raw: unknown): Map<string, FixtureEntry> {
  const map = new Map<string, FixtureEntry>()
  const push = (id: string, item: unknown) => {
    if (typeof item !== 'object' || item === null || !('snapshot' in item) || !isSnapshot(item.snapshot)) return
    const events = 'events' in item && Array.isArray(item.events) ? item.events.filter(isEvent) : []
    map.set(id, { id, snapshot: item.snapshot, events })
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string') push(item.id, item)
    }
  } else if (typeof raw === 'object' && raw !== null) {
    const list = 'cases' in raw && Array.isArray(raw.cases) ? raw.cases : 'fixtures' in raw && Array.isArray(raw.fixtures) ? raw.fixtures : null
    if (list) {
      for (const item of list) {
        if (typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string') push(item.id, item)
      }
    } else {
      for (const [k, v] of Object.entries(raw)) push(k, v)
    }
  }
  return map
}

const FIXTURE_MAP = parseFixtures(rawCases)

export function resolveM0Fixture(id: string): { snapshot: Snapshot; needsSnapshot: boolean } {
  const entry = FIXTURE_MAP.get(id)
  if (!entry) throw new Error(`Unknown M0 fixture: ${id}`)
  let state = startProjectAgentStream(entry.snapshot)
  for (const event of entry.events) {
    state = reduceProjectAgentEvent(state, event)
  }
  return { snapshot: state.snapshot, needsSnapshot: state.needsSnapshot }
}

export function createEmptyObservationSnapshot(): Snapshot {
  return {
    version: PROJECT_AGENT_VERSION,
    projectId: 'm0-empty-observation',
    baseRevision: null,
    draftRevision: null,
    cursor: 0,
    connection: { status: 'disconnected', source: null },
    authorization: { authorized: false, canWrite: false },
    writer: { epoch: 0, callerId: null },
    selection: null,
    capabilities: M0_CAPABILITIES,
    activeJobId: null,
    jobs: [],
    currentManifest: null,
    fallbackArtifacts: [],
  }
}
