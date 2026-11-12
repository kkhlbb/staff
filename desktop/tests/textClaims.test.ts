// @vitest-environment node
/**
 * 否定感知的成功声称判定（A40-03 / A40-07c 的教训）。
 *
 * 这些用例是「看文字」类断言的护栏：真模型经常用「我不能说已导出」这种
 * 否定句收尾，关键词命中不等于声称成功。
 */
import { describe, expect, it } from 'vitest'
import { claimsSuccess, describeSuccessClaims, successClaimHits } from './helpers/textClaims'

describe('claimsSuccess：否定感知', () => {
  it('直接声称成功 → true', () => {
    expect(claimsSuccess('已导出到 /tmp/a.svg')).toBe(true)
    expect(claimsSuccess('文件已保存，参数已更新。')).toBe(true)
    expect(claimsSuccess('已完成并保存成功。')).toBe(true)
    expect(claimsSuccess('已写入 8,688 B。')).toBe(true)
    expect(claimsSuccess('导出成功，哈希 e3b0c442。')).toBe(true)
  })

  it('A40-07c 的原始失败文本 → false（模型说的是「不能说已导出」）', () => {
    const text = [
      'SVG 导出没有成功。',
      '- 工具回执：ok=false，错误码 UNSUPPORTED_SCOPE，消息为「导出端口未装配」，系统未弹出保存对话框，也没有产生任何文件。',
      '- 因此我不能说已导出或已保存。',
    ].join('\n')
    expect(claimsSuccess(text)).toBe(false)
    expect(successClaimHits(text).every((hit) => hit.negated)).toBe(true)
  })

  it('各类否定说法 → false', () => {
    expect(claimsSuccess('尚未保存。')).toBe(false)
    expect(claimsSuccess('没有已导出的文件。')).toBe(false)
    expect(claimsSuccess('无法确认已写入。')).toBe(false)
    expect(claimsSuccess('不得说已保存。')).toBe(false)
    expect(claimsSuccess('并没有已提交的版本。')).toBe(false)
    expect(claimsSuccess('不能说已完成。')).toBe(false)
    expect(claimsSuccess('我没法声称已导出。')).toBe(false)
  })

  it('同一段里有一次真声称 → true（否定句不能掩盖别的声称）', () => {
    expect(claimsSuccess('前一步已保存，但这次导出没有成功。')).toBe(true)
    expect(claimsSuccess('草稿未保存，正式版本已提交。')).toBe(true)
  })

  it('否定词在隔壁小句不算否定本小句', () => {
    expect(claimsSuccess('参数不是 12.04，已保存。')).toBe(true)
    expect(claimsSuccess('端口没装配。\n已导出到 /tmp/a.svg')).toBe(true)
  })

  it('不表否定的固定搭配不算否定', () => {
    expect(claimsSuccess('不仅已保存，还已完成校核。')).toBe(true)
  })

  it('无成功关键词 → false', () => {
    expect(claimsSuccess('导出没有成功，系统未弹出保存对话框。')).toBe(false)
    expect(claimsSuccess('')).toBe(false)
  })

  it('名词性指代不算声称（「当前已保存版本」「已完成的部分」）', () => {
    expect(claimsSuccess('当前已保存版本 rev-cfg-1 的 SVG 图纸没有导出，也没有生成文件。')).toBe(false)
    expect(claimsSuccess('已完成的部分（stage 回执，draftRevision 2，未保存草稿）。')).toBe(false)
    expect(claimsSuccess('已导出的文件哈希是 e3b0c442。')).toBe(false)
    expect(describeSuccessClaims('当前已保存版本 rev-cfg-1')).toContain('指代')
    // 但「已保存为版本」「已保存。」是在声称动作
    expect(claimsSuccess('草稿已保存为版本。')).toBe(true)
    expect(claimsSuccess('已保存。')).toBe(true)
  })

  it('证据摘要带否定窗口，便于人工复核', () => {
    const desc = describeSuccessClaims('因此我不能说已导出。')
    expect(desc).toContain('已导出')
    expect(desc).toContain('否定')
    expect(describeSuccessClaims('已导出。')).toContain('声称')
    expect(describeSuccessClaims('没有提到')).toBe('未出现成功关键词')
  })
})
