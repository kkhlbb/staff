import { describe, expect, it } from 'vitest'
import { calculateChain } from '../domain/calculate'
import { parseMm } from '../domain/units'
import { createDemoChain, DEMO_CASES, DEMO_DISCLAIMER } from './demo'

describe('演示案例 fixture', () => {
  it('按 A、B、C 提供文档第 8 节案例，且免责说明与文档第 25 行一致', () => {
    expect(DEMO_CASES.map(({ id }) => id)).toEqual(['A', 'B', 'C'])
    expect(DEMO_DISCLAIMER).toBe(
      '该案例只是用于验证尺寸关系的简化模型，不代表任意实际轴承装配结构均适用。用户需要确认真实装配中的接触面、定位关系和作用方向。',
    )
  })

  it('案例 A 经 calculateChain 得到文档期望的 C₀、Cmin、Cmax、EIc、ESc、Tc、裕量与判定', () => {
    const result = calculateChain({
      ...createDemoChain('A'),
    })

    expect(result.nominalQ).toBe(parseMm('0.2000'))
    expect(result.minQ).toBe(parseMm('0.1500'))
    expect(result.maxQ).toBe(parseMm('0.3900'))
    expect(result.lowerDeviationQ).toBe(parseMm('-0.0500'))
    expect(result.upperDeviationQ).toBe(parseMm('+0.1900'))
    expect(result.toleranceQ).toBe(parseMm('0.2400'))
    expect(result.status).toBe('outside')
    expect(result.lowerMarginQ).toBe(parseMm('+0.0500'))
    expect(result.upperMarginQ).toBe(parseMm('-0.0900'))
  })

  it('案例 B 经 calculateChain 得到修改后方案的期望值，并判定满足', () => {
    const result = calculateChain({
      ...createDemoChain('B'),
    })

    expect(result.nominalQ).toBe(parseMm('0.2000'))
    expect(result.minQ).toBe(parseMm('0.1800'))
    expect(result.maxQ).toBe(parseMm('0.2900'))
    expect(result.lowerDeviationQ).toBe(parseMm('-0.0200'))
    expect(result.upperDeviationQ).toBe(parseMm('+0.0900'))
    expect(result.toleranceQ).toBe(parseMm('0.1100'))
    expect(result.status).toBe('within')
    expect(result.lowerMarginQ).toBe(parseMm('+0.0800'))
    expect(result.upperMarginQ).toBe(parseMm('+0.0100'))
  })

  it('案例 C 经 calculateChain 得到负间隙结果，目标边界相等时判定满足', () => {
    const result = calculateChain({
      ...createDemoChain('C'),
    })

    expect(result.nominalQ).toBe(parseMm('-0.0500'))
    expect(result.minQ).toBe(parseMm('-0.2000'))
    expect(result.maxQ).toBe(parseMm('-0.0500'))
    expect(result.lowerDeviationQ).toBe(parseMm('-0.1500'))
    expect(result.upperDeviationQ).toBe(parseMm('0.0000'))
    expect(result.toleranceQ).toBe(parseMm('0.1500'))
    expect(result.status).toBe('within')
    expect(result.lowerMarginQ).toBe(parseMm('0.0000'))
    expect(result.upperMarginQ).toBe(parseMm('0.0000'))
  })
})
