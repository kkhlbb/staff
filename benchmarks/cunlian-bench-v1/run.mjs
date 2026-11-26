import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const files = {
  A: 'step-xcaf', B: 'assembly-mates', C: 'gdt-accuracy',
  D: 'compliance-mic', E: 'e2e-cloud-safety',
}

export async function measure(id, name, thresholds, run) {
  const start = performance.now()
  try {
    return { id, name, thresholds, metrics: {}, ...await run(), durationMs: performance.now() - start }
  } catch (error) {
    return { id, name, thresholds, metrics: {}, status: 'FAIL', reason: error.message, durationMs: performance.now() - start }
  }
}

export function summarize(cases) {
  const summary = { pass: 0, fail: 0, skipped: 0, total: cases.length }
  for (const item of cases) {
    if (item.status === 'PASS') summary.pass++
    else if (item.status === 'FAIL') summary.fail++
    else if (item.status?.startsWith('SKIPPED')) summary.skipped++
    else throw new Error('Invalid case status: ' + item.status)
  }
  return summary
}

export function result(suiteId, title, authority, start, cases) {
  const summary = summarize(cases)
  const status = summary.fail ? 'FAIL' : !summary.pass ? 'SKIPPED' : summary.skipped ? 'PARTIAL' : 'PASS'
  return { suiteId, title, authority, status, durationMs: performance.now() - start, summary, cases }
}

export function check(pass, metrics, defectNote) {
  return { status: pass ? 'PASS' : 'FAIL', metrics, ...(!pass && { defectNote }) }
}

function parseArgs(args) {
  const options = { repoRoot: root, cacheDir: join(root, '.cache/benchmarks'), allowExternal: false,
    offlineDir: null, seed: 20261126, samples: 50000 }
  let mode
  let selection = Object.keys(files)
  let out = join(root, "docs/benchmarks/cunlian-bench-v1-report.json")
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === '--offline' || flag === '--external') {
      if (mode && mode !== flag) throw new Error('--offline and --external are mutually exclusive')
      mode = flag
      options.allowExternal = mode === '--external'
      continue
    }
    if (!['--offline-dir', '--suite', '--out'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Unknown option or missing value: ' + flag)
    }
    const value = args[++i]
    if (flag === '--offline-dir') options.offlineDir = resolve(value)
    if (flag === '--out') out = resolve(value)
    if (flag === '--suite') {
      const selected = value.split(',').map(id => id.trim().toUpperCase())
      if (selected.some(id => !Object.hasOwn(files, id))) throw new Error('Invalid suite selection: ' + value)
      selection = Object.keys(files).filter(id => selected.includes(id))
    }
  }
  return { options, selection, out }
}

async function main(args) {
  const { options, selection, out } = parseArgs(args)
  const start = performance.now()
  const timestampIso = new Date().toISOString()
  let external
  if (options.allowExternal) {
    const path = join(root, 'benchmarks/cunlian-bench-v1/fetch-external.mjs')
    if (!existsSync(path)) external = { status: 'SKIPPED_EXTERNAL_ASSET', reason: 'BENCH-01 fetcher is absent' }
    else {
      const fetch = spawnSync(process.execPath, [path, ...(options.offlineDir ? ['--offline-dir', options.offlineDir] : [])],
        { cwd: root, stdio: ['ignore', 2, 2], timeout: 300_000 })
      external = fetch.status === 0 ? { status: 'PASS' }
        : { status: 'FAIL', reason: fetch.error?.message ?? 'Fetcher exited with ' + (fetch.status ?? fetch.signal) }
    }
  }
  const suites = []
  for (const id of selection) {
    const suiteStart = performance.now()
    const path = new URL('./suites/suite' + id + '-' + files[id] + '.mjs', import.meta.url)
    if (!existsSync(path)) {
      const entry = await measure(id + '-availability', 'Suite availability', {}, () => ({
        status: 'SKIPPED_EXTERNAL_ASSET', reason: 'Suite module is absent from this checkout',
      }))
      suites.push(result(id, files[id], '', suiteStart, [entry]))
      continue
    }
    try {
      const { runSuite } = await import(path)
      suites.push(await runSuite(options))
    } catch (error) {
      suites.push(result(id, files[id], '', suiteStart, [
        await measure(id + '-runtime', 'Suite initialization', {}, () => { throw error }),
      ]))
    }
  }
  const cases = suites.flatMap(suite => suite.cases)
  const cpu = cpus()
  const report = {
    benchVersion: 'cunlian-bench-v1',
    appVersion: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    timestampIso,
    environment: { cpu: cpu[0]?.model ?? null, logicalCpuCount: cpu.length, memoryBytes: totalmem(),
      os: platform(), osRelease: release(), arch: arch(), node: process.version },
    options, external, durationMs: performance.now() - start,
    summary: summarize(cases), suites,
    defects: suites.flatMap(suite => suite.cases.filter(item => item.defectNote).map(item => ({
      suiteId: suite.suiteId, caseId: item.id, defectNote: item.defectNote,
    }))),
  }
  const json = JSON.stringify(report, null, 2) + '\n'
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, json)
  console.log(JSON.stringify({ out, ...report.summary }))
  if (report.summary.fail || external?.status === 'FAIL') process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message)
    process.exitCode = 2
  })
}
