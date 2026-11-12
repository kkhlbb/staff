#!/usr/bin/env node
/**
 * 内置 DXF 看图 · 打包应用真实走查（只读）。
 *
 * 用打包产物 + 启动参数 `--open-dxf=<path>` 打开五份样本里的三份代表文件
 * （2000 1:2 / 2000 userinput / R12 1:1），通过 CDP 做真实鼠标点击与滚轮：
 *   - 界面文字：A3 图框、中文标题栏、三条 42 标注值；
 *   - 图层开关真的增减实体；
 *   - 点选实体显示类型/图层；
 *   - 量距两点 → 400.00 mm；
 *   - 滚轮缩放改变 viewBox；
 *   - 截图落 docs/evidence/dxf-viewer/screenshots/。
 *
 * 用法：
 *   npm run package:desktop -- --arch=arm64
 *   node desktop/tests/e2e/dxfViewer.mjs [appExecutable] [basePort]
 *
 * 输出：
 *   docs/evidence/dxf-viewer/screenshots/*.png
 *   docs/evidence/dxf-viewer/e2e-result.json（serializeEvidence）
 */
import { spawn } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { serializeEvidence } from '../../../scripts/evidence-json.ts'

const appExecutable =
  process.argv[2] ??
  path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const basePort = Number(process.argv[3] ?? 9410)
const EVIDENCE = path.join(process.cwd(), 'docs', 'evidence', 'dxf-viewer')
const SHOTS = path.join(EVIDENCE, 'screenshots')
const RESULT = path.join(EVIDENCE, 'e2e-result.json')
const SAMPLES = path.join(process.cwd(), 'docs', 'evidence', 'dxf-depth', 'samples')

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}（先 npm run package:desktop -- --arch=arm64）`)
  process.exit(2)
}

await fsp.mkdir(SHOTS, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = []
const screenshots = []
const runs = []
function check(id, ok, detail = {}) {
  checks.push({ id, ok, ...detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(detail).slice(0, 400)}`)
}

async function findPage(port) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page')
      if (page) return page
    } catch {
      // 端口尚未就绪。
    }
    await sleep(200)
  }
  return null
}

async function openApp(samplePath, port) {
  // 独立 userData：不与用户已开着的寸链抢单实例锁，也不碰真实项目数据。
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'cunlian-dxf-viewer-'))
  // 本机 shell 可能带 ELECTRON_RUN_AS_NODE=1（会让 Electron 退化成 node 并拒收
  // Chromium 开关）；取证必须清掉，才是在跑真正的 Electron 应用。
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(appExecutable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--open-dxf=${samplePath}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'], env })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk.toString()))
  child.stderr.on('data', (chunk) => (output += chunk.toString()))
  const target = await findPage(port)
  if (!target) {
    child.kill('SIGKILL')
    throw new Error(`25 秒内没有 page target：${output.slice(-1000)}`)
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', reject)
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (response.result?.exceptionDetails) {
      throw new Error(`evaluate failed: ${response.result.exceptionDetails.text}`)
    }
    return response.result?.result?.value
  }
  const shot = async (name) => {
    const response = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    const file = path.join(SHOTS, `${name}.png`)
    await fsp.writeFile(file, Buffer.from(response.result.data, 'base64'))
    screenshots.push(path.relative(process.cwd(), file))
    return file
  }
  const close = async () => {
    try { socket.close() } catch { /* already closed */ }
    child.kill('SIGTERM')
    await sleep(800)
    if (child.exitCode === null) child.kill('SIGKILL')
    await sleep(300)
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  })
  return { send, evaluate, shot, close }
}

async function waitFor(evaluate, expression, label, timeoutMs = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return true
    await sleep(200)
  }
  throw new Error(`TIMEOUT: ${label}`)
}

const SAMPLE_RUNS = [
  {
    key: '2000-1x2',
    file: 'spacer-20x32x12.05-dxf-2000-1x2.dxf',
    shot: 'viewer-2000-1x2-paper',
    texts: ['A3 横向 · 第三角', '1:2 · mm', '12.050', '⌀20.000', '⌀32.000', '依据：本图档未记录来源文档名/页。'],
    interactive: true,
  },
  {
    key: '2000-1x2-userinput',
    file: 'spacer-20x32x12.05-dxf-2000-1x2-userinput.dxf',
    shot: 'viewer-2000-1x2-userinput',
    texts: ['依据：用户输入，无外部原文件', '6. 依据：用户输入，无外部原文件。'],
    interactive: false,
  },
  {
    key: 'r12-1x1',
    file: 'spacer-20x32x12.05-dxf-r12-1x1.dxf',
    shot: 'viewer-r12-1x1-model',
    texts: ['1:1 · mm', '寸链 · 待复核草稿', '第三角投影：右端视图置于主视图右侧'],
    interactive: false,
  },
  {
    key: 'unsupported-fixture',
    file: 'unsupported.dxf',
    absolute: path.join(EVIDENCE, 'fixtures', 'unsupported.dxf'),
    shot: 'viewer-unsupported-fixture',
    texts: ['未支持实体计数：SPLINE / HATCH / INSERT / SOLID'],
    layers: 3,
    expectUnsupported: [
      '未渲染 1 个 SPLINE（不支持）',
      '未渲染 1 个 HATCH（不支持）',
      '未渲染 1 个 INSERT（不支持）',
      '未渲染 1 个 SOLID（不支持）',
    ],
    interactive: false,
  },
  {
    key: 'broken-gbk-fixture',
    file: 'broken-gbk.dxf',
    absolute: path.join(EVIDENCE, 'fixtures', 'broken-gbk.dxf'),
    shot: 'viewer-broken-gbk-fixture',
    texts: [],
    expectWarning: '本文件编码未识别，文字可能不正确',
    interactive: false,
  },
]

for (const [index, sample] of SAMPLE_RUNS.entries()) {
  const port = basePort + index
  let app = null
  try {
    app = await openApp(sample.absolute ?? path.join(SAMPLES, sample.file), port)
    const { evaluate, shot, send } = app
    await waitFor(evaluate, `Boolean(document.querySelector('.dxf-viewer'))`, `${sample.key} 出现`)
    await waitFor(
      evaluate,
      `Boolean(document.querySelector('[data-testid="dxf-canvas"]'))`,
      `${sample.key} 画布出现`,
    )
    await sleep(700)

    const state = await evaluate(`(() => {
      const svg = document.querySelector('[data-testid="dxf-canvas"]')
      const text = [...document.querySelectorAll('svg text')].map((node) => node.textContent).join('\\n')
      return {
        fileName: document.querySelector('.dxf-viewer__header h1')?.textContent ?? '',
        meta: document.querySelector('.dxf-viewer__meta')?.textContent ?? '',
        layerCount: document.querySelectorAll('.dxf-viewer__layers input[type="checkbox"]').length,
        unsupported: document.querySelector('[data-testid="dxf-unsupported"]')?.textContent
          ?? document.querySelector('[data-testid="dxf-unsupported-empty"]')?.textContent ?? '',
        encodingWarning: document.querySelector('[data-testid="dxf-encoding-warning"]')?.textContent ?? '',
        svgText: text,
        entities: document.querySelectorAll('g[data-entity-id]').length,
        viewBox: svg?.getAttribute('viewBox') ?? '',
        zoom: document.querySelector('[data-testid="dxf-zoom"]')?.textContent ?? '',
      }
    })()`)
    runs.push({ key: sample.key, fileName: state.fileName, meta: state.meta, layerCount: state.layerCount, entities: state.entities, encodingWarning: state.encodingWarning, unsupported: state.unsupported })

    check(`${sample.key} 文件名`, state.fileName === sample.file, { fileName: state.fileName })
    check(`${sample.key} 图层 ${sample.layers ?? 5} 个`, state.layerCount === (sample.layers ?? 5), { layerCount: state.layerCount })
    if (sample.expectUnsupported !== undefined) {
      for (const expected of sample.expectUnsupported) {
        check(`${sample.key} 未渲染计数：${expected}`, state.unsupported.includes(expected), { unsupported: state.unsupported })
      }
    } else {
      check(`${sample.key} 未支持实体为 0`, state.unsupported.includes('全部实体均已渲染'), { unsupported: state.unsupported })
    }
    if (sample.expectWarning !== undefined) {
      check(`${sample.key} 编码警告`, state.encodingWarning.includes(sample.expectWarning), { encodingWarning: state.encodingWarning })
    } else {
      check(`${sample.key} 无编码警告`, state.encodingWarning === '', { encodingWarning: state.encodingWarning })
    }
    for (const expected of sample.texts) {
      check(`${sample.key} 界面文字：${expected}`, state.svgText.includes(expected))
    }
    await shot(sample.shot)

    if (sample.interactive) {
      // 量距：点「量距」→ 两个真实鼠标点击 → 400.00 mm。
      const measureClicked = await evaluate(`(() => {
        const button = [...document.querySelectorAll('.dxf-viewer__toolbar button')].find((item) => item.textContent.trim() === '量距')
        if (!button) return false
        button.click()
        return true
      })()`)
      check('量距按钮可点', measureClicked === true)
      await sleep(200)
      const points = await evaluate(`(() => {
        const svg = document.querySelector('[data-testid="dxf-canvas"]')
        const rect = svg.getBoundingClientRect()
        const [x, y, width, height] = svg.getAttribute('viewBox').split(/\\s+/).map(Number)
        const scale = Math.min(rect.width / width, rect.height / height)
        const offsetX = (rect.width - width * scale) / 2
        const offsetY = (rect.height - height * scale) / 2
        const toClient = (sceneX, sceneY) => ({
          x: rect.left + offsetX + (sceneX - x) * scale,
          y: rect.top + offsetY + (sceneY - y) * scale,
        })
        return { a: toClient(10, -10), b: toClient(410, -10), rect: { left: rect.left, top: rect.top } }
      })()`)
      for (const point of [points.a, points.b]) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
        await sleep(250)
      }
      const measure = await evaluate(`document.querySelector('[data-testid="dxf-measure"]')?.textContent ?? ''`)
      check('量距 400.00 mm', measure.includes('400.00 mm'), { measure })
      await shot('viewer-2000-1x2-measure')

      // 退出量距，点选图框底线：属性面板给出 POLYLINE / 图框。
      await evaluate(`(() => {
        const button = [...document.querySelectorAll('.dxf-viewer__toolbar button')].find((item) => item.textContent.trim() === '量距')
        button?.click()
        return true
      })()`)
      const selectPoint = await evaluate(`(() => {
        const svg = document.querySelector('[data-testid="dxf-canvas"]')
        const rect = svg.getBoundingClientRect()
        const [x, y, width, height] = svg.getAttribute('viewBox').split(/\\s+/).map(Number)
        const scale = Math.min(rect.width / width, rect.height / height)
        const offsetX = (rect.width - width * scale) / 2
        const offsetY = (rect.height - height * scale) / 2
        return {
          x: rect.left + offsetX + (200 - x) * scale,
          y: rect.top + offsetY + (-10 - y) * scale,
        }
      })()`)
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: selectPoint.x, y: selectPoint.y })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: selectPoint.x, y: selectPoint.y, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: selectPoint.x, y: selectPoint.y, button: 'left', clickCount: 1 })
      await sleep(300)
      const selection = await evaluate(`(() => ({
        type: document.querySelector('[data-testid="dxf-selected-type"]')?.textContent ?? '',
        inspector: document.querySelector('[data-testid="dxf-inspector"]')?.textContent ?? '',
      }))()`)
      check('点选命中 POLYLINE', selection.type === 'POLYLINE', { type: selection.type })
      check('属性面板含图框图层与坐标', selection.inspector.includes('图框') && selection.inspector.includes('关键坐标'), { inspector: selection.inspector.slice(0, 200) })
      await shot('viewer-2000-1x2-selected')

      // 放大到视口里的 1:2 零件：让三条标注与中文标题栏在截图里可读。
      const zoomTarget = await evaluate(`(() => {
        const svg = document.querySelector('[data-testid="dxf-canvas"]')
        const rect = svg.getBoundingClientRect()
        const [x, y, width, height] = svg.getAttribute('viewBox').split(/\\s+/).map(Number)
        const scale = Math.min(rect.width / width, rect.height / height)
        const offsetX = (rect.width - width * scale) / 2
        const offsetY = (rect.height - height * scale) / 2
        return {
          x: rect.left + offsetX + (300 - x) * scale,
          y: rect.top + offsetY + (-178 - y) * scale,
        }
      })()`)
      for (let step = 0; step < 3; step += 1) {
        await send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: zoomTarget.x,
          y: zoomTarget.y,
          deltaX: 0,
          deltaY: -175,
        })
        await sleep(200)
      }
      const detailZoom = await evaluate(`(() => ({
        zoom: document.querySelector('[data-testid="dxf-zoom"]')?.textContent ?? '',
        viewBox: document.querySelector('[data-testid="dxf-canvas"]').getAttribute('viewBox'),
      }))()`)
      check('放大到零件细节（≥200%）', /[2-9][0-9][0-9]%/.test(detailZoom.zoom), detailZoom)
      await shot('viewer-2000-1x2-zoom')

      // 图层开关：关掉「中心线」→ 该层实体消失；恢复 → 回来。
      const layerToggle = await evaluate(`(() => {
        const box = document.querySelector('[aria-label="显示图层 中心线"]')
        if (!box) return { ok: false }
        const count = (layer) => [...document.querySelectorAll('g[data-entity-id]')].filter((node) => node.getAttribute('data-layer') === layer).length
        const before = count('中心线')
        box.click()
        return new Promise((resolve) => setTimeout(() => {
          const hidden = count('中心线')
          box.click()
          setTimeout(() => resolve({ ok: true, before, hidden, restored: count('中心线') }), 300)
        }, 300))
      })()`)
      check('图层开关隐藏/恢复实体', layerToggle.ok && layerToggle.before > 0 && layerToggle.hidden === 0 && layerToggle.restored > 0, layerToggle)

      // 滚轮缩放：viewBox 宽度变小、百分比变大。
      const beforeZoom = await evaluate(`document.querySelector('[data-testid="dxf-canvas"]').getAttribute('viewBox')`)
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 520, deltaX: 0, deltaY: -240 })
      await sleep(400)
      const afterZoom = await evaluate(`(() => ({
        viewBox: document.querySelector('[data-testid="dxf-canvas"]').getAttribute('viewBox'),
        zoom: document.querySelector('[data-testid="dxf-zoom"]')?.textContent ?? '',
      }))()`)
      const widthOf = (value) => Number(value.split(/\s+/)[2])
      check('滚轮缩放是真 viewBox 变换', widthOf(afterZoom.viewBox) < widthOf(beforeZoom), { beforeZoom, after: afterZoom })
      check('缩放百分比更新', /1[0-9][0-9]%|[2-9][0-9][0-9]%/.test(afterZoom.zoom), { zoom: afterZoom.zoom })

      // 模型空间截图：确认视口内容与纸面分开。
      await evaluate(`(() => {
        const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent.trim() === '模型')
        tab?.click()
        return true
      })()`)
      await sleep(500)
      await shot('viewer-2000-1x2-model')
    }
  } catch (error) {
    check(`${sample.key} 走查未中断`, false, { error: String(error).slice(0, 500) })
  } finally {
    if (app !== null) await app.close()
  }
}

const failed = checks.filter((item) => !item.ok)
const result = {
  schema: 'dxf-viewer-e2e-v1',
  app: 'out/寸链-darwin-arm64/寸链.app',
  mode: 'arm64 打包产物；--open-dxf 启动参数；CDP 真实鼠标/滚轮',
  readOnly: '不写回文件、不保存项目、不联网',
  samples: runs,
  checks,
  screenshots,
  summary: { total: checks.length, failed: failed.length },
}
await fsp.mkdir(EVIDENCE, { recursive: true })
await fsp.writeFile(RESULT, serializeEvidence(result))
console.log(`\n${failed.length === 0 ? 'ALL PASS' : 'FAILURES'} ${checks.length - failed.length}/${checks.length}`)
console.log(`证据：${path.relative(process.cwd(), RESULT)}`)
process.exit(failed.length === 0 ? 0 : 1)
