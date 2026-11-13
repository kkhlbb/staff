#!/usr/bin/env node
/**
 * 统计公差与重出图的变异红绿：M55 / M56 / M57 / M58。
 *
 * - M55：RSS 改成“公差直接相加”（不是均方根）→ RSS 用例必须红。
 * - M56：蒙特卡洛忽略随机种子（每次不同）→ 复现用例必须红。
 * - M57：用统计法结果替代条款判定 → 判据用例必须红。
 * - M58：重出用当前模板而不是冻结模板版本 → 字节一致/不能重建用例必须红。
 *
 * 每条变异只在源码上真实修改、跑真实测试；要求以 AssertionError 被判死，
 * 编译/加载失败不算。运行：node scripts/stat-tolerance-mutations.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const out = 'docs/evidence/stat-tolerance/mutations'
await mkdir(out, { recursive: true })

const statistics = () =>
  spawnSync('./node_modules/.bin/vitest', ['run', 'src/domain/statistics.test.ts'], {
    encoding: 'utf8',
  })
const judgement = () =>
  spawnSync(
    './node_modules/.bin/vitest',
    ['run', 'src/domain/statistics.test.ts', 'src/domain/calculate.test.ts'],
    { encoding: 'utf8' },
  )
const redraw = () =>
  spawnSync('./node_modules/.bin/vitest', ['run', 'src/revisions/frozenExport.test.ts'], {
    encoding: 'utf8',
  })

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

async function expectGreen(run, id, files) {
  const result = run()
  await writeFile(
    `${out}/${id}-green.log`,
    `${result.stdout}${result.stderr}\nEXIT_CODE=${result.status}\n`,
  )
  if (result.status !== 0) throw new Error(`${id} restore did not go green (${files})`)
}

// M55：RSS 半径改成公差直接相加（ΣT），不是 √Σ(T/6)²。
{
  const file = 'src/domain/statistics.ts'
  const from = `  const combinedSigmaQ = Math.sqrt(sumSquares)`
  const to = `  // M55: 公差直接相加，取代均方根\n  const combinedSigmaQ = terms.reduce((sum, item) => sum + item.toleranceQ, 0)`
  await mutate({
    id: 'M55',
    file,
    from,
    to,
    run: statistics,
    patchNote: 'RSS 改成 ΣT（直接相加）而不是 √Σσᵢ²；RSS 区间断言必须红。',
  })
  await expectGreen(statistics, 'M55', 'src/domain/statistics.test.ts')
  console.log('M55: red assertion / restored green')
}

// M56：蒙特卡洛忽略种子，每次用新的随机状态。
{
  const file = 'src/domain/statistics.ts'
  const from = `  let state = seed >>> 0`
  const to = `  // M56: 忽略种子，每次不同\n  let state = (Math.random() * 0xffffffff) >>> 0`
  await mutate({
    id: 'M56',
    file,
    from,
    to,
    run: statistics,
    patchNote: '忽略种子；同种子三次一致与换种子不同两种用例都会红。',
  })
  await expectGreen(statistics, 'M56', 'src/domain/statistics.test.ts')
  console.log('M56: red assertion / restored green')
}

// M57：用统计区间替代极值判定。
{
  const file = 'src/domain/calculate.ts'
  const from = `    status =
      minQ >= chain.target.minQ && maxQ <= chain.target.maxQ ? 'within' : 'outside'`
  const to = `    // M57: 用统计法（±3σ_C）替代极值判定
    const sigmaC = Math.sqrt(
      contributions.reduce((sum, item) => sum + (item.toleranceQ / 6) ** 2, 0),
    )
    status =
      nominalQ - 3 * sigmaC >= chain.target.minQ && nominalQ + 3 * sigmaC <= chain.target.maxQ
        ? 'within'
        : 'outside'`
  await mutate({
    id: 'M57',
    file,
    from,
    to,
    run: judgement,
    patchNote: '判定改为统计区间；极值判据用例与“统计不替代判定”用例必须红。',
  })
  await expectGreen(judgement, 'M57', 'src/domain/statistics.test.ts + src/domain/calculate.test.ts')
  console.log('M57: red assertion / restored green')
}

// M58：重出时忽略冻结模板版本，直接用当前模板。
{
  const file = 'src/revisions/frozenExport.ts'
  const from = `  if (record.templateVersion !== SPACER_TEMPLATE_VERSION) {
    return {
      ok: false,
      reason:
        \`该版本模板版本 v\${record.templateVersion} 不在当前构建支持范围（v\${SPACER_TEMPLATE_VERSION}），\` +
        '不能重建；不拿当前模板冒充旧图',
    }
  }`
  const to = `  // M58: 忽略冻结模板版本，直接用当前模板
  void SPACER_TEMPLATE_VERSION`
  await mutate({
    id: 'M58',
    file,
    from,
    to,
    run: redraw,
    patchNote: '重出不再校验冻结模板版本；“模板版本不受支持必须报不能重建”用例必须红。',
  })
  await expectGreen(redraw, 'M58', 'src/revisions/frozenExport.test.ts')
  console.log('M58: red assertion / restored green')
}
