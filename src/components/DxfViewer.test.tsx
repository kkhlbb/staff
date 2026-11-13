// @vitest-environment jsdom
/**
 * DXF 看图组件：真实样本字节 + jsdom 里的真实点击。
 *
 * 平移/缩放的坐标换算走 `sceneToClient` / `clientToScene`（与组件同一套公式），
 * 测试不重写几何，只验证「点到的东西」和界面上的数字。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DxfViewer } from './DxfViewer'
import { expectNoUiInternalIds } from '../test/uiIdGuard'
import { sceneToClient } from '../dxf-view/scene'
import { USER_INPUT_BASIS } from '../drawing/types'

const SAMPLES = path.join(process.cwd(), 'docs', 'evidence', 'dxf-depth', 'samples')

function readSample(file: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(SAMPLES, file)))
}

const SAMPLE_2000_1X2 = 'spacer-20x32x12.05-dxf-2000-1x2.dxf'
const SAMPLE_USERINPUT = 'spacer-20x32x12.05-dxf-2000-1x2-userinput.dxf'
const SAMPLE_R12 = 'spacer-20x32x12.05-dxf-r12-1x1.dxf'

function parseViewBox(value: string | null): { x: number; y: number; width: number; height: number } {
  if (value === null) throw new Error('svg 缺 viewBox')
  const [x, y, width, height] = value.split(/\s+/).map(Number)
  return { x, y, width, height }
}

function mockRect(svg: Element, width = 840, height = 594): void {
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

function clickScene(svg: Element, x: number, y: number): void {
  const box = parseViewBox(svg.getAttribute('viewBox'))
  const rect = svg.getBoundingClientRect()
  const point = sceneToClient(rect, box, x, y)
  fireEvent.click(svg, { clientX: point.clientX, clientY: point.clientY })
}

const SYNTHETIC_UNSUPPORTED = [
  '0', 'SECTION', '2', 'HEADER',
  '9', '$ACADVER', '1', 'AC1015',
  '9', '$DWGCODEPAGE', '3', 'UTF-8',
  '9', '$INSUNITS', '70', '4',
  '9', '$EXTMIN', '10', '0', '20', '0', '30', '0',
  '9', '$EXTMAX', '10', '100', '20', '100', '30', '0',
  '9', '$PLIMMIN', '10', '0', '20', '0',
  '9', '$PLIMMAX', '10', '100', '20', '100',
  '0', 'ENDSEC',
  '0', 'SECTION', '2', 'TABLES',
  '0', 'TABLE', '2', 'LAYER', '70', '1',
  '0', 'LAYER', '2', '轮廓', '70', '0', '62', '7', '6', 'CONTINUOUS',
  '0', 'ENDTAB', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES',
  '0', 'LINE', '8', '轮廓', '10', '0', '20', '0', '11', '100', '21', '0',
  '0', 'SPLINE', '8', '轮廓', '10', '0', '20', '0',
  '0', 'HATCH', '8', '轮廓', '10', '0', '20', '0',
  '0', 'ENDSEC', '0', 'EOF',
].join('\n')

function gElements(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('g[data-entity-id]'))
}

function countLayer(container: HTMLElement, layer: string): number {
  // jsdom 的 nwsapi 对非 ASCII 属性值选择器不可靠，按属性值过滤。
  return gElements(container).filter((node) => node.getAttribute('data-layer') === layer).length
}

describe('DXF 看图组件（只读）', () => {
  it('打开 2000 1:2 样本：A3 图框、标题栏中文、三条 42 标注值', () => {
    const { container } = render(
      <DxfViewer fileName={SAMPLE_2000_1X2} bytes={readSample(SAMPLE_2000_1X2)} />,
    )
    expect(screen.getByText(SAMPLE_2000_1X2)).toBeInTheDocument()
    expect(screen.getByText('DXF 2000')).toBeInTheDocument()
    expectNoUiInternalIds(container)
    expect(screen.getByText(/编码 GBK（ANSI_936）/)).toBeInTheDocument()
    expect(screen.getByText('单位 mm（$INSUNITS=4）')).toBeInTheDocument()
    const layerBoxes = screen.getAllByRole('checkbox')
    expect(layerBoxes).toHaveLength(5)
    expect(screen.getAllByText(/轮廓|中心线|尺寸|文字|图框/).length).toBeGreaterThanOrEqual(5)

    const svgText = Array.from(container.querySelectorAll('svg text')).map((node) => node.textContent).join('\n')
    expect(svgText).toContain('A3 横向 · 第三角')
    expect(svgText).toContain('12.050')
    expect(svgText).toContain('⌀20.000')
    expect(svgText).toContain('⌀32.000')
    expect(svgText).toContain('依据')
    expect(screen.getByTestId('dxf-unsupported-empty')).toHaveTextContent('全部实体均已渲染')
    expect(screen.queryByTestId('dxf-encoding-warning')).toBeNull()
  })

  it('userinput 样本：标题栏/技术要求显示「依据：用户输入，无外部原文件」', () => {
    const { container } = render(
      <DxfViewer fileName={SAMPLE_USERINPUT} bytes={readSample(SAMPLE_USERINPUT)} />,
    )
    const svgText = Array.from(container.querySelectorAll('svg text')).map((node) => node.textContent).join('\n')
    expect(svgText).toContain(USER_INPUT_BASIS)
    expect(svgText).toContain(`6. ${USER_INPUT_BASIS}。`)
  })

  it('R12 样本：图纸空间标签不可用，模型空间显示单张 A4 图', () => {
    render(<DxfViewer fileName={SAMPLE_R12} bytes={readSample(SAMPLE_R12)} />)
    expect(screen.getByText('DXF R12')).toBeInTheDocument()
    const paperTab = screen.getByRole('tab', { name: '图纸空间' })
    expect(paperTab).toBeDisabled()
    expect(screen.getByText('1:1 · mm')).toBeInTheDocument()
    expect(screen.getByText('45 钢')).toBeInTheDocument()
  })

  it('编码解码失败：界面明确提示文字可能不正确', () => {
    const broken = new Uint8Array([...readSample(SAMPLE_2000_1X2), 0xff])
    render(<DxfViewer fileName="broken.dxf" bytes={broken} />)
    expect(screen.getByTestId('dxf-encoding-warning')).toHaveTextContent(
      '本文件编码未识别，文字可能不正确',
    )
  })

  it('未支持实体按类型显示「未渲染 N 个 XXX（不支持）」', () => {
    render(
      <DxfViewer fileName="unsupported.dxf" bytes={new TextEncoder().encode(SYNTHETIC_UNSUPPORTED)} />,
    )
    const panel = screen.getByTestId('dxf-unsupported')
    expect(panel).toHaveTextContent('未渲染 1 个 SPLINE（不支持）')
    expect(panel).toHaveTextContent('未渲染 1 个 HATCH（不支持）')
  })

  it('图层开关真的隐藏该层实体', () => {
    const { container } = render(
      <DxfViewer fileName={SAMPLE_2000_1X2} bytes={readSample(SAMPLE_2000_1X2)} />,
    )
    expect(countLayer(container, '中心线')).toBeGreaterThan(0)
    fireEvent.click(screen.getByLabelText('显示图层 中心线'))
    expect(countLayer(container, '中心线')).toBe(0)
    // 其它图层仍在。
    expect(countLayer(container, '轮廓')).toBeGreaterThan(0)
    fireEvent.click(screen.getByLabelText('显示图层 中心线'))
    expect(countLayer(container, '中心线')).toBeGreaterThan(0)
  })

  it('点选实体：属性面板给出类型、图层与关键坐标', () => {
    const { container } = render(
      <DxfViewer fileName={SAMPLE_2000_1X2} bytes={readSample(SAMPLE_2000_1X2)} />,
    )
    const svg = container.querySelector('[data-testid="dxf-canvas"]')!
    mockRect(svg)
    // A3 图框底线 y=-10（显示坐标），x=200 落在线上。
    clickScene(svg, 200, -10)
    expect(screen.getByTestId('dxf-selected-type')).toHaveTextContent('POLYLINE')
    expect(screen.getAllByText('图框').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByTestId('dxf-selection')).toBeInTheDocument()
    expect(screen.getByTestId('dxf-inspector')).toHaveTextContent(/关键坐标/)
  })

  it('量距：两点咬合到图框角点，显示 400.00 mm', () => {
    const { container } = render(
      <DxfViewer fileName={SAMPLE_2000_1X2} bytes={readSample(SAMPLE_2000_1X2)} />,
    )
    const svg = container.querySelector('[data-testid="dxf-canvas"]')!
    mockRect(svg)
    fireEvent.click(screen.getByRole('button', { name: '量距' }))
    clickScene(svg, 10, -10)
    clickScene(svg, 410, -10)
    expect(screen.getByTestId('dxf-measure')).toHaveTextContent('400.00 mm')
  })

  it('滚轮缩放改变 viewBox（真坐标变换）并更新百分比', () => {
    const { container } = render(
      <DxfViewer fileName={SAMPLE_2000_1X2} bytes={readSample(SAMPLE_2000_1X2)} />,
    )
    const svg = container.querySelector('[data-testid="dxf-canvas"]')!
    mockRect(svg)
    const before = parseViewBox(svg.getAttribute('viewBox'))
    expect(screen.getByTestId('dxf-zoom')).toHaveTextContent('100%')
    fireEvent.wheel(svg, { deltaY: -240, clientX: 420, clientY: 297 })
    const after = parseViewBox(svg.getAttribute('viewBox'))
    expect(after.width).toBeLessThan(before.width)
    expect(Number(screen.getByTestId('dxf-zoom').textContent!.replace('%', ''))).toBeGreaterThan(100)
  })

  it('切到模型空间：模型文字仍在，图纸空间图框不在', () => {
    const { container } = render(
      <DxfViewer fileName={SAMPLE_2000_1X2} bytes={readSample(SAMPLE_2000_1X2)} />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '模型' }))
    const svgText = Array.from(container.querySelectorAll('svg text')).map((node) => node.textContent).join('\n')
    expect(svgText).toContain('第三角投影：右端视图置于主视图右侧')
    expect(svgText).toContain('12.050')
    expect(svgText).not.toContain('A3 横向 · 第三角')
  })
})
