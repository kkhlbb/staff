#!/usr/bin/env node
/**
 * 手绘草图入口的变异红绿：M52 / M53 / M54。
 *
 * - M52：把显示坐标直接当原图坐标存（不做缩放/方向换算）→ 四向用例必须红。
 * - M53：允许从像素推算尺寸（接受 mmPerPixel 之类的无标定系数）→ 守卫必须红。
 * - M54：把图片 base64 写进日志 → 泄漏守卫必须红。
 *
 * 每条变异只在源码上真实修改、跑真实测试；要求以 AssertionError 被判死，编译失败不算。
 * 运行：node scripts/sketch-input-mutations.mjs
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const out = 'docs/evidence/sketch-input/mutations'
await mkdir(out, { recursive: true })
await mkdir('docs/evidence/sketch-input/logs', { recursive: true })

const geometry = () => spawnSync('./node_modules/.bin/vitest',
  ['run', 'src/sketch/__tests__/sketchGeometry.test.ts'], { encoding: 'utf8' })
const readings = () => spawnSync('./node_modules/.bin/vitest',
  ['run', 'src/sketch/__tests__/readings.test.ts'], { encoding: 'utf8' })
const channels = () => spawnSync('./node_modules/.bin/vitest',
  ['run', '--config', 'vitest.desktop.config.ts', 'desktop/tests/sketchChannels.test.ts'], { encoding: 'utf8' })
const guard = () => spawnSync('node', ['scripts/sketch-leak-guard.mjs'], { encoding: 'utf8' })

function expectRed(result, id) {
  const text = `${result.stdout}${result.stderr}`
  if (result.status === 0) throw new Error(`${id} survived (exit 0)`)
  if (!text.includes('AssertionError')) throw new Error(`${id} must be killed by assertion, not build error`)
}

async function mutate({ id, file, from, to, run, patchNote }) {
  const original = await readFile(file, 'utf8')
  if (!original.includes(from)) throw new Error(`${id} target missing in ${file}`)
  await writeFile(`${out}/${id}.patch`, `--- ${file}\n+++ ${file}\n-${from}\n+${to}\n# ${patchNote}\n`)
  try {
    await writeFile(file, original.replaceAll(from, to))
    const red = run()
    await writeFile(`${out}/${id}-red.log`, `${red.stdout}${red.stderr}\nEXIT_CODE=${red.status}\n`)
    expectRed(red, id)
    return
  } finally {
    await writeFile(file, original)
  }
}

// M52：显示坐标直接当原图坐标。
{
  const file = 'src/sketch/selection.ts'
  await mutate({
    id: 'M52', file,
    from: '  const first = displayedToSource(orientation, sourceWidth, sourceHeight, viewToDisplayed(view, input.start))\n' +
      '  const second = displayedToSource(orientation, sourceWidth, sourceHeight, viewToDisplayed(view, input.end))',
    to: '  const first = input.start\n  const second = input.end',
    run: () => {
      const a = geometry()
      if (a.status !== 0) return a
      return channels()
    },
    patchNote: '把屏幕框直接当原图像素；0/90 也许看不出来，180 必须炸。',
  })
  const greenA = geometry()
  const greenB = channels()
  await writeFile(`${out}/M52-green.log`, `${greenA.stdout}${greenA.stderr}${greenB.stdout}${greenB.stderr}\nEXIT=${greenA.status},${greenB.status}\n`)
  if (greenA.status !== 0 || greenB.status !== 0) throw new Error('M52 restore did not go green')
  console.log('M52: red assertion / restored green')
}

// M53：允许无标定的像素→毫米系数。
{
  const file = 'src/sketch/readings.ts'
  await mutate({
    id: 'M53', file,
    from: '  if (!hasExactKeys(reading, READING_KEYS)) {',
    to: "  if (!hasExactKeys(reading, [...READING_KEYS, 'mmPerPixel', 'pixelsPerMm', 'scale', 'ratio'])) {",
    run: () => {
      const a = readings()
      if (a.status !== 0) return a
      return channels()
    },
    patchNote: '接受像素→毫米系数＝允许无标定量取；守卫必须拒绝。',
  })
  const greenA = readings()
  const greenB = channels()
  await writeFile(`${out}/M53-green.log`, `${greenA.stdout}${greenA.stderr}${greenB.stdout}${greenB.stderr}\nEXIT=${greenA.status},${greenB.status}\n`)
  if (greenA.status !== 0 || greenB.status !== 0) throw new Error('M53 restore did not go green')
  console.log('M53: red assertion / restored green')
}

// M54：把图片 base64 写进日志，泄漏守卫必须红。
{
  const file = 'desktop/main/sketchChannels.ts'
  const original = await readFile(file, 'utf8')
  const from = '        const digest = await sha256Hex(bytes)'
  const to = "        await (await import('node:fs')).promises.appendFile('docs/evidence/sketch-input/logs/M54-probe.log', `IMG_B64=${Buffer.from(bytes).toString('base64')}\\n`)\n        const digest = await sha256Hex(bytes)"
  if (!original.includes(from)) throw new Error('M54 target missing')
  await writeFile(`${out}/M54.patch`, `--- ${file}\n+++ ${file}\n-${from}\n+${to}\n# 把导入图片的 base64 写进证据日志文件。\n`)
  const probeLog = 'docs/evidence/sketch-input/logs/M54-probe.log'
  await rm(probeLog, { force: true })
  try {
    await writeFile(file, original.replaceAll(from, to))
    const probe = channels()
    if (probe.status !== 0) throw new Error(`M54 probe run failed unexpectedly: EXIT ${probe.status}`)
    const redGuard = guard()
    await writeFile(`${out}/M54-red.log`, `${redGuard.stdout}${redGuard.stderr}\nEXIT_CODE=${redGuard.status}\n`)
    if (redGuard.status === 0) throw new Error('M54 survived: leak guard did not fail')
    if (!`${redGuard.stdout}${redGuard.stderr}`.includes('base64-run')) throw new Error('M54 leak guard failed for the wrong reason')
    // 泄漏物不入库：先记录守卫判定，再删除含 base64 的探针日志。
    await rm(probeLog, { force: true })
  } finally {
    await writeFile(file, original)
  }
  const greenGuard = guard()
  await writeFile(`${out}/M54-green.log`, `${greenGuard.stdout}${greenGuard.stderr}\nEXIT_CODE=${greenGuard.status}\n`)
  if (greenGuard.status !== 0) throw new Error('M54 restore did not go green')
  console.log('M54: red leak guard / restored green (probe log with base64 deleted)')
}
