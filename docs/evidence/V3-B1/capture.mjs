#!/usr/bin/env node
/**
 * V3-B1 真实 Electron 证据采集（打包产物 + CDP），不修改产品代码、不新增产品 IPC。
 *
 * 覆盖：
 * - 生产 file:// 产物内 window.cunlian 键集合未扩展、无远程资源；
 * - sandboxed renderer 里 WebGL2 实际创建结果（GL_VERSION / UNMASKED_RENDERER）；
 * - 画布真实像素：触发一次渲染后在同一帧 drawImage 回读，证明不是空 canvas；
 * - 树→模型选择、爆炸 100%、复位装配、contextlost 降级与重试恢复；
 * - 1440×900 / 960×640 两种内容尺寸的真实截图；
 * - 断网（Network.emulateNetworkConditions offline）后整页重载仍能重新打开 3D。
 *
 * 用法：node docs/evidence/V3-B1/capture.mjs [appExecutable] [port]
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'

const appExecutable = process.argv[2] ?? path.join(process.cwd(), 'out', '寸链-darwin-arm64', '寸链.app', 'Contents', 'MacOS', '寸链')
const port = Number(process.argv[3] ?? 9411)
const outDir = path.join(process.cwd(), 'docs', 'evidence', 'V3-B1')
mkdirSync(outDir, { recursive: true })

const report = {
  startedAt: new Date().toISOString(),
  appExecutable,
  platform: process.platform,
  arch: process.arch,
  nodeVersion: process.version,
  checks: [],
  shots: [],
  measurements: {},
  notes: [],
}
const failures = []
function check(name, ok, detail = '') {
  report.checks.push({ name, ok, detail })
  if (!ok) failures.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` :: ${detail}`}`)
}

if (!existsSync(appExecutable)) {
  console.error(`BLOCKED: 找不到打包产物 ${appExecutable}；先 npm run package:desktop -- --arch=arm64`)
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function connect(portNumber, type) {
  const targets = await (await fetch(`http://127.0.0.1:${portNumber}/json/list`)).json()
  const target = targets.find((entry) => entry.type === type)
  if (!target) throw new Error(`no ${type} target`)
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let id = 0
  const pending = new Map()
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id
    pending.set(current, { resolve, reject })
    socket.send(JSON.stringify({ id: current, method, params }))
  })
  return {
    send,
    close: () => socket.close(),
    eval: async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails))
      return result.result?.value
    },
    shot: async (name) => {
      await sleep(400)
      const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const file = path.join(outDir, name)
      writeFileSync(file, Buffer.from(result.data, 'base64'))
      report.shots.push(name)
      return file
    },
  }
}

const child = spawn(appExecutable, [`--remote-debugging-port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] })
let appOutput = ''
child.stdout.on('data', (chunk) => { appOutput += chunk.toString() })
child.stderr.on('data', (chunk) => { appOutput += chunk.toString() })
let childExit = null
child.on('exit', (code, signal) => { childExit = { code, signal } })

let page = null
for (let attempt = 0; attempt < 100; attempt += 1) {
  if (childExit !== null) break
  try {
    page = await connect(port, 'page')
    break
  } catch {
    await sleep(250)
  }
}
if (!page) {
  console.error('BLOCKED: 打包应用 25 秒内没有暴露 page target')
  console.error(appOutput)
  child.kill('SIGKILL')
  process.exit(2)
}

await page.send('Runtime.enable')
await page.send('Page.enable')
await page.send('Network.enable')

const clickText = (text) => page.eval(`(() => {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(text)})
  if (!button) throw new Error('button not found: ' + ${JSON.stringify(text)})
  if (button.disabled) throw new Error('button disabled: ' + ${JSON.stringify(text)})
  button.click()
  return true
})()`)

/** 读取属性栏 dt/dd 行，用于断言「当前位移/设计上限」文案。 */
const propertyRows = () => page.eval(`(() => {
  const rows = [...document.querySelectorAll('#desktop-properties dl > div')]
  return rows.map((row) => [row.querySelector('dt')?.textContent ?? '', row.querySelector('dd')?.textContent ?? ''])
})()`)

/** 点击画布空白角落 → 清除部件选择（与产品空白点击清选一致）。 */
const clickCanvasEmpty = async () => {
  const rect = await page.eval(`(() => {
    const canvas = document.querySelector('.three-viewport canvas')
    const r = canvas.getBoundingClientRect()
    return { left: r.left, top: r.top }
  })()`)
  const x = Math.round(rect.left + 6)
  const y = Math.round(rect.top + 6)
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(300)
}

const waitFor = async (expression, label, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await page.eval(expression).catch(() => null)
    if (value) return value
    await sleep(200)
  }
  throw new Error(`timeout waiting for ${label}`)
}

/** 触发一次渲染后在同一帧回读画布像素（best-effort；硬证据用截图解码）。 */
const canvasPixels = () => page.eval(`(async () => {
  const canvas = document.querySelector('canvas[role="img"]')
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true }))
  return await new Promise((resolve) => {
    requestAnimationFrame(() => {
      const scratch = document.createElement('canvas')
      scratch.width = 64
      scratch.height = 48
      const context = scratch.getContext('2d')
      context.drawImage(canvas, 0, 0, 64, 48)
      const data = context.getImageData(0, 0, 64, 48).data
      const colors = new Set()
      let transparent = 0
      for (let index = 0; index < data.length; index += 4) {
        colors.add(data[index] + ',' + data[index + 1] + ',' + data[index + 2] + ',' + data[index + 3])
        if (data[index + 3] === 0) transparent += 1
      }
      resolve({
        distinctColors: colors.size,
        transparentRatio: Number((transparent / (64 * 48)).toFixed(3)),
        sample: [...colors].slice(0, 6),
        backingStore: [canvas.width, canvas.height],
        cssSize: [Math.round(rect.width), Math.round(rect.height)],
      })
    })
  })
})()`)

/**
 * 解 PNG（Chromium 截图：8 bit、非隔行、RGB/RGBA），用于在截图像素上验证画布确有模型。
 * 只依赖 node:zlib，不引入外部依赖。
 */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not png')
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 6
  let bitDepth = 8
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced png unsupported')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : null
  if (channels === null) throw new Error(`unsupported color type ${colorType}`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)]
    const source = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1))
    const target = out.subarray(row * stride, (row + 1) * stride)
    const previous = row === 0 ? null : out.subarray((row - 1) * stride, row * stride)
    for (let index = 0; index < stride; index += 1) {
      const rawByte = source[index]
      const left = index >= channels ? target[index - channels] : 0
      const up = previous ? previous[index] : 0
      const upLeft = previous && index >= channels ? previous[index - channels] : 0
      let value
      switch (filter) {
        case 0: value = rawByte; break
        case 1: value = rawByte + left; break
        case 2: value = rawByte + up; break
        case 3: value = rawByte + ((left + up) >> 1); break
        case 4: {
          const p = left + up - upLeft
          const pa = Math.abs(p - left)
          const pb = Math.abs(p - up)
          const pc = Math.abs(p - upLeft)
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
          value = rawByte + predictor
          break
        }
        default: throw new Error(`bad filter ${filter}`)
      }
      target[index] = value & 0xff
    }
  }
  return { width, height, channels, data: out }
}

/** 在截图的画布区域内统计颜色多样性（模型像素证据）。deviceScale 由截图宽度/视口宽度推出。 */
function analyzeShot(file, rect, viewportWidth) {
  const png = decodePng(readFileSync(file))
  const deviceScale = png.width / viewportWidth
  const x0 = Math.max(0, Math.round(rect[0] * deviceScale))
  const y0 = Math.max(0, Math.round(rect[1] * deviceScale))
  const x1 = Math.min(png.width, Math.round((rect[0] + rect[2]) * deviceScale))
  const y1 = Math.min(png.height, Math.round((rect[1] + rect[3]) * deviceScale))
  const colors = new Set()
  let offBackground = 0
  let total = 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * png.width + x) * png.channels
      const [r, g, b] = [png.data[index], png.data[index + 1], png.data[index + 2]]
      colors.add(`${r},${g},${b}`)
      if (Math.abs(r - 245) > 6 || Math.abs(g - 247) > 6 || Math.abs(b - 250) > 6) offBackground += 1
      total += 1
    }
  }
  return {
    imageSize: [png.width, png.height],
    region: [x0, y0, x1 - x0, y1 - y0],
    distinctColors: colors.size,
    offBackgroundRatio: Number((offBackground / Math.max(1, total)).toFixed(4)),
  }
}

const canvasRect = () => page.eval(`(() => {
  const canvas = document.querySelector('canvas[role="img"]')
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  return [rect.left, rect.top, rect.width, rect.height]
})()`)

const sceneState = () => page.eval(`(() => {
  const root = document.querySelector('.three-viewport')
  if (!root) return null
  const canvas = root.querySelector('canvas')
  const slider = root.querySelector('input[type="range"]')
  return {
    state: root.getAttribute('data-three-state'),
    webgl2: root.getAttribute('data-webgl2'),
    dpr: root.getAttribute('data-dpr'),
    glVersion: root.getAttribute('data-gl-version'),
    glRenderer: root.getAttribute('data-gl-renderer'),
    partCount: root.getAttribute('data-part-count'),
    canvasCount: document.querySelectorAll('.three-viewport canvas').length,
    exploded: slider ? Number(slider.value) : null,
    status: root.querySelector('.three-viewport__status')?.textContent ?? '',
  }
})()`)

const openShaftExample = async () => {
  await waitFor(`!!document.body.innerText.includes('打开轴系示例')`, 'start page')
  await clickText('打开轴系示例 · 示意装配（B1）')
  await waitFor(`document.querySelector('.three-viewport')?.getAttribute('data-three-state') === 'ready'`, '3D ready', 25000)
}

try {
  await waitFor(`!!document.querySelector('[aria-label="寸链启动页"]')`, 'start page rendered')

  // 1. 安全面：API 键集合与 A-04 基线一致，无远程资源。
  const apiKeys = await page.eval('Object.keys(window.cunlian).sort()')
  const expectedKeys = [
    'commitV2', 'inspectV2', 'listRecent', 'listRecovery', 'newProject', 'onEditorFlush', 'onMenuAction',
    'openProject', 'readAttachment', 'reattachSession', 'relinkRecent', 'requestClose', 'respondEditorFlush',
    'restoreRecovery', 'revealProject', 'saveProject', 'saveProjectAs', 'stageDraft',
  ]
  check('window.cunlian 键集合与 A-04 基线完全一致（B1 未新增 IPC）', JSON.stringify(apiKeys) === JSON.stringify(expectedKeys), JSON.stringify(apiKeys))
  const sandbox = await page.eval(`({ hasRequire: typeof require, hasProcess: typeof process, hasIpc: typeof window.ipcRenderer, generic: ['invoke','send','on'].filter((key) => typeof window.cunlian?.[key] !== 'undefined') })`)
  check('renderer 无 Node 全局与通用 IPC 逃逸口', sandbox.hasRequire === 'undefined' && sandbox.hasProcess === 'undefined' && sandbox.hasIpc === 'undefined' && sandbox.generic.length === 0, JSON.stringify(sandbox))

  // 2. 打开轴系示例：真实懒加载 chunk + WebGL2 创建
  await openShaftExample()
  const state1 = await sceneState()
  report.measurements.threeProbe = state1
  report.measurements.window1440 = await page.eval(`(() => {
    const canvas = document.querySelector('canvas[role="img"]')
    return {
      window: [window.outerWidth, window.outerHeight],
      inner: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      canvasCss: canvas ? [Math.round(canvas.clientWidth), Math.round(canvas.clientHeight)] : null,
      canvasBacking: canvas ? [canvas.width, canvas.height] : null,
      screen: [screen.width, screen.height],
    }
  })()`)
  check('3D 状态 ready、5 个语义部件、单一 canvas', state1.state === 'ready' && state1.partCount === '5' && state1.canvasCount === 1, JSON.stringify(state1))
  check('WebGL2 实际创建成功（产品路径）', state1.webgl2 === 'true' && /WebGL 2/i.test(state1.glVersion ?? ''), `${state1.glVersion} / ${state1.glRenderer}`)

  const independent = await page.eval(`(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) return null
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      version: gl.getParameter(gl.VERSION),
      shading: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : 'n/a',
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'n/a',
      attributes: gl.getContextAttributes(),
    }
  })()`)
  report.measurements.independentWebgl2 = independent
  check('独立探测：sandboxed renderer 可创建 WebGL2', independent !== null && /WebGL 2/i.test(independent.version), JSON.stringify(independent && { version: independent.version, renderer: independent.renderer }))

  const inPageSample = await canvasPixels()
  report.notes.push(`页内 drawImage 采样（受 preserveDrawingBuffer=false 影响，仅作参考）：${JSON.stringify(inPageSample)}`)

  // 3. 树→模型：隔套
  await clickText('隔套')
  await sleep(400)
  const selected = await page.eval(`(() => {
    const tree = document.querySelector('#desktop-tree')
    const button = [...tree.querySelectorAll('button')].find((item) => item.textContent.trim() === '隔套')
    return {
      pressed: button?.getAttribute('aria-pressed'),
      heading: document.querySelector('#desktop-properties h2')?.textContent,
      props: [...document.querySelectorAll('#desktop-properties dd')].map((item) => item.textContent),
      selectionText: document.querySelector('.three-viewport__selection')?.textContent,
      editDisabled: [...document.querySelectorAll('#desktop-properties button')].find((item) => item.textContent.includes('编辑参数'))?.disabled,
      canvas: (() => { const c = document.querySelector('canvas[role="img"]'); return c ? { css: [Math.round(c.clientWidth), Math.round(c.clientHeight)], backing: [c.width, c.height] } : null })(),
    }
  })()`)
  report.measurements.selection = selected
  check('树选中隔套：aria-pressed / 属性 / 当前选择同步', selected.pressed === 'true' && selected.heading === '属性 · 隔套' && selected.selectionText === '当前选择：隔套', JSON.stringify({ pressed: selected.pressed, heading: selected.heading, section: selected.selectionText }))
  check('隔套只读参数来自 q（20/32/12 mm），C 批次编辑按钮禁用', ['20.0000 mm', '32.0000 mm', '12.0000 mm'].every((value) => selected.props.includes(value)) && selected.editDisabled === true, JSON.stringify(selected.props))
  const selectedRows = await propertyRows()
  report.measurements.selectedRows = selectedRows
  check(
    '装配态属性：「爆炸位移（当前）」为 0，「设计最大位移（上限）」标注装配基准',
    new Map(selectedRows).get('爆炸位移（当前）') === '0.0 mm（X）'
      && new Map(selectedRows).get('设计最大位移（上限）') === '0.0 mm（X）（装配基准，不参与爆炸）',
    JSON.stringify(selectedRows),
  )
  await page.shot('1440-selected-spacer.png')
  const pixels1440 = analyzeShot(path.join(outDir, '1440-selected-spacer.png'), await canvasRect(), await page.eval('innerWidth'))
  report.measurements.pixels1440 = pixels1440
  check('1440 截图像素证明画布内有模型（非空 canvas）', pixels1440.distinctColors >= 8 && pixels1440.offBackgroundRatio > 0.02, JSON.stringify(pixels1440))

  // 4. 爆炸 100% + 像素证据
  await page.eval(`(() => {
    const input = document.querySelector('.three-viewport input[type="range"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '100')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(600)
  const exploded = await sceneState()
  report.measurements.exploded = { state: exploded }
  check('滑条 100% 后 t=1', exploded.exploded === 100, JSON.stringify({ slider: exploded.exploded }))
  check('爆炸后隔套仍保持选中（选择不被视觉变换覆盖）', (exploded.status ?? '').includes('当前选择：隔套'), exploded.status)
  await page.shot('1440-exploded-100.png')
  const explodedPixels = analyzeShot(path.join(outDir, '1440-exploded-100.png'), await canvasRect(), await page.eval('innerWidth'))
  report.measurements.pixelsExploded = explodedPixels
  check('爆炸 100% 截图仍有模型像素', explodedPixels.offBackgroundRatio > 0.02 && explodedPixels.distinctColors >= 8, JSON.stringify(explodedPixels))
  const explodedRows = await propertyRows()
  report.measurements.explodedRows = explodedRows
  check('爆炸 100%：隔套当前位移仍为 0（装配基准件如实显示自身状态）', new Map(explodedRows).get('爆炸位移（当前）') === '0.0 mm（X）', JSON.stringify(explodedRows))
  await clickText('左轴承')
  await sleep(400)
  const bearingRows = await propertyRows()
  report.measurements.explodedBearingRows = bearingRows
  check(
    '爆炸 100% 选左轴承：「当前」与「设计上限」均为 −24.0 mm（X）',
    new Map(bearingRows).get('爆炸位移（当前）') === '-24.0 mm（X）'
      && new Map(bearingRows).get('设计最大位移（上限）') === '-24.0 mm（X）',
    JSON.stringify(bearingRows),
  )
  await page.shot('1440-exploded-100-bearing-left.png')
  await clickText('隔套')
  await sleep(300)

  // 5. 复位装配
  await clickText('复位装配')
  await sleep(500)
  const reset = await sceneState()
  report.measurements.reset = reset
  check('复位装配：t=0 且隔套仍选中', reset.exploded === 0 && (reset.status ?? '').includes('当前选择：隔套'), JSON.stringify({ slider: reset.exploded, status: reset.status }))
  await page.shot('1440-reset-assembly.png')

  // 6. 降级：真实 contextlost，其他标签仍可用
  await page.eval(`(() => {
    const canvas = document.querySelector('canvas[role="img"]')
    const gl = canvas.getContext('webgl2')
    const extension = gl.getExtension('WEBGL_lose_context')
    if (!extension) throw new Error('WEBGL_lose_context 不可用')
    extension.loseContext()
    return true
  })()`)
  await waitFor(`document.querySelector('.three-viewport')?.getAttribute('data-three-state') === 'error'`, 'contextlost 降级', 10000)
  const degraded = await sceneState()
  const degradeText = await page.eval(`document.querySelector('.three-viewport [role="alert"]')?.textContent ?? ''`)
  report.measurements.degraded = { state: degraded, text: degradeText }
  check('contextlost 后局部降级并给出原因码', degraded.state === 'error' && degradeText.includes('3D 暂不可用'), `${degraded.state} :: ${degradeText.slice(0, 60)}`)
  const otherTabWorks = await page.eval(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === '尺寸链')
    tab.click()
    return new Promise((resolve) => setTimeout(() => resolve(document.body.innerText.includes('当前尺寸链')), 400))
  })()`)
  check('降级时其他标签仍可切换并渲染内容', otherTabWorks === true)
  await page.eval(`(() => { [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === '3D').click() })()`)
  await sleep(200)
  await page.shot('3d-degraded.png')
  await clickText('重试 3D 视图')
  await waitFor(`document.querySelector('.three-viewport')?.getAttribute('data-three-state') === 'ready'`, '重试恢复', 25000)
  const retried = await page.eval(`({ canvases: document.querySelectorAll('.three-viewport canvas').length, state: document.querySelector('.three-viewport').getAttribute('data-three-state') })`)
  report.measurements.retry = retried
  check('重试后恢复且只有一个 canvas（无叠加上下文）', retried.state === 'ready' && retried.canvases === 1, JSON.stringify(retried))

  // 7. 真实窗口缩到 960×640（BrowserWindow 逻辑尺寸；内容区 = 减去标题栏）
  let resizeMethod = 'none'
  await page.eval(`(() => { window.resizeTo(960, 640); return true })()`)
  await sleep(1000)
  let small = await page.eval(`(() => {
    const canvas = document.querySelector('canvas[role="img"]')
    const root = document.querySelector('.three-viewport')
    return {
      outer: [outerWidth, outerHeight],
      inner: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      canvasCss: canvas ? [Math.round(canvas.clientWidth), Math.round(canvas.clientHeight)] : null,
      canvasBacking: canvas ? [canvas.width, canvas.height] : null,
      overflowX: document.documentElement.scrollWidth - innerWidth,
      toolbarRows: new Set([...root.querySelectorAll('.three-viewport__toolbar button')].map((item) => Math.round(item.getBoundingClientRect().top))).size,
      toolbarBottom: Math.round(root.querySelector('.three-viewport__toolbar').getBoundingClientRect().bottom),
      stageTop: Math.round(root.querySelector('.three-viewport__stage').getBoundingClientRect().top),
      stageBottom: Math.round(root.querySelector('.three-viewport__stage').getBoundingClientRect().bottom),
      viewportBottom: Math.round(root.getBoundingClientRect().bottom),
    }
  })()`)
  if (small.outer[0] === 960 && small.outer[1] === 640) {
    resizeMethod = 'window.resizeTo → 真实 BrowserWindow 960×640'
  } else {
    report.notes.push(`window.resizeTo 未生效（outer=${JSON.stringify(small.outer)}），回退 Emulation.setDeviceMetricsOverride`)
    await page.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 640, deviceScaleFactor: 0, mobile: false })
    await sleep(600)
    resizeMethod = 'Emulation.setDeviceMetricsOverride（仿真，非真实窗口）'
    small = await page.eval(`(() => {
      const canvas = document.querySelector('canvas[role="img"]')
      const root = document.querySelector('.three-viewport')
      return {
        outer: [outerWidth, outerHeight], inner: [innerWidth, innerHeight], dpr: devicePixelRatio,
        canvasCss: canvas ? [Math.round(canvas.clientWidth), Math.round(canvas.clientHeight)] : null,
        canvasBacking: canvas ? [canvas.width, canvas.height] : null,
        overflowX: document.documentElement.scrollWidth - innerWidth,
        toolbarRows: new Set([...root.querySelectorAll('.three-viewport__toolbar button')].map((item) => Math.round(item.getBoundingClientRect().top))).size,
        toolbarBottom: Math.round(root.querySelector('.three-viewport__toolbar').getBoundingClientRect().bottom),
        stageTop: Math.round(root.querySelector('.three-viewport__stage').getBoundingClientRect().top),
        stageBottom: Math.round(root.querySelector('.three-viewport__stage').getBoundingClientRect().bottom),
        viewportBottom: Math.round(root.getBoundingClientRect().bottom),
      }
    })()`)
  }
  const smallViewportWidth = small.inner[0]
  report.measurements.smallWindow = { resizeMethod, ...small }
  check('960×640 真实窗口生效（outer=960×640，内容区 960×608）', small.outer[0] === 960 && small.outer[1] === 640 && small.inner[0] === 960, JSON.stringify({ resizeMethod, outer: small.outer, inner: small.inner }))
  check('960×640 无横向溢出，工具条不覆盖画布', small.overflowX <= 0 && small.toolbarBottom <= small.stageTop + 1 && small.stageBottom <= small.viewportBottom + 1, JSON.stringify({ overflowX: small.overflowX, toolbarBottom: small.toolbarBottom, stageTop: small.stageTop }))
  await page.shot('960-selected.png')
  const smallPixels = analyzeShot(path.join(outDir, '960-selected.png'), await canvasRect(), smallViewportWidth)
  report.measurements.smallPixels = smallPixels
  check('960×640 截图证明画布仍有模型像素', smallPixels.offBackgroundRatio > 0.02 && smallPixels.distinctColors >= 8, JSON.stringify(smallPixels))
  await page.eval(`(() => {
    const input = document.querySelector('.three-viewport input[type="range"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '100')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(600)
  await page.shot('960-exploded-100.png')
  const smallExplodedPixels = analyzeShot(path.join(outDir, '960-exploded-100.png'), await canvasRect(), smallViewportWidth)
  report.measurements.smallExplodedPixels = smallExplodedPixels
  check('960×640 爆炸 100% 截图仍有模型像素', smallExplodedPixels.offBackgroundRatio > 0.02, JSON.stringify(smallExplodedPixels))
  const smallExplodedRows = await propertyRows()
  report.measurements.smallExplodedRows = smallExplodedRows
  check('960 爆炸 100%：隔套当前位移为 0（装配基准件）', new Map(smallExplodedRows).get('爆炸位移（当前）') === '0.0 mm（X）', JSON.stringify(smallExplodedRows))
  await clickText('左轴承')
  await sleep(400)
  const smallBearingRows = await propertyRows()
  report.measurements.smallExplodedBearingRows = smallBearingRows
  check(
    '960 爆炸 100% 选左轴承：「当前」为 −24.0 mm（X）（非零、随滑条变化）',
    new Map(smallBearingRows).get('爆炸位移（当前）') === '-24.0 mm（X）'
      && new Map(smallBearingRows).get('设计最大位移（上限）') === '-24.0 mm（X）',
    JSON.stringify(smallBearingRows),
  )
  await page.shot('960-exploded-100-bearing-left.png')
  await clickText('隔套')
  await sleep(300)
  // 复位装配前清空选择：项目树不选中任何部件，再点复位（t=0）
  await clickCanvasEmpty()
  const cleared = await page.eval(`(() => ({
    pressed: [...document.querySelectorAll('#desktop-tree button[aria-pressed="true"]')].map((item) => item.textContent.trim()),
    heading: document.querySelector('#desktop-properties h2')?.textContent ?? '',
  }))()`)
  report.measurements.smallCleared = cleared
  check('960 复位前清空选择：树无 aria-pressed=true、属性标题为「属性 · 未选择」', cleared.pressed.length === 0 && cleared.heading === '属性 · 未选择', JSON.stringify(cleared))
  await clickText('复位装配')
  await sleep(500)
  const smallReset = await sceneState()
  const smallResetHeading = await page.eval(`document.querySelector('#desktop-properties h2')?.textContent ?? ''`)
  report.measurements.smallReset = { ...smallReset, heading: smallResetHeading }
  check('960 复位装配：滑条 0%、树仍无选中', smallReset.exploded === 0 && smallResetHeading === '属性 · 未选择', JSON.stringify(report.measurements.smallReset))
  await page.shot('960-reset-assembly.png')
  const sha256 = (name) => createHash('sha256').update(readFileSync(path.join(outDir, name))).digest('hex')
  const smallHashes = { selected: sha256('960-selected.png'), resetAssembly: sha256('960-reset-assembly.png') }
  report.measurements.smallHashes = smallHashes
  check('960-reset-assembly.png 与 960-selected.png 哈希不同（不是同一份字节）', smallHashes.selected !== smallHashes.resetAssembly, JSON.stringify(smallHashes))

  // 8. 离线等价验证：阻断全部 HTTP(S) 请求后整页重载，3D chunk 仍须从本地加载
  // （物理断网需要改动系统网络设置，不在本脚本权限内；此处阻断远程 URL，file:// 不受影响）
  await page.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] })
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3000)
  const offlineStart = await page.eval(`({
    hasStart: !!document.querySelector('[aria-label="寸链启动页"]'),
    hasWorkbench: !!document.querySelector('[aria-label="寸链桌面工作台"]'),
    href: location.href,
    body: document.body.innerText.slice(0, 160),
  })`)
  report.measurements.reloadWithBlockedHttp = offlineStart
  check('阻断 HTTP(S) 后重载仍渲染应用（生产 file:// 产物）', offlineStart.hasStart || offlineStart.hasWorkbench, JSON.stringify({ href: offlineStart.href, body: offlineStart.body }))
  let offlineScene = null
  if (offlineStart.hasStart) {
    await openShaftExample()
    offlineScene = await sceneState()
  } else {
    await page.eval(`(() => { [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === '3D')?.click() })()`)
    await sleep(300)
    const placeholder = await page.eval(`!![...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '查看内置轴系示例')`)
    if (placeholder) {
      await clickText('查看内置轴系示例')
      await waitFor(`document.querySelector('.three-viewport')?.getAttribute('data-three-state') === 'ready'`, '重载后重新打开示例', 25000)
    }
    offlineScene = await sceneState()
  }
  report.measurements.offlineScene = offlineScene
  check('阻断远程请求下 3D chunk 仍加载并渲染（无网络兜底）', offlineScene?.state === 'ready' && offlineScene?.webgl2 === 'true', JSON.stringify(offlineScene && { state: offlineScene.state, webgl2: offlineScene.webgl2, glVersion: offlineScene.glVersion }))
  await page.shot('960-offline-reopened.png')
  const offlinePixels = analyzeShot(path.join(outDir, '960-offline-reopened.png'), await canvasRect(), 960)
  report.measurements.offlinePixels = offlinePixels
  check('重载+重新打开后截图仍有模型像素', offlinePixels.offBackgroundRatio > 0.02 && offlinePixels.distinctColors >= 8, JSON.stringify(offlinePixels))
  const resources = await page.eval(`performance.getEntriesByType('resource').map((entry) => entry.name)`)
  const remote = (resources ?? []).filter((url) => !String(url).startsWith('file:'))
  report.measurements.resourceUrls = resources
  check('重载后所有资源均为本地 file://（无 HTTP(S) 请求）', remote.length === 0, JSON.stringify(remote))
  const blocked = await page.eval(`performance.getEntriesByType('resource').filter((entry) => entry.transferSize > 0 && !entry.name.startsWith('file:')).length`)
  report.measurements.remoteTransfers = blocked
  await page.send('Network.setBlockedURLs', { urls: [] })

  // 9. A-04 回归冒烟（回退门禁）：尺寸链编辑仍走原文链路，3D 状态不参与
  await page.eval(`(() => { [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === '尺寸链')?.click() })()`)
  await sleep(500)
  const beforeEdit = await page.eval(`(() => ({
    hasTable: !!document.querySelector('table[aria-label="组成环表"]'),
    nominal: document.querySelector('[aria-label="第 1 行 H 基本尺寸"]')?.value ?? null,
    target: document.querySelector('[aria-label="目标上限"]')?.value ?? null,
    saveState: document.querySelector('.desktop-workspace__pending')?.textContent ?? '',
  }))()`)
  await page.eval(`(() => {
    const input = document.querySelector('[aria-label="第 1 行 H 基本尺寸"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '52.3')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(1200)
  const reattached = await page.eval(`window.cunlian.reattachSession()`)
  const resultRange = await page.eval(`document.querySelector('[aria-label="当前计算结果"]')?.textContent ?? ''`)
  report.measurements.a04Edit = {
    beforeEdit,
    editSeq: reattached?.ok ? reattached.value.editSeq : null,
    nominalQ: reattached?.ok ? reattached.value.snapshot.project.dimensionChain.terms[0].nominalQ : null,
    dirty: reattached?.ok ? reattached.value.editSeq > reattached.value.savedSeq : null,
    resultRange,
  }
  check('A-04 尺寸链示例仍可打开（组成环表/52.2000/未保存草稿）', beforeEdit.hasTable && beforeEdit.nominal === '52.2000' && beforeEdit.saveState === '未保存草稿', JSON.stringify(beforeEdit))
  check('A-04 编辑仍经 main stageDraft（editSeq 1、nominalQ 523000、dirty）', report.measurements.a04Edit.editSeq === 1 && report.measurements.a04Edit.nominalQ === 523000 && report.measurements.a04Edit.dirty === true, JSON.stringify({ editSeq: report.measurements.a04Edit.editSeq, nominalQ: report.measurements.a04Edit.nominalQ }))
  check('A-04 结果按原领域公式重算（52.3 输入 → 0.2500 至 0.3500 mm）', String(report.measurements.a04Edit.resultRange).includes('0.2500 至 0.3500'), report.measurements.a04Edit.resultRange)

  // 10. 重载后示例视图需重新打开（用户拍板的阶段限制），且 reattach 保留 A-04 编辑
  await page.send('Page.reload')
  await sleep(3000)
  const afterReload = await page.eval(`(() => ({
    workbench: !!document.querySelector('[aria-label="寸链桌面工作台"]'),
    partsEmpty: !!document.body.innerText.includes('尚未打开轴系示例'),
    saveState: document.querySelector('.desktop-workspace__pending')?.textContent ?? '',
    canvases: document.querySelectorAll('.three-viewport canvas').length,
  }))()`)
  const reloadedSession = await page.eval(`window.cunlian.reattachSession()`)
  report.measurements.afterReload = {
    ...afterReload,
    editSeq: reloadedSession?.ok ? reloadedSession.value.editSeq : null,
    savedSeq: reloadedSession?.ok ? reloadedSession.value.savedSeq : null,
    nominalQ: reloadedSession?.ok ? reloadedSession.value.snapshot.project.dimensionChain.terms[0].nominalQ : null,
  }
  check(
    '整页重载后 reattach 保留 A-04 编辑（editSeq 1 / nominalQ 523000），3D 示例按设计需重新打开',
    afterReload.workbench && afterReload.saveState === '未保存草稿' && afterReload.partsEmpty && afterReload.canvases === 0
      && report.measurements.afterReload.editSeq === 1 && report.measurements.afterReload.nominalQ === 523000,
    JSON.stringify(report.measurements.afterReload),
  )
} catch (error) {
  check('采集流程未中断', false, String(error && error.message ? error.message : error))
} finally {
  try { page.close() } catch { /* 窗口可能已销毁 */ }
  child.kill('SIGKILL')
  await sleep(300)
  report.finishedAt = new Date().toISOString()
  report.result = failures.length === 0 ? 'PASS' : `FAIL(${failures.join(',')})`
  writeFileSync(path.join(outDir, 'b1-electron-report.json'), JSON.stringify(report, null, 2))
  console.log(`E2E_RESULT=${report.result}`)
  process.exit(failures.length === 0 ? 0 : 1)
}
