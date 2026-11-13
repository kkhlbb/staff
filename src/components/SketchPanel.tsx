/**
 * 手绘草图入口：导入图片 → 图上框选 → 用户自己填读数 → 提交未核对候选。
 *
 * 边界（界面层面）：
 * - 界面固定写明「图上不测量，尺寸由你输入；框选只用来记住位置」；
 * - 显示方向按 EXIF 1/3/6/8 旋转，框选坐标换算回**原图像素**后才提交；
 * - 不做 OCR、不做图像识别、不按像素推算毫米；读数只来自用户输入；
 * - 图片字节只在本进程内变成 canvas 像素，不写日志、不进证据。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  IpcResult,
  SketchImageImportValue,
  SketchIngestRequest,
  SketchIngestValue,
  SnapshotDto,
  SourceReadValue,
} from '../../desktop/shared/contracts'
import { tryParseMm } from '../domain/units'
import { readJpegOrientation, type SketchOrientation } from '../sketch/orientation'
import { SKETCH_NO_MEASURE_NOTICE } from '../sketch/imageFormat'
import {
  displayedPixelSize,
  selectionToSourceRect,
  sourceRectToViewRect,
  type ImagePixelRect,
  type SketchView,
  type ViewPoint,
} from '../sketch/selection'
import './SketchPanel.css'

const IMAGE_FILE = /\.(png|jpe?g)$/iu

type ReadingPayload = SketchIngestRequest['payload']['readings'][number]

interface BoxDraft {
  readonly symbol: string
  readonly rect: ImagePixelRect | null
}

interface LoadedImage {
  readonly revisionId: string
  readonly sha256: string
  readonly width: number
  readonly height: number
  readonly orientation: SketchOrientation
  readonly bitmap: ImageBitmap
}

export interface SketchPanelProps {
  snapshot: SnapshotDto
  disabled: boolean
  onImport: () => Promise<IpcResult<SketchImageImportValue> | null>
  onSubmit: (payload: SketchIngestRequest['payload']) => Promise<IpcResult<SketchIngestValue> | null>
  readAttachment: (revisionId: string) => Promise<IpcResult<SourceReadValue>>
}

function orientationText(orientation: SketchOrientation): string {
  return orientation === 1 ? '0°' : orientation === 3 ? '180°' : orientation === 6 ? '顺时针 90°' : '顺时针 270°'
}

export function SketchPanel({ snapshot, disabled, onImport, onSubmit, readAttachment }: SketchPanelProps) {
  const images = useMemo(
    () => snapshot.revisions.filter((revision) => IMAGE_FILE.test(revision.fileName)),
    [snapshot.revisions],
  )
  const [selectedId, setSelectedId] = useState<string>('')
  const revisionId = selectedId !== '' && images.some((item) => item.id === selectedId)
    ? selectedId
    : (images[images.length - 1]?.id ?? '')
  const revision = images.find((item) => item.id === revisionId) ?? null

  const [loadedState, setLoaded] = useState<LoadedImage | null>(null)
  const loaded = loadedState !== null && loadedState.revisionId === revisionId ? loadedState : null
  const [view, setView] = useState<SketchView>({ zoom: 1, panX: 0, panY: 0 })
  const [boxes, setBoxes] = useState<BoxDraft[]>([])
  const [draftRect, setDraftRect] = useState<ImagePixelRect | null>(null)
  const [drag, setDrag] = useState<{ start: ViewPoint; end: ViewPoint } | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState<string[] | null>(null)
  const [form, setForm] = useState({ symbol: '', nominal: '', upper: '', lower: '' })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const readingsRef = useRef(new Map<string, ReadingPayload>())

  const fit = useCallback((image: LoadedImage) => {
    const stage = stageRef.current
    if (stage === null) return
    const { width: displayWidth, height: displayHeight } = displayedPixelSize(
      image.orientation, image.width, image.height)
    const availableWidth = stage.clientWidth > 0 ? stage.clientWidth - 16 : displayWidth
    const availableHeight = stage.clientHeight > 0 ? stage.clientHeight - 16 : displayHeight
    const zoom = Math.max(0.1, Math.min(1, availableWidth / displayWidth, availableHeight / displayHeight))
    setView({
      zoom,
      panX: Math.max(0, (stage.clientWidth - displayWidth * zoom) / 2),
      panY: Math.max(0, (stage.clientHeight - displayHeight * zoom) / 2),
    })
  }, [])

  // 读图：字节只在本进程内变成 canvas，不进日志或证据。
  const loadId = revision?.id
  const loadFileName = revision?.fileName
  const loadSha = revision?.sha256
  useEffect(() => {
    if (loadId === undefined) return
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (cancelled) return
      setMessage('正在读取图片…'); setError('')
      const result = await readAttachment(loadId)
      if (cancelled) return
      if (!result.ok) { setError(result.error.message); setMessage(''); return }
      const bytes = result.value.bytes
      const state = readJpegOrientation(bytes)
      if (state.kind === 'mirrored') {
        setError(`这张 JPEG 的 EXIF 方向是镜像方向（${state.raw}），本版不实现镜像显示；请先用 sips 转正后再导入`)
        setMessage(''); return
      }
      const orientation: SketchOrientation = state.kind === 'supported' ? state.value : 1
      const blob = new Blob([bytes as BlobPart],
        { type: (loadFileName ?? '').toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' })
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'none' })
      if (cancelled) { bitmap.close(); return }
      const image: LoadedImage = { revisionId: loadId, sha256: loadSha ?? '',
        width: bitmap.width, height: bitmap.height, orientation, bitmap }
      setLoaded(image)
      setBoxes([]); setDraftRect(null); setSubmitted(null); readingsRef.current.clear()
      setMessage(`已载入 ${bitmap.width}×${bitmap.height} 像素 · EXIF 方向 ${orientationText(orientation)} · 原图像素坐标`)
      fit(image)
    })().catch((cause: unknown) => {
      if (!cancelled) { setError(cause instanceof Error ? cause.message : String(cause)); setMessage('') }
    })
    return () => { cancelled = true }
  }, [loadId, loadFileName, loadSha, readAttachment, fit])

  useEffect(() => () => { loaded?.bitmap.close() }, [loaded])

  // 图片载入后等容器真正挂载再算适应窗口的缩放/居中（stage 在 placeholder 分支时不渲染）。
  useEffect(() => {
    if (loaded === null) return
    const schedule = globalThis.requestAnimationFrame ?? ((callback: () => void) => setTimeout(callback, 0))
    const cancel = globalThis.cancelAnimationFrame ?? ((handle: number) => clearTimeout(handle))
    const handle = schedule(() => fit(loaded))
    return () => cancel(handle as number)
  }, [loaded, fit])

  // 把旋转后的图片画进 canvas（canvas 内部像素 = 显示方向像素）。
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || loaded === null) return
    const { width: displayWidth, height: displayHeight } = displayedPixelSize(
      loaded.orientation, loaded.width, loaded.height)
    canvas.width = displayWidth
    canvas.height = displayHeight
    const context = canvas.getContext('2d')
    if (context === null) return
    context.save()
    switch (loaded.orientation) {
      case 1: break
      case 3: context.translate(displayWidth, displayHeight); context.rotate(Math.PI); break
      case 6: context.translate(displayWidth, 0); context.rotate(Math.PI / 2); break
      case 8: context.translate(0, displayHeight); context.rotate(-Math.PI / 2); break
    }
    context.drawImage(loaded.bitmap, 0, 0)
    context.restore()
  }, [loaded])

  const pointOf = useCallback((event: React.PointerEvent): ViewPoint | null => {
    const stage = stageRef.current
    if (stage === null) return null
    const rect = stage.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }, [])

  const displayedSize = loaded === null ? null
    : displayedPixelSize(loaded.orientation, loaded.width, loaded.height)

  /** 已提交读数的框选位置（只读回显）：位置来自项目文件里的原图像素 rect。 */
  const savedBoxes = useMemo(() => {
    const found = new Map<number, { symbol: string; index: number; rect: ImagePixelRect }>()
    for (const draft of snapshot.project?.extractionDrafts ?? []) {
      for (const candidate of draft.candidates) {
        if (candidate.kind !== 'ring') continue
        for (const ref of candidate.provenance ?? []) {
          if (ref.kind !== 'agent-read' || ref.source.kind !== 'image') continue
          if (ref.source.imageId !== revisionId) continue
          const region = ref.source.region
          if (region === undefined || region.rect === null) continue
          const [x, y, width, height] = region.rect
          found.set(region.index, { symbol: candidate.data.symbol ?? '', index: region.index,
            rect: { x, y, width, height } })
        }
      }
    }
    return [...found.values()].sort((a, b) => a.index - b.index)
  }, [snapshot.project?.extractionDrafts, revisionId])

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (loaded === null || disabled) return
    const point = pointOf(event)
    if (point === null) return
    // 中键或按住 Alt = 平移；左键 = 框选。
    if (event.button === 1 || event.altKey) {
      const origin = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY }
      const move = (moveEvent: PointerEvent): void => {
        setView({ ...view, panX: origin.panX + moveEvent.clientX - origin.x, panY: origin.panY + moveEvent.clientY - origin.y })
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return
    }
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDrag({ start: point, end: point })
    setDraftRect(null)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (drag === null || loaded === null) return
    const point = pointOf(event)
    if (point === null) return
    setDrag({ ...drag, end: point })
  }

  function onPointerUp() {
    if (drag === null || loaded === null) return
    const rect = selectionToSourceRect({
      orientation: loaded.orientation,
      sourceWidth: loaded.width, sourceHeight: loaded.height,
      view, start: drag.start, end: drag.end,
    })
    setDrag(null)
    setDraftRect(rect)
    setMessage(rect === null
      ? '这一下没拖出区域；请按住左键拖出一个框。'
      : `已选出原图像素框 [${rect.x}, ${rect.y}, ${rect.width}, ${rect.height}]（${rect.width}×${rect.height} 像素）`)
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (loaded === null) return
    event.preventDefault()
    const stage = stageRef.current
    if (stage === null) return
    const rect = stage.getBoundingClientRect()
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const nextZoom = Math.min(8, Math.max(0.1, view.zoom * (event.deltaY < 0 ? 1.15 : 0.87)))
    const before = { x: (point.x - view.panX) / view.zoom, y: (point.y - view.panY) / view.zoom }
    setView({ zoom: nextZoom, panX: point.x - before.x * nextZoom, panY: point.y - before.y * nextZoom })
  }

  function parseReading(symbol: string, current: typeof form): ReadingPayload | null {
    if (symbol === '') return null
    const nominal = tryParseMm(current.nominal)
    const upper = tryParseMm(current.upper === '' ? '0' : current.upper)
    const lower = tryParseMm(current.lower === '' ? '0' : current.lower)
    if (!nominal.ok || !upper.ok || !lower.ok) return null
    return { kind: 'dimension', symbol, nominalQ: nominal.value,
      upperDeviationQ: upper.value, lowerDeviationQ: lower.value, unit: 'mm' }
  }

  function addBox(rect: ImagePixelRect | null) {
    const reading = parseReading(form.symbol.trim(), form)
    if (reading === null) { setError('读数要填完整：符号、基本尺寸、上下偏差（mm）'); return }
    if (boxes.some((box) => box.symbol === reading.symbol)) {
      setError(`符号 ${reading.symbol} 已在本次读数里`); return
    }
    if (reading.lowerDeviationQ > reading.upperDeviationQ) { setError('下偏差不能大于上偏差'); return }
    readingsRef.current.set(reading.symbol, reading)
    setBoxes([...boxes, { symbol: reading.symbol, rect }])
    setDraftRect(null)
    setError('')
    setMessage(rect === null
      ? `已加入 ${reading.symbol}：未框选，无位置`
      : `已加入 ${reading.symbol}：原图像素框 [${rect.x}, ${rect.y}, ${rect.width}, ${rect.height}]`)
    setForm({ symbol: '', nominal: '', upper: '', lower: '' })
    setSubmitted(null)
  }

  async function submit() {
    if (loaded === null) { setError('请先导入并选择一张图片'); return }
    if (boxes.length === 0) { setError('还没有读数；先在图上框选或点“不框选，直接填读数”'); return }
    const readings: ReadingPayload[] = []
    for (const box of boxes) {
      const reading = readingsRef.current.get(box.symbol)
      if (reading === undefined) { setError(`内部状态不一致：${box.symbol} 的读数丢了；请清空重填`); return }
      readings.push(reading)
    }
    setError('')
    const result = await onSubmit({
      source: { kind: 'image', imageId: loaded.revisionId, sha256: loaded.sha256 },
      readings,
      boxes: boxes.map((box) => ({
        symbol: box.symbol,
        rect: box.rect === null ? null
          : [box.rect.x, box.rect.y, box.rect.width, box.rect.height] as [number, number, number, number],
      })),
    })
    if (result === null) return
    if (!result.ok) { setError(result.error.message); return }
    const labels = result.value.candidates.map((candidate) => {
      const ref = (candidate.provenance ?? []).find((item) => item.kind === 'agent-read')
      const source = ref?.kind === 'agent-read' ? ref.source : null
      if (source === null || source.kind !== 'image') return '来源：图片'
      const region = source.region
      if (region === undefined) return '来源：图片'
      return region.rect === null ? '来源：图片，未框选，无位置' : `来源：图片，第 ${region.index} 个框选`
    })
    setSubmitted(labels)
    setBoxes([])
    readingsRef.current.clear()
    setMessage('已提交到未核对候选；逐条核对后才能进入草稿。')
  }

  const draftViewRect = draftRect !== null && loaded !== null
    ? sourceRectToViewRect({ orientation: loaded.orientation, sourceWidth: loaded.width,
      sourceHeight: loaded.height, view, rect: draftRect })
    : null

  return (
    <div className="sketch-panel">
      <header className="sketch-panel__header">
        <h2>草图读数</h2>
        <p className="sketch-panel__notice">{SKETCH_NO_MEASURE_NOTICE}</p>
        <p className="sketch-panel__hint">不做 OCR、不做图像识别；尺寸全部由你输入，框选只记录位置。</p>
        <div className="sketch-panel__actions">
          <button type="button" disabled={disabled} onClick={() => { void onImport() }}>导入草图图片</button>
          <span className="sketch-panel__hint">支持 PNG / JPEG，单张 ≤ 20 MiB；HEIC 会提示转换命令。</span>
        </div>
      </header>

      <div className="sketch-panel__body">
        <aside className="sketch-panel__list" aria-label="已导入图片">
          <h3>图片</h3>
          {images.length === 0 ? <p>还没有图片。点“导入草图图片”选 PNG / JPEG。</p> : (
            <ul>{images.map((item) => (
              <li key={item.id}>
                <button type="button" aria-pressed={item.id === revisionId} disabled={disabled}
                  onClick={() => setSelectedId(item.id)}>{item.fileName}</button>
                <small>{item.sha256.slice(0, 8)}…</small>
              </li>
            ))}</ul>
          )}
          {revision !== null && <p className="sketch-panel__hint">图片版本已存入项目文件；换版会新增一条不可变版本。</p>}
        </aside>

        <section className="sketch-panel__stage-wrap" aria-label="框选区域">
          {loaded === null ? <p className="sketch-panel__placeholder">导入或选择一张图片后在这里框选。</p> : (
            <>
              <div className="sketch-panel__tools">
                <button type="button" onClick={() => setView({ ...view, zoom: Math.min(8, view.zoom * 1.25) })}>放大</button>
                <button type="button" onClick={() => setView({ ...view, zoom: Math.max(0.1, view.zoom / 1.25) })}>缩小</button>
                <button type="button" onClick={() => fit(loaded)}>适应窗口</button>
                <span className="sketch-panel__hint">滚轮缩放；中键或 Alt+拖动平移；左键拖动框选。</span>
              </div>
              <p className="sketch-panel__stage-status" role="status" aria-label="框选结果">
                {message === '' ? '在图上拖框选择位置；尺寸仍由你输入。' : message}
              </p>
              <div className="sketch-panel__stage" ref={stageRef} role="img"
                aria-label="草图框选画布"
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
                onWheel={onWheel}>
                <canvas ref={canvasRef} className="sketch-panel__canvas"
                  style={displayedSize === null ? undefined : {
                    left: view.panX, top: view.panY,
                    width: displayedSize.width * view.zoom, height: displayedSize.height * view.zoom,
                  }} />
                {savedBoxes.map((box) => {
                  const style = sourceRectToViewRect({ orientation: loaded.orientation,
                    sourceWidth: loaded.width, sourceHeight: loaded.height, view, rect: box.rect })
                  return <div key={`saved-${box.index}`} className="sketch-panel__box sketch-panel__box--saved" style={style}>
                    <span>第 {box.index} 个框选 · {box.symbol}</span></div>
                })}
                {boxes.filter((box) => box.rect !== null).map((box, index) => {
                  const style = sourceRectToViewRect({ orientation: loaded.orientation,
                    sourceWidth: loaded.width, sourceHeight: loaded.height, view, rect: box.rect! })
                  return <div key={`${box.symbol}-${index}`} className="sketch-panel__box" style={style}>
                    <span>{box.symbol}</span></div>
                })}
                {drag !== null && <div className="sketch-panel__drag" style={{
                  left: Math.min(drag.start.x, drag.end.x), top: Math.min(drag.start.y, drag.end.y),
                  width: Math.abs(drag.end.x - drag.start.x), height: Math.abs(drag.end.y - drag.start.y),
                }} />}
                {draftViewRect !== null && <div className="sketch-panel__box sketch-panel__box--draft" style={draftViewRect} />}
              </div>
            </>
          )}
        </section>

        <aside className="sketch-panel__form" aria-label="填读数">
          <h3>填读数（mm）</h3>
          <label>符号<input aria-label="符号" value={form.symbol} disabled={disabled}
            onChange={(event) => setForm({ ...form, symbol: event.target.value })} placeholder="φ25" /></label>
          <label>基本尺寸<input aria-label="基本尺寸" inputMode="decimal" value={form.nominal} disabled={disabled}
            onChange={(event) => setForm({ ...form, nominal: event.target.value })} placeholder="25" /></label>
          <label>上偏差<input aria-label="上偏差" inputMode="decimal" value={form.upper} disabled={disabled}
            onChange={(event) => setForm({ ...form, upper: event.target.value })} placeholder="0.021" /></label>
          <label>下偏差<input aria-label="下偏差" inputMode="decimal" value={form.lower} disabled={disabled}
            onChange={(event) => setForm({ ...form, lower: event.target.value })} placeholder="0" /></label>
          <label>单位<input aria-label="单位" value="mm" readOnly /></label>
          <div className="sketch-panel__form-actions">
            <button type="button" disabled={disabled || loaded === null} onClick={() => addBox(draftRect)}>保存这条框选</button>
            <button type="button" disabled={disabled || loaded === null} onClick={() => addBox(null)}>不框选，直接填读数</button>
          </div>
          <p className="sketch-panel__hint">不框选也允许，但候选上会固定标“未框选，无位置”。</p>

          <h3>本次读数（{boxes.length}）</h3>
          {boxes.length === 0 ? <p>还没有读数。</p> : (
            <ol>{boxes.map((box) => (
              <li key={box.symbol} data-testid={`sketch-box-${box.symbol}`}>
                {box.symbol} · {box.rect === null ? '未框选，无位置'
                  : `原图像素 [${box.rect.x}, ${box.rect.y}, ${box.rect.width}, ${box.rect.height}]`}
                <button type="button" aria-label={`删除 ${box.symbol}`} disabled={disabled}
                  onClick={() => {
                    setBoxes(boxes.filter((item) => item.symbol !== box.symbol))
                    readingsRef.current.delete(box.symbol)
                  }}>删除</button>
              </li>
            ))}</ol>
          )}
          <button type="button" className="sketch-panel__submit" disabled={disabled || boxes.length === 0}
            onClick={() => { void submit() }}>提交读数（未核对）</button>
          {error !== '' && <p role="alert" className="sketch-panel__error">{error}</p>}
          {submitted !== null && (
            <section aria-label="未核对候选">
              <h4>已提交为未核对候选</h4>
              <ul>{submitted.map((label, index) => <li key={index}>读数未核对（{label}）</li>)}</ul>
              <p className="sketch-panel__hint">只能逐条核对；图片读数不提供批量确认。</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
