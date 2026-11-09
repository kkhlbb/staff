/**
 * 专用本地打印入口（V3-C-04/C-05）。
 *
 * 由 main 用隐藏 BrowserWindow 加载；没有 preload、没有通用 IPC，只接收 main
 * 通过 executeJavaScript 传进来的**已校验** DrawingData SVG 与内嵌字体。这里
 * 不读工作区像素、不读 3D 场景、不发网络请求，也不重新用参数画另一套线。
 */
import './drawingPrint.css'

export interface PrintFontAsset {
  family: string
  dataUrl: string
}

export interface PrintPayload {
  svg: string
  /** 两个 OFL 子集：Noto Sans SC（中文/数字）与 Noto Sans Math（⌀ ±）。 */
  fonts: PrintFontAsset[]
  drawingId: string
  fingerprint: string
  /** 必须出现的字符，用于字体检查。 */
  probeText: string
}

export interface PrintReadyStatus {
  drawingId: string
  fingerprint: string
  svgFingerprint: string | null
  fontsReady: boolean
  glyphsOk: boolean
  svgMounted: boolean
  loadedFamilies: string[]
  viewportWidthPx: number
  viewportHeightPx: number
  bbox: { x: number; y: number; width: number; height: number } | null
  errors: string[]
}

declare global {
  interface Window {
    __cunlianPrint?: (payload: PrintPayload) => Promise<PrintReadyStatus>
  }
}

/** 用 FontFace API 显式加载；比只写 @font-face + fonts.ready 更能暴露失败。 */
async function installFonts(fonts: PrintFontAsset[]): Promise<{ loaded: string[]; errors: string[] }> {
  const loaded: string[] = []
  const errors: string[] = []
  for (const font of fonts) {
    try {
      const face = new FontFace(font.family, `url(${font.dataUrl})`, { weight: '400' })
      await face.load()
      const fontSet = document.fonts as unknown as { add(face: FontFace): void }
      fontSet.add(face)
      const style = document.createElement('style')
      style.textContent = `@font-face{font-family:'${font.family}';src:url('${font.dataUrl}') format('woff2');font-weight:400;font-style:normal;font-display:block}`
      document.head.appendChild(style)
      loaded.push(font.family)
    } catch (error) {
      errors.push(`字体 ${font.family} 加载失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { loaded, errors }
}

function mountSvg(svgText: string, errors: string[]): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (parsed.getElementsByTagName('parsererror').length > 0) {
    errors.push('打印页无法解析 SVG')
    return null
  }
  const svg = parsed.documentElement
  if (svg.tagName.toLowerCase() !== 'svg') {
    errors.push('打印页收到的根元素不是 svg')
    return null
  }
  const imported = document.importNode(svg, true) as unknown as SVGSVGElement
  const root = document.getElementById('root')
  if (root === null) {
    errors.push('打印页缺少根容器')
    return null
  }
  root.replaceChildren(imported)
  return imported
}

window.__cunlianPrint = async (payload: PrintPayload): Promise<PrintReadyStatus> => {
  const errors: string[] = []
  const installed = await installFonts(payload.fonts)
  errors.push(...installed.errors)
  const svg = mountSvg(payload.svg, errors)

  let fontsReady = false
  let glyphsOk = false
  try {
    for (const font of payload.fonts) {
      await document.fonts.load(`3.5px '${font.family}'`, payload.probeText)
    }
    await document.fonts.ready
    // 两套字体都必须 loaded；check() 对不存在的 family 会回退，不能单独当证据。
    fontsReady =
      installed.loaded.length === payload.fonts.length &&
      payload.fonts.every((font) => document.fonts.check(`3.5px '${font.family}'`, payload.probeText))
    const probe = document.createElement('span')
    probe.style.font = `3.5px 'Noto Sans SC Cunlian','Noto Sans Math Cunlian'`
    probe.style.position = 'absolute'
    probe.style.visibility = 'hidden'
    probe.textContent = payload.probeText
    document.body.appendChild(probe)
    const width = probe.getBoundingClientRect().width
    probe.remove()
    glyphsOk = fontsReady && width > 0
    if (!glyphsOk) errors.push('字体或所需字形不可用')
  } catch (error) {
    errors.push(`字体等待失败：${error instanceof Error ? error.message : String(error)}`)
  }

  let bbox: PrintReadyStatus['bbox'] = null
  if (svg !== null) {
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const box = svg.getBBox()
      bbox = { x: box.x, y: box.y, width: box.width, height: box.height }
    } catch (error) {
      errors.push(`SVG 布局测量失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const svgFingerprint =
    svg === null ? null : svg.getAttribute('data-drawing-fingerprint')
  if (svgFingerprint !== payload.fingerprint) {
    errors.push('打印页 SVG 指纹与请求不一致')
  }
  if (svg === null) errors.push('SVG 未挂载')

  return {
    drawingId: payload.drawingId,
    fingerprint: payload.fingerprint,
    svgFingerprint,
    fontsReady,
    glyphsOk,
    svgMounted: svg !== null,
    loadedFamilies: installed.loaded,
    viewportWidthPx: document.documentElement.clientWidth,
    viewportHeightPx: document.documentElement.clientHeight,
    bbox,
    errors,
  }
}
