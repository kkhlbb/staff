// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentReadEvidenceList } from './AgentReadEvidenceList'
import { uiDiagnosticText, uiSourceVersionLabel, uiVersionLabel } from './uiIdentity'

afterEach(cleanup)
const revisionId = 'rev-a-bdeabc56-47b0-46a3-bd41-11758a2427d2'

describe('UI identity presentation', () => {
  it('renders numbered versions only for actual positive integer sequences', () => {
    expect(uiVersionLabel(3)).toBe('第 3 版')
    for (const sequence of [undefined, null, 0, -1, 1.5, NaN]) {
      expect(uiVersionLabel(sequence)).toBe('未命名版本')
    }
  })
  it('numbers immutable source versions within their own document', () => {
    const revisions = [
      { id: revisionId, documentId: 'doc-a', createdAt: '2026-01-02' },
      { id: 'older', documentId: 'doc-a', createdAt: '2026-01-01' },
      { id: 'other', documentId: 'doc-b', createdAt: '2025-01-01' },
    ]
    expect(uiSourceVersionLabel(revisions, revisionId)).toBe('第 2 版')
    expect(uiSourceVersionLabel(revisions, 'missing')).toBe('未命名版本')
    expect(revisions[0]?.id).toBe(revisionId)
  })
  it('replaces whole legacy diagnostic identities without dropping the cause', () => {
    const diagnostic = `版本 ${revisionId} 无法定位，候选 candidate-0123456789abcdef 已过期；${'a'.repeat(64)}`
    const visible = uiDiagnosticText(diagnostic)
    expect(visible).toContain('无法定位')
    expect(visible).toContain('已过期')
    expect(visible).not.toMatch(/rev-[a-z0-9]-|[a-f0-9]{32,}|candidate-/i)
    expect(diagnostic).toContain(revisionId)
  })
  it('keeps reading statements and actors but never renders source IDs or full hash', () => {
    const reading = {
      kind: 'agent-read', actorId: '李工', sessionSeq: 2, sessionLabel: null,
      turnId: 'turn-internal', modelId: null, at: '2026-01-01', fieldPath: 'nominal',
      statement: '对照图纸读取 12.00 mm',
      source: { kind: 'pdf-page', revisionId, sha256: 'a'.repeat(64), page: 2 },
    }
    const { container } = render(<AgentReadEvidenceList provenance={[reading]} />)
    expect(container.textContent).toContain('李工')
    expect(container.textContent).toContain('对照图纸读取 12.00 mm')
    expect(container.textContent).toContain('第 2 页')
    expect(container.textContent).not.toMatch(/rev-[a-z0-9]-|[a-f0-9]{32,}/i)
    expect(reading.source.revisionId).toBe(revisionId)
    expect(reading.source.sha256).toHaveLength(64)
  })
})
