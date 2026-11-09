/**
 * 隔套图纸工作区（V3-C-03）：参数 → 唯一 DrawingData → 预览 / 导出。
 *
 * 参数编辑不直接改图：点击“应用参数与比例”后由 main 原子更新参数与图纸引用，
 * 再用返回的权威快照重建预览。标注只绑定 parameterId，点击后定位到原参数输入。
 */
import { useMemo, useState } from 'react'
import type {
  ProjectFileDrawingRecord,
  ProjectFileProject,
  ProjectFileSpacerParameter,
} from '../project-file/types'
import type { DrawingData, SpacerParameterKey } from '../drawing/types'
import {
  DRAWING_SCALES,
  SPACER_PARAMETER_IDS,
  SPACER_PARAMETER_KEYS,
  SPACER_PARAMETER_LABELS,
  parseScaleKey,
  scaleKey as scaleText,
} from '../drawing/types'
import { rebuildDrawingFromProject } from '../drawing/rebuildDrawing'
import { formatParameterValue } from '../drawing/formatDimension'
import { DEFAULT_SPACER_TEXTS } from '../parts/spacerParameters'
import { DrawingCanvas } from './DrawingCanvas'
import './SpacerDrawingPanel.css'

export interface DrawingSnapshotValue {
  acceptedSeq: number
  snapshot: import('../../desktop/shared/contracts').SnapshotDto
  recovery: import('../../desktop/shared/contracts').RecoveryWriteState | 'none'
  warning?: string
}

export interface SpacerDrawingPanelProps {
  sessionId: string | null
  acceptedSeq: number
  project: ProjectFileProject
  selectedParameterId: string | null
  selectedAnnotationId: string | null
  onSelectParameter: (parameterId: string | null) => void
  onSelectAnnotation?: (annotationId: string) => void
  applySnapshot: (value: DrawingSnapshotValue) => Promise<void>
}

type FrameState = ProjectFileDrawingRecord['frameFields']

const EMPTY_FRAME: FrameState = {
  partName: '隔套',
  drawingNumber: '',
  version: '',
  material: '',
  tolerance: '',
  surface: '',
  drafter: '',
  date: '',
}

function textsFrom(parameters: ProjectFileSpacerParameter[]): Record<SpacerParameterKey, string> {
  const texts = { ...DEFAULT_SPACER_TEXTS }
  for (const parameter of parameters) {
    texts[parameter.key] = formatParameterValue(parameter.valueQ, parameter.inputDecimals) ??
      texts[parameter.key]
  }
  return texts
}

export function SpacerDrawingPanel(props: SpacerDrawingPanelProps) {
  const record = props.project.drawings[0]
  const rebuilt = useMemo(() => rebuildDrawingFromProject(props.project), [props.project])
  const data: DrawingData | null = rebuilt.ok ? rebuilt.data : null
  const [showFrame, setShowFrame] = useState(false)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  /**
   * 表单只在 main 接纳成功后回填：草稿以权威指纹为键，指纹变化即丢弃旧草稿。
   * 不用 effect + setState（避免级联渲染，也避免覆盖用户正在输入的文字）。
   */
  const syncedKey = record?.dataFingerprint ?? 'none'
  const [draft, setDraft] = useState<{
    key: string
    texts: Record<SpacerParameterKey, string>
    scaleKey: string
    frame: FrameState
  } | null>(null)
  const form =
    draft !== null && draft.key === syncedKey
      ? draft
      : {
          key: syncedKey,
          texts:
            props.project.parameters.length > 0
              ? textsFrom(props.project.parameters)
              : { ...DEFAULT_SPACER_TEXTS },
          scaleKey:
            record === undefined
              ? '1:1'
              : `${record.scale.numerator}:${record.scale.denominator}`,
          frame: record?.frameFields ?? { ...EMPTY_FRAME },
        }
  const { texts, scaleKey, frame } = form

  const selectedAnnotationId =
    props.selectedAnnotationId ??
    (props.selectedParameterId === null
      ? null
      : data?.annotations.find((item) => item.parameterId === props.selectedParameterId)?.annotationId ??
        null)

  function setInput(key: SpacerParameterKey, value: string) {
    setDraft({ ...form, texts: { ...form.texts, [key]: value } })
  }
  function setScaleKey(value: string) {
    setDraft({ ...form, scaleKey: value })
  }
  function setFrame(next: FrameState) {
    setDraft({ ...form, frame: next })
  }

  async function apply() {
    if (props.sessionId === null) {
      setError('window.cunlian 不可用，请在桌面应用中生成图纸')
      return
    }
    setBusy(true)
    setError(null)
    setNotice('')
    try {
      const scale = parseScaleKey(scaleKey) ?? { numerator: 1, denominator: 1 }
      const result = await window.cunlian.updateSpacerDrawing({
        sessionId: props.sessionId,
        baseEditSeq: props.acceptedSeq,
        partId: 'builtin:shaft-demo:spacer',
        inputs: texts,
        scale,
        frameFields: frame,
      })
      if (!result.ok) {
        setError(`${result.error.code}：${result.error.message}${result.error.detail ? `（${result.error.detail}）` : ''}`)
        return
      }
      await props.applySnapshot({
        acceptedSeq: result.value.acceptedSeq,
        snapshot: result.value.snapshot,
        recovery: result.value.recovery,
        warning: result.value.warning,
      })
      setNotice(`图纸已更新 · 指纹 ${result.value.drawingFingerprint.slice(0, 12)}…`)
    } catch (caught) {
      setError(`生成失败：${caught instanceof Error ? caught.message : String(caught)}；旧图仍保留`)
    } finally {
      setBusy(false)
    }
  }

  async function exportAs(kind: 'pdf' | 'svg') {
    if (props.sessionId === null || record === undefined || data === null) {
      setError('尚无有效图纸，无法导出')
      return
    }
    setBusy(true)
    setError(null)
    setNotice('')
    try {
      const request = {
        sessionId: props.sessionId,
        baseEditSeq: props.acceptedSeq,
        drawingId: record.drawingId,
        drawingFingerprint: record.dataFingerprint,
      }
      const result =
        kind === 'pdf'
          ? await window.cunlian.exportDrawingPdf(request)
          : await window.cunlian.exportDrawingSvg(request)
      if (!result.ok) {
        setError(`${result.error.code}：${result.error.message}${result.error.detail ? `（${result.error.detail}）` : ''}`)
        return
      }
      setNotice(
        `已导出 ${result.value.fileName} · ${result.value.byteSize} 字节 · SHA-256 ${result.value.sha256.slice(0, 12)}…`,
      )
    } catch (caught) {
      setError(`导出失败：${caught instanceof Error ? caught.message : String(caught)}`)
    } finally {
      setBusy(false)
    }
  }

  const missing = data?.frame.missingFields ?? []
  const rows = data?.parameterSnapshot ?? []
  return (
    <section className="spacer-drawing" aria-label="隔套工程图">
      <header className="spacer-drawing__header">
        <div>
          <h2>隔套 · A4 横向</h2>
          <p className="spacer-drawing__status">待复核草稿 · 未复核、未批准 · 第三角投影</p>
        </div>
        <div className="spacer-drawing__zoom" role="group" aria-label="画布缩放">
          {([0.5, 1, 1.5] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={zoom === value}
              onClick={() => setZoom(value)}
            >
              {Math.round(value * 100)}%
            </button>
          ))}
          <button type="button" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>
            适合窗口
          </button>
        </div>
      </header>

      <form
        className="spacer-drawing__parameters"
        onSubmit={(event) => {
          event.preventDefault()
          void apply()
        }}
      >
        {SPACER_PARAMETER_KEYS.map((key) => {
          const parameterId = SPACER_PARAMETER_IDS[key]
          const row = rows.find((item) => item.parameterId === parameterId)
          const active = props.selectedParameterId === parameterId
          return (
            <label key={key} className={active ? 'is-located' : undefined}>
              <span>{SPACER_PARAMETER_LABELS[key]}</span>
              <input
                inputMode="decimal"
                value={texts[key]}
                maxLength={32}
                aria-label={`${SPACER_PARAMETER_LABELS[key]}输入`}
                onFocus={() => props.onSelectParameter(parameterId)}
                onChange={(event) => setInput(key, event.target.value)}
              />
              <small>
                {row ? `${row.valueQ} q · ${row.inputDecimals} 位` : '尚未生成'}
              </small>
            </label>
          )
        })}
        <label>
          <span>纸面比例</span>
          <select value={scaleKey} onChange={(event) => setScaleKey(event.target.value)} aria-label="纸面比例">
            {DRAWING_SCALES.map((item) => (
              <option key={scaleText(item)} value={scaleText(item)}>
                {scaleText(item)}
              </option>
            ))}
          </select>
          <small>只改视图尺寸</small>
        </label>
        <button type="submit" className="spacer-drawing__primary" disabled={busy || props.sessionId === null}>
          {data === null ? '生成图纸' : '应用参数与比例'}
        </button>
      </form>

      <details
        className="spacer-drawing__frame"
        open={showFrame}
        onToggle={(event) => setShowFrame((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>图框字段（留空按“待补充”，不推测）</summary>
        <div className="spacer-drawing__frame-grid">
          {(
            [
              ['partName', '零件名（必填）'],
              ['drawingNumber', '图号'],
              ['material', '材料'],
              ['tolerance', '公差/配合'],
              ['surface', '表面要求'],
              ['drafter', '制图人'],
              ['date', '日期'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                value={frame[key]}
                maxLength={200}
                onChange={(event) => setFrame({ ...frame, [key]: event.target.value })}
              />
            </label>
          ))}
          <label>
            <span>版本</span>
            <input
              value={frame.version}
              maxLength={200}
              placeholder="留空自动写“草稿 + 基准版本”"
              onChange={(event) => setFrame({ ...frame, version: event.target.value })}
            />
          </label>
        </div>
      </details>

      {(error ?? (rebuilt.ok ? null : rebuilt.message)) && (
        <p className="spacer-drawing__error" role="alert">
          {error ?? (rebuilt.ok ? '' : `${rebuilt.message}${rebuilt.detail ? `（${rebuilt.detail}）` : ''}`)}
        </p>
      )}

      <div className="spacer-drawing__canvas">
        <DrawingCanvas
          data={data}
          selectedAnnotationId={selectedAnnotationId}
          zoom={zoom}
          onSelectAnnotation={(annotationId, parameterId) => {
            props.onSelectParameter(parameterId)
            props.onSelectAnnotation?.(annotationId)
          }}
          emptyReason={
            props.project.parameters.length === 0
              ? '输入三参数后点击“生成图纸”。图纸是待复核草稿，不声明符合 GB/ISO。'
              : '图纸数据不一致，拒绝用猜测值显示。'
          }
        />
      </div>

      <footer className="spacer-drawing__footer">
        <div>
          {data !== null && (
            <>
              <span className="spacer-drawing__chip">指纹 {data.fingerprint.slice(0, 12)}…</span>
              <span className="spacer-drawing__chip">比例 {scaleText(data.scale)}</span>
              <span className="spacer-drawing__chip">
                缺项：{missing.length === 0 ? '无' : missing.join('、')}
              </span>
            </>
          )}
        </div>
        <div className="spacer-drawing__actions">
          <button
            type="button"
            disabled={busy || data === null || !data.layout.fits}
            onClick={() => void exportAs('pdf')}
          >
            导出 PDF（矢量）
          </button>
          <button
            type="button"
            disabled={busy || data === null || !data.layout.fits}
            onClick={() => void exportAs('svg')}
          >
            导出 SVG
          </button>
        </div>
      </footer>
      {notice !== '' && <p className="spacer-drawing__notice" role="status">{notice}</p>}
      <p className="spacer-drawing__disclaimer">
        导出的 SVG 是规范矢量文件，与预览一致；不承诺任何 CAD 软件可直接打开。PDF/SVG 不自动回灌为项目附件。
      </p>
    </section>
  )
}
