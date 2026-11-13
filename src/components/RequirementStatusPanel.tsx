/**
 * V3.5：条款检查面板（复核区 / 参数联动共用）。
 *
 * 并排展示“原项目目标”和“任务书要求”，互不覆盖；四态用中文状态 + 原因码；
 * 只读展示 main 返回的权威检查，不在界面重算或改写通过布尔。
 */
import type { RequirementPreviewValue } from '../../desktop/shared/contracts'
import type { ChainResult } from '../domain/types'
import { formatMm } from '../domain/units'
import { REQUIREMENT_STATUS_LABEL, isPdfRequirementSource } from '../requirements/types'
import './RequirementStatusPanel.css'
import { uiDiagnosticText } from './uiIdentity'

const STATUS_CLASS: Record<string, string> = {
  satisfied: 'requirement-panel__status--ok',
  unsatisfied: 'requirement-panel__status--bad',
  'pending-confirmation': 'requirement-panel__status--pending',
  unchecked: 'requirement-panel__status--unchecked',
}

export function RequirementStatusPanel(props: {
  requirement: RequirementPreviewValue
  /** 原项目 target（只用于展示，不参与条款判定）。 */
  target: { minQ: number; maxQ: number } | null
  /** 当前正式目标结果（无预览时可为 null）。 */
  targetResult?: ChainResult | null
  onLocate: () => void
  locateDisabled?: boolean
}) {
  const { check, revision, originalTargetResult, requirementResult } = props.requirement
  const needsNewVersion = check.reasonCodes.includes('SOURCE_VERSION_CHANGED')
  const unreadable = check.reasonCodes.some(
    (code) => code === 'SOURCE_UNREADABLE' || code === 'SOURCE_HASH_MISMATCH',
  )
  return (
    <section className="requirement-panel" aria-label="任务书条款检查">
      <header className="requirement-panel__header">
        <h4>任务书要求检查</h4>
        <span className={`requirement-panel__status ${STATUS_CLASS[check.status] ?? ''}`}>
          {REQUIREMENT_STATUS_LABEL[check.status]}
        </span>
      </header>
      <p className="requirement-panel__rule">
        本条检查只按任务书要求判定；原项目目标仍独立保存与计算，两者互不覆盖。
      </p>
      <div className="requirement-panel__grid">
        <div>
          <h5>原项目目标</h5>
          <p>
            {props.target === null
              ? '未设置'
              : `${formatMm(props.target.minQ)} ～ ${formatMm(props.target.maxQ)} mm`}
          </p>
          <p>
            当前结果：{originalTargetResult
              ? `${formatMm(originalTargetResult.minQ)} ～ ${formatMm(originalTargetResult.maxQ)} mm（${originalTargetResult.status}）`
              : '不可用'}
          </p>
          <p className="requirement-panel__note">原目标不随条款区间自动同步。</p>
        </div>
        <div>
          <h5>任务书要求</h5>
          <p>
            {revision === null
              ? '无活动条款'
              : `${formatMm(revision.lowerQ)} ～ ${formatMm(revision.upperQ)} mm（闭区间）`}
          </p>
          <p>
            候选区间：{requirementResult
              ? `${formatMm(requirementResult.minQ)} ～ ${formatMm(requirementResult.maxQ)} mm`
              : '当前检查未完成'}
          </p>
          <p>
            两侧裕量：{check.margins
              ? `下 ${formatMm(check.margins.lowerQ)} mm · 上 ${formatMm(check.margins.upperQ)} mm`
              : '未检查'}
          </p>
        </div>
      </div>
      <div className="requirement-panel__evidence">
        {revision !== null && (
          isPdfRequirementSource(revision.source) ? (
            <p>
              条款：未命名版本（父版本：{revision.parentRevisionId === null ? '无' : '未命名版本'}）· 来源 PDF{' '}
              第 {revision.source.page} 页 · SHA-256{' '}
              {revision.source.sha256.slice(0, 12)}…
            </p>
          ) : (
            <p>
              条款：未命名版本（父版本：{revision.parentRevisionId === null ? '无' : '未命名版本'}）· 来源：用户输入（第{' '}
              {revision.source.attestation.sessionSeq} 次）· 原话「{revision.source.attestation.statement}」
            </p>
          )
        )}
        <p>原因码：{check.reasonCodes.join('、') || '无'}</p>
        {check.reasonCodes.length > 0 && (
          <ul>
            {props.requirement.evaluation.reasons.map((reason, index) => (
              <li key={`${check.reasonCodes[index] ?? index}`}>{uiDiagnosticText(reason)}</li>
            ))}
          </ul>
        )}
      </div>
      {needsNewVersion && (
        <p className="requirement-panel__warning" role="status">
          任务书 PDF 已换版：旧条款仍指向旧版本，当前需核对新版；旧“满足”不再当前有效。
        </p>
      )}
      {unreadable && (
        <p className="requirement-panel__warning" role="alert">
          条款引用的资料不可读或哈希不符：不能确认判定依据。
        </p>
      )}
      <div className="requirement-panel__actions">
        <button
          type="button"
          onClick={props.onLocate}
          disabled={props.locateDisabled || revision === null || (revision !== null && !isPdfRequirementSource(revision.source))}
        >
          {revision !== null && !isPdfRequirementSource(revision.source)
            ? '用户输入条款，没有 PDF 页可定位'
            : `定位任务书（同版本 / 第 ${revision !== null && isPdfRequirementSource(revision.source) ? revision.source.page : '—'} 页）`}
        </button>
      </div>
    </section>
  )
}
