#!/usr/bin/env node
/**
 * V4.0 阶段 3 变异：M13 / M14 / M15 红 → 恢复绿。
 *
 * 每个变异都写 patch 与红/绿日志；结束前校验源文件与原始字节一致。
 */
import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const dir = 'docs/evidence/v40-stage3/mutations'
await fs.mkdir(dir, { recursive: true })

const targets = {
  approval: 'desktop/main/approvalStore.ts',
  service: 'desktop/main/agentToolService.ts',
  sidebar: 'src/components/AgentSidebar.tsx',
}
const original = Object.fromEntries(await Promise.all(Object.entries(targets).map(async ([key, file]) => [key, await fs.readFile(file, 'utf8')])))

function replaceExact(source, needle, replacement, id) {
  if (!source.includes(needle)) throw new Error(`Mutation anchor missing: ${id}`)
  return source.replace(needle, replacement)
}

function replaceRange(source, startMarker, endMarker, replacement, id) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  if (start < 0 || end < 0 || end <= start) throw new Error(`Mutation range missing: ${id}`)
  return source.slice(0, start) + replacement + source.slice(end)
}

const variants = [
  {
    id: 'M13',
    file: targets.approval,
    key: 'approval',
    tests: [{ name: 'S3-04', cmd: 'npx', args: ['vitest', 'run', '--config', 'vitest.desktop.config.ts', 'desktop/tests/agentApproval.test.ts', '-t', 'S3-04', '--reporter=verbose'] }],
    mutate: source => replaceRange(
      source,
      '  async reserve(approvalId: string, windowId: number): Promise<ApprovalLookup> {',
      '  /** 释放占用（校验或写盘失败、且没有提交时）。 */',
      `  async reserve(approvalId: string, windowId: number): Promise<ApprovalLookup> {
    // M13: 一次性消费/占用检查被人为移除，同一 approvalId 可再次通过。
    void windowId
    const cached = this.cache.get(approvalId)
    if (cached !== undefined) return { ok: true, record: cached }
    return this.load(approvalId)
  }

`,
      'M13',
    ),
    description: '允许同一 approvalId 重复消费（移除 reserve 的 consumedAt/claims/窗口/有效期门禁）',
  },
  {
    id: 'M14',
    file: targets.service,
    key: 'service',
    tests: [{ name: 'S3-05', cmd: 'npx', args: ['vitest', 'run', '--config', 'vitest.desktop.config.ts', 'desktop/tests/agentApproval.test.ts', '-t', 'S3-05', '--reporter=verbose'] }],
    mutate: source => replaceExact(
      source,
      `        // M14：授权绑定的预览指纹是唯一权威比对；删除它会让 S3-05 红。
        if (recomputedFingerprint !== approval.previewFingerprint) {
          return fail('STALE_PREVIEW', '提交重算结果与授权预览不一致，请重新预览并确认', 'PREVIEW_STALE')
        }`,
      `        // M14: 预览指纹校验被移除，改后参数不再被判为 STALE_PREVIEW。
        void recomputedFingerprint`,
      'M14',
    ),
    description: '提交时不校验预览指纹（重算结果与授权绑定指纹不再比较）',
  },
  {
    id: 'M15',
    file: targets.sidebar,
    key: 'sidebar',
    tests: [
      { name: 'S3-09', cmd: 'npx', args: ['vitest', 'run', 'src/components/AgentSidebar.test.tsx', '-t', 'S3-09 工具失败', '--reporter=verbose'] },
      { name: 'S3-11', cmd: 'npx', args: ['vitest', 'run', 'src/components/AgentSidebar.test.tsx', '-t', 'S3-11', '--reporter=verbose'] },
    ],
    mutate: source => replaceExact(
      source,
      `function receiptOf(step: AgentTaskView['steps'][number]): string {
  if (step.kind === 'model') return 'model'
  const tool = typeof step.inputSummary.tool === 'string' ? step.inputSummary.tool : 'tool'
  return step.errorCode === null ? \`\${tool} · ok\` : \`\${tool} · \${step.errorCode}\`
}`,
      `function receiptOf(step: AgentTaskView['steps'][number]): string {
  // M15: 用“完成/保存成功”文案替代工具回执；失败也被渲染成完成。
  const tool = typeof step.inputSummary.tool === 'string' ? step.inputSummary.tool : 'tool'
  return step.kind === 'model' ? '已完成并保存成功' : \`\${tool} · ok\`
}`,
      'M15',
    ),
    description: '侧栏用模型自述/成功文案替代工具回执（失败被渲染为已完成）',
  },
]

let failed = false
for (const variant of variants) {
  const base = original[variant.key]
  const mutant = variant.mutate(base)
  const before = `${dir}/${variant.id}-before.txt`
  const after = `${dir}/${variant.id}-after.txt`
  await fs.writeFile(before, base)
  await fs.writeFile(after, mutant)
  const diff = spawnSync('diff', ['-u', '--label', `a/${variant.file}`, before, '--label', `b/${variant.file}`, after], { encoding: 'utf8' })
  await fs.writeFile(`${dir}/${variant.id}.patch`, `# ${variant.description}\n${diff.stdout}`)
  await fs.unlink(before)
  await fs.unlink(after)
  try {
    await fs.writeFile(variant.file, mutant)
    for (const test of variant.tests) {
      const red = spawnSync(test.cmd, test.args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      await fs.writeFile(`${dir}/${variant.id}-${test.name}-red.log`, `$ ${test.cmd} ${test.args.join(' ')}\n# ${variant.description}\n${red.stdout}${red.stderr}\nexitCode=${red.status}\n`)
      console.log(`${variant.id} ${test.name} RED exit=${red.status}`)
      if (red.status !== 1 || !(red.stdout + red.stderr).includes('AssertionError')) failed = true
    }
  } finally {
    await fs.writeFile(variant.file, base)
  }
  for (const test of variant.tests) {
    const green = spawnSync(test.cmd, test.args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    await fs.writeFile(`${dir}/${variant.id}-${test.name}-green.log`, `$ ${test.cmd} ${test.args.join(' ')}\n${green.stdout}${green.stderr}\nexitCode=${green.status}\n`)
    console.log(`${variant.id} ${test.name} GREEN exit=${green.status}`)
    if (green.status !== 0) failed = true
  }
}

for (const [key, file] of Object.entries(targets)) {
  if ((await fs.readFile(file, 'utf8')) !== original[key]) throw new Error(`Restoration mismatch: ${file}`)
}
if (failed) process.exitCode = 1
