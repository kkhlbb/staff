// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { DrawingCanvas } from './DrawingCanvas'
import { buildSpacerDrawing } from '../drawing/spacerDrawing'
import { DEFAULT_FRAME_FIELDS } from '../revisions/compute'
import { parseSpacerParameters, DEFAULT_SPACER_TEXTS } from '../parts/spacerParameters'
import { expectNoUiInternalIds, UI_REVISION_ID, UI_HEX_ID } from '../test/uiIdGuard'

afterEach(cleanup)
it('UI-ID guard: 图纸真实 SVG 的旧版版本格不得泄漏；文件 metadata 与数据原样保留', () => {
  const parsed = parseSpacerParameters(DEFAULT_SPACER_TEXTS)
  if (!parsed.ok) throw new Error(parsed.message)
  const data = buildSpacerDrawing({ projectId: UI_HEX_ID, revisionId: UI_REVISION_ID, drawingId: `drawing-${UI_HEX_ID}`, parameters: parsed.parameters, scale: { numerator: 1, denominator: 1 }, frameFields: { ...DEFAULT_FRAME_FIELDS, version: '' } })
  const original = JSON.stringify(data)
  const { container } = render(<DrawingCanvas data={data} zoom={1} versionLabel="第 3 版" selectedAnnotationId={null} onSelectAnnotation={() => undefined} />)
  expect(container.querySelectorAll('svg text').length).toBeGreaterThan(10)
  expect(Array.from(container.querySelectorAll('svg text')).map(node => node.textContent)).toContain('草稿 · 第 3 版')
  expectNoUiInternalIds(container)
  expect(container.querySelector('metadata')?.textContent).toContain(UI_HEX_ID)
  expect(JSON.stringify(data)).toBe(original)
  expect(data.frame.fields.version).toContain(UI_REVISION_ID)
})
