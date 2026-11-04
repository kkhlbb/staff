/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workspaceCss = readFileSync(
  new URL('./Workspace.css', import.meta.url),
  'utf8',
)

/**
 * jsdom 不做真实布局计算，这里只锁定支撑 1280px 验收的关键规则；
 * 实际视觉验收仍由 1024 / 1280 / 1440px 浏览器检查完成。
 */
describe('Workspace 布局约束', () => {
  it('桌面端组成环表独占整行，下方才是两栏内容', () => {
    expect(workspaceCss).toMatch(
      /grid-template-areas:\s*\n?\s*'table table'\s*\n?\s*'middle result'/,
    )
  })

  it('结果卡键名保持单行，允许区间标签不折行', () => {
    expect(workspaceCss).toMatch(
      /\.result-panel__row dt\s*\{[^}]*white-space:\s*nowrap/,
    )
  })

  it('1024px 单列断点仍把组成环表最小宽度设为 0', () => {
    expect(workspaceCss).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.dimension-table__table\s*\{[^}]*min-width:\s*0/,
    )
  })
})
