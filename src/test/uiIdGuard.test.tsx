// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { expectNoUiInternalIds, UI_HEX_ID, UI_REVISION_ID } from './uiIdGuard'

afterEach(cleanup)
it.each([UI_HEX_ID, UI_REVISION_ID, 'rev-a-bdeabc…'])('guard rejects actual visible text %s', id => {
  const { container } = render(<p>{id}</p>)
  expect(() => expectNoUiInternalIds(container)).toThrow(/UI leaks/)
})
it('checks accessible hints, SVG text, visible aria-hidden text and inputs', () => {
  for (const element of [<button title={UI_REVISION_ID}>打开</button>, <svg><text>{UI_HEX_ID}</text></svg>, <span aria-hidden="true">{UI_REVISION_ID}</span>, <input defaultValue={UI_HEX_ID} />]) {
    const { container, unmount } = render(element)
    expect(() => expectNoUiInternalIds(container)).toThrow(/UI leaks/)
    unmount()
  }
})
it('does not mistake machine metadata/data attributes for visible UI; rejects empty coverage', () => {
  const { container } = render(<div data-revision-id={UI_REVISION_ID}>第 2 版<svg><metadata>{UI_HEX_ID}</metadata><text>草稿 · 第 2 版</text></svg></div>)
  expectNoUiInternalIds(container)
  expect(container.querySelector('metadata')?.textContent).toBe(UI_HEX_ID)
  expect(() => expectNoUiInternalIds(document.createElement('div'))).toThrow(/nonempty/)
})
