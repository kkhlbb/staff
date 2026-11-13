import { expect } from 'vitest'

/** Check rendered user text, including SVG and accessible hints; not transport/data attributes. */
export function expectNoUiInternalIds(root: Element): void {
  const clone = root.cloneNode(true) as Element
  clone.querySelectorAll('script, style, metadata, [hidden]').forEach(node => node.remove())
  const text = [clone.textContent ?? '', ...[clone, ...Array.from(clone.querySelectorAll('[title], [aria-label], input:not([type="password"]), textarea'))].flatMap(node => [node.getAttribute('title') ?? '', node.getAttribute('aria-label') ?? '', (node as HTMLInputElement).value ?? ''])].join('\n')
  expect(text.trim().length, 'guard must examine nonempty rendered UI').toBeGreaterThan(0)
  expect(text, 'UI leaks a continuous hexadecimal identity').not.toMatch(/[0-9a-f]{32,}/i)
  expect(text, 'UI leaks a revision identity (including truncated prefixes)').not.toMatch(/rev-[a-z0-9]-[a-z0-9-]+(?:…|\.\.\.)?/i)
}

export const UI_ID_UUID = 'bdeabc56-47b0-46a3-bd41-11758a2427d2'
export const UI_REVISION_ID = `rev-a-${UI_ID_UUID}`
export const UI_HEX_ID = '0123456789abcdef0123456789abcdef'
