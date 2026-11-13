/** Geometry-only script detection. PDF y increases upwards; no value-based corrections. */
import type { PdfTextItem, PdfTextLine, PdfTextPage } from './textLayer'

export const SCRIPT_MAX_FONT_RATIO = 0.8
/** Sizes between recognition and suspicion thresholds are blocked, not treated as main digits. */
export const SCRIPT_SUSPECT_FONT_RATIO = 0.95
export const SCRIPT_MIN_BASELINE_RATIO = 0.05
export const SCRIPT_MAX_BASELINE_RATIO = 0.65
export const SCRIPT_X_PADDING_RATIO = 0.25
export type ScriptRole = 'upper' | 'lower' | 'ambiguous' | 'baseline'
export function classifyScript(item: PdfTextItem, baselineY: number, fontSize: number): ScriptRole {
  if (!item.hasGeometry || !(fontSize > 0)) return 'ambiguous'
  if (item.height / fontSize >= SCRIPT_MAX_FONT_RATIO) return 'baseline'
  const dy = (item.y - baselineY) / fontSize
  if (Math.abs(dy) <= SCRIPT_MIN_BASELINE_RATIO || Math.abs(dy) > SCRIPT_MAX_BASELINE_RATIO) return 'ambiguous'
  return dy > 0 ? 'upper' : 'lower'
}
export interface ScriptDecoration {
  readonly start: number
  readonly end: number
  readonly nominalItems: readonly number[]
  readonly items: readonly PdfTextItem[]
  readonly upper: string | null
  readonly lower: string | null
  readonly ambiguous: boolean
}
/** Mask only small items in numeric RHS; preserve offsets, rawText and all source items. */
export function protectScriptNominals(line: PdfTextLine, page: PdfTextPage): {
  line: PdfTextLine; decorations: ScriptDecoration[]
} {
  const text = line.normalizedText
  const decorations: ScriptDecoration[] = []
  const chars = text.split('')
  const pattern = /=\s*([+-]?\d[\d.\s+\-−]*)(?=mm\b|cm\b|in\b|[;,]|$)/gu
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[0].indexOf(match[1])
    const end = start + match[1].length
    const spans = line.spans.filter(s => s.end > start && s.start < end && text.slice(Math.max(s.start,start),Math.min(s.end,end)).trim() !== '')
    const covered = spans.map(s => line.items.find(i => i.itemIndex === s.itemIndex)!).filter(Boolean)
    const main = covered.filter(i => i.hasGeometry && /\d/u.test(i.normalizedText))
      .sort((a,b) => b.height-a.height)[0]
    if (!main) continue
    // Main numeric glyphs establish the baseline, never a page-wide average.
    const font = main.height
    const nominalItems = covered.filter(i => i.height/font >= SCRIPT_SUSPECT_FONT_RATIO)
    const baseline = Math.max(...nominalItems.map(i=>i.y))
    // A unit within the same indivisible item cannot have separate script items before it.
    if (covered.some(i=>/mm|cm|\bin\b/u.test(i.normalizedText))) continue
    const left = Math.min(...nominalItems.map(i=>i.x))
    const unitSpan = line.spans.find(s=>s.end>=end && /mm|cm|in/u.test(line.items.find(i=>i.itemIndex===s.itemIndex)?.normalizedText ?? ''))
    const unitItem = line.items.find(i=>i.itemIndex===unitSpan?.itemIndex)
    const right = unitItem?.x ?? Math.max(...covered.map(i=>i.x+i.width))
    const small = page.items.filter(i => i.text.trim() !== '' && (
      (!i.hasGeometry && covered.some(c=>c.itemIndex===i.itemIndex)) ||
      (i.hasGeometry && i.height/font < SCRIPT_SUSPECT_FONT_RATIO && i.x > left &&
        i.x < right + font*SCRIPT_X_PADDING_RATIO && Math.abs(i.y-baseline)/font <= SCRIPT_MAX_BASELINE_RATIO)))
    if (small.length===0) continue
    const roles = small.map(i => {
      const role = classifyScript(i,baseline,font)
      return {item:i,role:role==='baseline'?'ambiguous':role}
    })
    const read = (role: ScriptRole) => roles.filter(r=>r.role===role).sort((a,b)=>a.item.x-b.item.x)
      .map(r=>r.item.normalizedText).join('').replace(/[−–—]/gu,'-').replace(/·/gu,'.')
    const upper = read('upper') || null
    const lower = read('lower') || null
    const valid = (s: string|null) => s===null || /^(?:[+-]\d+(?:\.\d+)?|0(?:\.0+)?)$/u.test(s)
    const ambiguous = roles.some(r=>r.role==='ambiguous') || !valid(upper) || !valid(lower)
    const ids = new Set(small.map(i=>i.itemIndex))
    for(const s of spans) if(ids.has(s.itemIndex)) for(let p=Math.max(s.start,start);p<Math.min(s.end,end);p++) chars[p]=' '
    decorations.push({start,end,nominalItems:nominalItems.map(i=>i.itemIndex),items:small,upper,lower,ambiguous})
  }
  return {line:{...line,normalizedText:chars.join('')},decorations}
}
