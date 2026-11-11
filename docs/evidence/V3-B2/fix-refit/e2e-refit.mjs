// V3-B2 修复端到端：打包产物里 新建项目 → 导入 pr2 → 替换圆盘 → 替换扳手，
// 每步截图 + 在页面内对 canvas 区域做像素统计（证明“模型在视野里”，不只是“没报错”）。
//
// 用法（app 先以 --inspect=9229 --remote-debugging-port=9336 启动）：
//   OUT_DIR=<证据目录> PREFIX=before node e2e-refit.mjs
//
// 测试替身说明：只把 main 进程的原生“打开文件”对话框返回值替换为固定路径，
// 其余导入/替换、IPC、STL 解析、three 渲染全部走打包产物真实代码；
// 原生“未保存编辑”提示同理由测试替身选择“不保存”，避免用手动点击改变本机授权。
import { mkdirSync, writeFileSync } from 'node:fs'
import { serializeEvidence } from '../../../../scripts/evidence-json.ts'
import WebSocket from '/Users/aston/DSH/wt/dsh-v3-A/node_modules/ws/index.js'

const OUT = process.env.OUT_DIR ?? '/Users/aston/DSH/wt/dsh-v3-A/docs/evidence/V3-B2/fix-refit'
const PREFIX = process.env.PREFIX ?? 'run'
const PORT = Number(process.env.PORT ?? 9336)
const MAIN_PORT = Number(process.env.MAIN_PORT ?? 9229)
const DIR = '/Users/aston/DSH/tmp/cunlian-v3/stl-samples'
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function connect(url) {
  const ws = new WebSocket(url)
  let nextId = 0
  const pending = new Map()
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  ws.on('message', (raw) => {
    const message = JSON.parse(raw)
    if (!message.id || !pending.has(message.id)) return
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
  })
  return { ws, send, ready: new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  }) }
}

async function findTarget(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page') ?? targets[0]
      if (page) return page
    } catch {
      // 端口尚未就绪
    }
    await sleep(400)
  }
  throw new Error(`BLOCKED: ${port} 在 20 秒内没有 target`)
}

const pageTarget = await findTarget(PORT)
const renderer = connect(pageTarget.webSocketDebuggerUrl)
const mainTarget = await findTarget(MAIN_PORT)
const main = connect(mainTarget.webSocketDebuggerUrl)
await Promise.all([renderer.ready, main.ready])

async function ev(expression) {
  const result = await renderer.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) {
    throw new Error(`evaluate failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
  }
  return result.result.value
}

async function mainEval(expression) {
  const result = await main.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(`main evaluate failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
  return result.result.value
}

async function waitFor(expression, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await ev(expression)) return
    await sleep(300)
  }
  throw new Error(`TIMEOUT: ${label}`)
}

const clickButton = (text, exact = true) => ev(`(() => {
  const b=[...document.querySelectorAll('button')].find(x=>${exact ? `x.textContent.trim()===${JSON.stringify(text)}` : `x.textContent.includes(${JSON.stringify(text)})`});
  if(!b) return 'MISS';
  b.click(); return 'ok';
})()`)

// main 进程：只替换原生对话框返回值；其余逻辑不动。
await mainEval(`(() => {
  const electron = process.mainModule.require('electron');
  const d = electron.dialog;
  const stub = globalThis.__e2eStub ?? (globalThis.__e2eStub = { modelPath: null, projectPath: null });
  if (!d.__e2ePatched) {
    const originalOpen = d.showOpenDialog.bind(d);
    d.showOpenDialog = async (...args) => {
      if (stub.modelPath) return { canceled: false, filePaths: [stub.modelPath] };
      if (stub.projectPath) return { canceled: false, filePaths: [stub.projectPath] };
      return originalOpen(...args);
    };
    // 仅本测试进程：未保存编辑的提示一律选择“不保存”（index 1）。
    d.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    d.__e2ePatched = true;
  }
  return JSON.stringify({ patched: true, modelPath: stub.modelPath });
})()`)

async function chooseModel(file) {
  const path = `${DIR}/${file}`
  await mainEval(`globalThis.__e2eStub.modelPath = ${JSON.stringify(path)}`)
}

async function confirmImport() {
  await waitFor(`(() => !!document.querySelector('[role=dialog][aria-label="确认导入模型"]'))()`, '导入确认对话框', 30000)
  const clicked = await ev(`(() => {
    const d=document.querySelector('[role=dialog][aria-label="确认导入模型"]');
    const b=[...d.querySelectorAll('button')].find(x=>x.textContent.trim()==='导入为不可变版本');
    if(!b) return 'MISS'; b.click(); return 'ok';
  })()`)
  if (clicked !== 'ok') throw new Error('确认按钮不可点')
  await sleep(4500)
}

async function probe() {
  return JSON.parse(await ev(`(() => {
    const canvas=document.querySelector('.model-viewport__stage canvas');
    const rect=canvas?.getBoundingClientRect();
    const banner=document.body.innerText.match(/导入模型 · ([^\\n]{0,80})/);
    const status=document.body.innerText.match(/3D (就绪|暂不可用)[^\\n]{0,30}/);
    return JSON.stringify({
      canvasCount: document.querySelectorAll('canvas').length,
      status: status ? status[0] : null,
      banner: banner ? banner[1] : null,
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    });
  })()`))
}

async function screenshotAndAnalyze(label) {
  const info = await probe()
  const shot = await renderer.send('Page.captureScreenshot', { format: 'png' })
  const file = `${OUT}/${PREFIX}-${label}.png`
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
  const analysis = JSON.parse(await ev(`(async () => {
    const img=new Image(); img.src='data:image/png;base64,${shot.data}'; await img.decode();
    const scale=img.width/window.innerWidth;
    const rect=${JSON.stringify(info.rect)};
    if(!rect) return JSON.stringify({error:'no canvas'});
    const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
    const ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
    const x=Math.round(rect.x*scale), y=Math.round(rect.y*scale);
    const w=Math.max(1,Math.round(rect.width*scale)), h=Math.max(1,Math.round(rect.height*scale));
    const data=ctx.getImageData(x,y,w,h).data;
    let non=0,minX=w,minY=h,maxX=-1,maxY=-1;
    for(let py=0;py<h;py+=1){
      for(let px=0;px<w;px+=1){
        const i=(py*w+px)*4;
        const d=Math.abs(data[i]-245)+Math.abs(data[i+1]-247)+Math.abs(data[i+2]-250);
        if(d>24){
          non+=1;
          if(px<minX)minX=px; if(px>maxX)maxX=px; if(py<minY)minY=py; if(py>maxY)maxY=py;
        }
      }
    }
    return JSON.stringify({
      canvasPixels:{w,h},
      nonBackground:non,
      coverage:+(non/(w*h)).toFixed(4),
      bboxFraction: non ? {x:+(minX/w).toFixed(3), y:+(minY/h).toFixed(3), w:+((maxX-minX+1)/w).toFixed(3), h:+((maxY-minY+1)/h).toFixed(3)} : null,
    });
  })()`))
  return { label, file, ...info, analysis }
}

const steps = []
await sleep(1500)
// 每次运行都新建空项目：与用户现场“先导入、再替换”的起点一致。
let created = await clickButton('新建项目')
if (created !== 'ok') created = await clickButton('新建项目…')
if (created !== 'ok') throw new Error('找不到“新建项目”')
await waitFor(`(() => !!document.querySelector('#new-project-name'))()`, '新建项目对话框', 15000)
await ev(`(() => {
  const input=document.querySelector('#new-project-name');
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  setter.call(input,'V3 B2 替换相机自测');
  input.dispatchEvent(new Event('input',{bubbles:true}));
  return input.value;
})()`)
if (await clickButton('新建') !== 'ok') throw new Error('找不到“新建”提交按钮')
await waitFor(`(() => !document.querySelector('#new-project-name') && !!document.querySelector('[role=tab]'))()`, '新会话工作台', 30000)
await sleep(1000)
await ev(`(() => {const t=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='3D'); if(!t) return 'MISS'; t.click(); return 'ok'})()`)
await sleep(1500)

// 第 1 步：导入 pr2（二进制，1000 面，span≈0.25–0.32）
await chooseModel('pr2-head-pan-binary.stl')
if (await clickButton('导入模型…') !== 'ok') throw new Error('找不到“导入模型…”')
await confirmImport()
await waitFor(`(() => document.querySelectorAll('.model-viewport__stage canvas').length===1 && /3D 就绪/.test(document.body.innerText))()`, '首次导入就绪', 40000)
await sleep(1200)
steps.push(await screenshotAndAnalyze('01-pr2'))

// 第 2 步：替换为圆盘（ASCII，288 面，span≈1.0）
await chooseModel('slotted-disk-ascii.stl')
if (await clickButton('替换模型…') !== 'ok') throw new Error('找不到“替换模型…”')
await confirmImport()
await waitFor(`(() => document.querySelectorAll('.model-viewport__stage canvas').length===1 && /3D 就绪/.test(document.body.innerText))()`, '圆盘替换就绪', 40000)
await sleep(1200)
steps.push(await screenshotAndAnalyze('02-disk'))

// 第 3 步：替换为 NASA 扳手（14,564 面，span≈114）
await chooseModel('nasa-wrench.stl')
if (await clickButton('替换模型…') !== 'ok') throw new Error('找不到“替换模型…”')
await confirmImport()
await waitFor(`(() => document.querySelectorAll('.model-viewport__stage canvas').length===1 && /3D 就绪/.test(document.body.innerText))()`, '扳手替换就绪', 40000)
await sleep(1200)
steps.push(await screenshotAndAnalyze('03-wrench'))

// 第 4 步：手动点“重置视角”，与替换后的自动 fit 对比
if (await clickButton('重置视角') !== 'ok') throw new Error('找不到“重置视角”')
await sleep(1500)
steps.push(await screenshotAndAnalyze('04-wrench-after-reset'))

const report = { prefix: PREFIX, steps }
const blank = steps.filter((step) => step.analysis?.coverage !== undefined && step.analysis.coverage < 0.005)
report.verdict = blank.length === 0 ? 'PASS' : `FAIL: ${blank.map((s) => s.label).join(', ')} 覆盖率为 0`
writeFileSync(`${OUT}/${PREFIX}-report.json`, serializeEvidence(report))
console.log(JSON.stringify(report, null, 1))
renderer.ws.close()
main.ws.close()
process.exit(0)
