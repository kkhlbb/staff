/** 文档与真实浏览器回归共用的预算；CSS 对应值由回归逐档读 computed style 核对。 */
export const LAYOUT_BUDGETS = [
  { width: 960, height: 640, sidebar: 280, centerMin: 360, bottom: 33, collapsed: true },
  { width: 1280, height: 800, sidebar: 320, centerMin: 560, bottom: 280, collapsed: false },
  { width: 1440, height: 900, sidebar: 360, centerMin: 700, bottom: 320, collapsed: false },
] as const

export const LAYOUT_BREAKPOINTS = { compactMax: 1123, wideMin: 1400 } as const

export function treeWidthLimit(width: number): number {
  const budget = layoutBudgetForWidth(width)
  return Math.min(280, Math.max(180, width - budget.sidebar - budget.centerMin - 12))
}

export function layoutBudgetForWidth(width: number) {
  return width <= LAYOUT_BREAKPOINTS.compactMax ? LAYOUT_BUDGETS[0] : width >= LAYOUT_BREAKPOINTS.wideMin ? LAYOUT_BUDGETS[2] : LAYOUT_BUDGETS[1]
}
