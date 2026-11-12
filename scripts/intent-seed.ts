/**
 * ADR-001 第 3 步打包走查夹具（显式运行，不进入常规测试）。
 *
 * 生成一个无任务书（sourceKind=user-intent）的空意图项目文件：
 * 责任人与会话已写入，草稿还没有任何候选，等界面里的对话把零件说出来。
 *
 * 用法：
 *   INTENT_SEED_OUT=<path.cunlian> npx vitest run --config vitest.intentfixture.config.ts
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createIntentProjectSnapshot } from '../desktop/main/intentProject'
import { encodeProjectFile } from '../src/project-file/codec'

const OUT = process.env.INTENT_SEED_OUT

describe('ADR-001 第 3 步走查夹具', () => {
  it.skipIf(!OUT)('生成无任务书空项目文件', async () => {
    const snapshot = createIntentProjectSnapshot({
      name: '意图建件走查',
      identity: { actorId: '老王', sessionLabel: '2026-11-12 走查' },
      appVersion: '0.4.0-beta',
      electronVersion: 'test',
    })
    const encoded = await encodeProjectFile(snapshot)
    expect(encoded.ok, encoded.ok ? '' : JSON.stringify(encoded.error)).toBe(true)
    if (!encoded.ok) return
    await fsp.mkdir(path.dirname(OUT!), { recursive: true })
    await fsp.writeFile(OUT!, encoded.value.bytes)
    console.log(`SEED_WRITTEN ${OUT}`)
  }, 120_000)
})
