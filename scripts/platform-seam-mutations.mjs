#!/usr/bin/env node
/**
 * 平台防腐层的变异红绿：M38 / M40。
 *
 * - M38：删掉旧 Keychain 回退迁移（safeStorage 没有就返回 null）→ 迁移用例必须红。
 * - M40：脱敏里去掉 Windows 路径（不调 redactWindowsPaths）→ 脱敏用例必须红。
 *
 * 每条变异只在源码上真实修改、跑真实测试；要求以 AssertionError 被判死，
 * 编译/加载失败不算。恢复后必须回到全绿。
 *
 * 运行：node scripts/platform-seam-mutations.mjs
 * 证据：docs/evidence/platform-seam/mutations/{M38,M40}.patch / *-red.log / *-green.log
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const out = 'docs/evidence/platform-seam/mutations'
await mkdir(out, { recursive: true })

const migration = () =>
  spawnSync('./node_modules/.bin/vitest', ['run', '--config', 'vitest.desktop.config.ts', 'desktop/tests/modelKeyStore.test.ts'], {
    encoding: 'utf8',
  })
const redaction = () => spawnSync('./node_modules/.bin/vitest', ['run', 'src/agent/redact.test.ts'], { encoding: 'utf8' })

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
    await writeFile(file, original.replace(from, to))
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
  await writeFile(`${out}/${id}-green.log`, `${result.stdout}${result.stderr}\nEXIT_CODE=${result.status}\n`)
  if (result.status !== 0) throw new Error(`${id} restore did not go green (${files})`)
}

const summary = []

// M38：删掉「旧 Keychain 有、新路径没有 → 迁到 safeStorage」的整段回退。
{
  const file = 'desktop/main/keychain.ts'
  const from = `    if (this.legacy === null || this.migrated.has(account)) return null
    // 迁移：旧 Keychain 有、新路径没有 → 读出来重存到 safeStorage。
    const legacySecret = await this.legacy.read(account)
    if (legacySecret === null || legacySecret === '') return null
    try {
      await this.write(account, legacySecret)
      this.migrated.add(account)
    } catch {
      // 加密不可用时无法重存：不迁移、也不丢密钥，本次调用仍把旧值交回调用方。
    }
    return legacySecret`
  const to = `    // M38: 不回退旧 Keychain，safeStorage 没有就当没有密钥
    return null`
  await mutate({
    id: 'M38',
    file,
    from,
    to,
    run: migration,
    patchNote: '删掉旧 Keychain 回退迁移；「预置旧记录 → 首次读取成功」用例必须红。',
  })
  await expectGreen(migration, 'M38', 'desktop/tests/modelKeyStore.test.ts')
  console.log('M38: red assertion / restored green')
  summary.push({ id: 'M38', target: 'desktop/main/keychain.ts', change: '删掉旧 Keychain 回退迁移', result: 'red', suite: 'desktop/tests/modelKeyStore.test.ts' })
}

// M40：脱敏不再处理 Windows 路径。
{
  const file = 'src/agent/redact.ts'
  const from = `  const cleaned = redactWindowsPaths(text)
    .replace(posixAbsolutePath, '<path>')`
  const to = `  // M40: 不做 Windows 路径脱敏
  const cleaned = text.replace(posixAbsolutePath, '<path>')`
  await mutate({
    id: 'M40',
    file,
    from,
    to,
    run: redaction,
    patchNote: '去掉 Windows 路径脱敏；盘符/UNC/环境变量用例必须红。',
  })
  await expectGreen(redaction, 'M40', 'src/agent/redact.test.ts')
  console.log('M40: red assertion / restored green')
  summary.push({ id: 'M40', target: 'src/agent/redact.ts', change: '去掉 Windows 路径脱敏', result: 'red', suite: 'src/agent/redact.test.ts' })
}

await writeFile(`${out}/../mutations.json`, `${JSON.stringify({ generator: 'platform-seam-mutations-1', mutations: summary }, null, 2)}\n`)
console.log('MUTATIONS_ALL_RED_AND_GREEN')
