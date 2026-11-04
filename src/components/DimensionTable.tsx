import { useId, type Dispatch, type MouseEvent } from 'react'
import { termLimits } from '../domain/calculate'
import type { ChainDefinition } from '../domain/types'
import { formatMm } from '../domain/units'
import type {
  CellErrors,
  TermDraft,
  WorkspaceAction,
  WorkspaceDraft,
} from '../workspace/draft'

/**
 * 组成环表。纯受控展示组件：草稿、派发器、计算结果和逐格错误都由工作台页面传入，
 * 组件自身不调用 useWorkspace，也不另写任何计算或校验公式。
 */
export interface DimensionTableProps {
  draft: WorkspaceDraft
  dispatch: Dispatch<WorkspaceAction>
  /** 当前草稿有效时由 useWorkspace 提供的领域链；无效时为 null。 */
  chain?: ChainDefinition | null
  cellErrors?: CellErrors
  /** 当前草稿无效时，所有极限尺寸只显示占位符，不展示上一次有效结果。 */
  stale?: boolean
  /** 当前选中的组成环，用于与示意图联动；不传时不改变表格原有行为。 */
  selectedTermId?: string | null
  /** 点击行或行首选择按钮时回传组成环 id；不传时不显示选择控件。 */
  onSelect?: (termId: string) => void
}

type EditableField =
  | 'symbol'
  | 'name'
  | 'nominal'
  | 'lower'
  | 'upper'
  | 'sourceNote'

const COLUMNS = [
  '序号',
  '代号',
  '名称',
  '基本尺寸',
  '下偏差',
  '上偏差',
  '方向',
  '下极限尺寸',
  '上极限尺寸',
  '来源备注',
  '操作',
] as const

const EMPTY_CELL_ERRORS: CellErrors = {}

interface TextCellProps {
  label: string
  value: string
  error?: string
  errorId: string
  inputMode?: 'decimal'
  onChange: (value: string) => void
}

function TextCell({
  label,
  value,
  error,
  errorId,
  inputMode,
  onChange,
}: TextCellProps) {
  const hasError = error !== undefined && error !== ''
  return (
    <div className="dimension-table__field">
      <input
        type="text"
        className="dimension-table__input"
        aria-label={label}
        value={value}
        inputMode={inputMode}
        spellCheck={false}
        aria-invalid={hasError ? true : undefined}
        aria-describedby={hasError ? errorId : undefined}
        aria-errormessage={hasError ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hasError ? (
        <span id={errorId} className="dimension-table__error">
          {error}
        </span>
      ) : null}
    </div>
  )
}

function rowLabel(term: TermDraft, index: number): string {
  return (
    term.symbol.trim() || term.name.trim() || `第 ${index + 1} 行`
  )
}

function createEmptyTerm(terms: TermDraft[]): TermDraft {
  const usedIds = new Set(terms.map((term) => term.id))
  let suffix = 1
  while (usedIds.has(`term-${suffix}`)) {
    suffix += 1
  }
  return {
    id: `term-${suffix}`,
    symbol: '',
    name: '',
    nominal: '',
    lower: '0.0000',
    upper: '0.0000',
    sign: 1,
    sourceNote: '',
  }
}

export function DimensionTable({
  draft,
  dispatch,
  chain = null,
  cellErrors = EMPTY_CELL_ERRORS,
  stale = false,
  selectedTermId = null,
  onSelect,
}: DimensionTableProps) {
  // useId 生成不含空白的唯一前缀，避免多个表格的错误文案 id 冲突。
  const tableId = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const tableElementId = `${tableId}-table`
  const hintId = `${tableId}-hint`
  const errorId = (index: number, field: string): string =>
    `${tableId}-${index}-${field}-error`

  const updateText = (
    termId: string,
    field: EditableField,
    value: string,
  ): void => {
    dispatch({ type: 'updateField', termId, field, value })
  }

  return (
    <section className="dimension-table" aria-label="组成环编辑区">
      <div className="dimension-table__toolbar">
        <button
          type="button"
          className="dimension-table__add"
          aria-controls={tableElementId}
          onClick={() =>
            dispatch({ type: 'addTerm', term: createEmptyTerm(draft.terms) })
          }
        >
          增加行
        </button>
        <span className="dimension-table__count">
          共 {draft.terms.length} 个组成环
        </span>
      </div>

      <p id={hintId} className="dimension-table__hint">
        数值单位为 mm。下、上极限尺寸按基本尺寸加相应偏差计算，仅用于显示；草稿无效时显示“—”。
        使用每行的上移、下移按钮调整顺序，重排不会改变计算结果。
      </p>

      <div
        className="dimension-table__scroll"
        role="region"
        aria-label="组成环表横向滚动区域"
        tabIndex={0}
      >
        <table
          id={tableElementId}
          aria-label="组成环表"
          aria-describedby={hintId}
          className="dimension-table__table"
        >
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.terms.map((term, index) => {
            const label = rowLabel(term, index)
            const chainTerm = chain?.terms.find(
              (candidate) => candidate.id === term.id,
            )
            const limitsAvailable = !stale && chainTerm !== undefined
            const limits = limitsAvailable ? termLimits(chainTerm) : null
            const lowerLimit = limits === null ? '—' : formatMm(limits.lowerQ)
            const upperLimit = limits === null ? '—' : formatMm(limits.upperQ)
            const signError = cellErrors[`${term.id}.sign`]
            const selected = selectedTermId === term.id
            const handleRowClick =
              onSelect === undefined
                ? undefined
                : (event: MouseEvent<HTMLTableRowElement>) => {
                    const target = event.target
                    if (
                      target instanceof HTMLElement &&
                      target.closest('button, a') !== null
                    ) {
                      return
                    }
                    onSelect(term.id)
                  }

            return (
              <tr
                key={term.id}
                className={
                  selected
                    ? 'dimension-table__row dimension-table__row--selected'
                    : 'dimension-table__row'
                }
                data-selected={selected ? 'true' : undefined}
                onClick={handleRowClick}
              >
                <th scope="row">
                  {onSelect === undefined ? (
                    index + 1
                  ) : (
                    <button
                      type="button"
                      className="dimension-table__row-select"
                      aria-label={`选择 ${label}`}
                      aria-pressed={selected}
                      onClick={() => onSelect(term.id)}
                    >
                      {index + 1}
                    </button>
                  )}
                </th>
                <td>
                  <TextCell
                    label={`${label} 代号`}
                    value={term.symbol}
                    error={cellErrors[`${term.id}.symbol`]}
                    errorId={errorId(index, 'symbol')}
                    onChange={(value) =>
                      updateText(term.id, 'symbol', value)
                    }
                  />
                </td>
                <td>
                  <TextCell
                    label={`${label} 名称`}
                    value={term.name}
                    error={cellErrors[`${term.id}.name`]}
                    errorId={errorId(index, 'name')}
                    onChange={(value) => updateText(term.id, 'name', value)}
                  />
                </td>
                <td>
                  <TextCell
                    label={`${label} 基本尺寸`}
                    value={term.nominal}
                    error={cellErrors[`${term.id}.nominal`]}
                    errorId={errorId(index, 'nominal')}
                    inputMode="decimal"
                    onChange={(value) =>
                      updateText(term.id, 'nominal', value)
                    }
                  />
                </td>
                <td>
                  <TextCell
                    label={`${label} 下偏差`}
                    value={term.lower}
                    error={cellErrors[`${term.id}.lower`]}
                    errorId={errorId(index, 'lower')}
                    inputMode="decimal"
                    onChange={(value) => updateText(term.id, 'lower', value)}
                  />
                </td>
                <td>
                  <TextCell
                    label={`${label} 上偏差`}
                    value={term.upper}
                    error={cellErrors[`${term.id}.upper`]}
                    errorId={errorId(index, 'upper')}
                    inputMode="decimal"
                    onChange={(value) => updateText(term.id, 'upper', value)}
                  />
                </td>
                <td>
                  <select
                    className="dimension-table__select"
                    aria-label={`${label} 方向`}
                    value={term.sign}
                    aria-invalid={signError === undefined ? undefined : true}
                    aria-describedby={
                      signError === undefined
                        ? undefined
                        : errorId(index, 'sign')
                    }
                    aria-errormessage={
                      signError === undefined
                        ? undefined
                        : errorId(index, 'sign')
                    }
                    onChange={(event) =>
                      dispatch({
                        type: 'updateField',
                        termId: term.id,
                        field: 'sign',
                        value: event.target.value === '-1' ? -1 : 1,
                      })
                    }
                  >
                    <option value="1">增加封闭环 (+)</option>
                    <option value="-1">减小封闭环 (−)</option>
                  </select>
                  {signError !== undefined ? (
                    <span
                      id={errorId(index, 'sign')}
                      className="dimension-table__error"
                    >
                      {signError}
                    </span>
                  ) : null}
                </td>
                <td
                  aria-label={`${label} 下极限尺寸`}
                  className="dimension-table__limit"
                >
                  {lowerLimit}
                </td>
                <td
                  aria-label={`${label} 上极限尺寸`}
                  className="dimension-table__limit"
                >
                  {upperLimit}
                </td>
                <td>
                  <TextCell
                    label={`${label} 来源备注`}
                    value={term.sourceNote}
                    error={cellErrors[`${term.id}.sourceNote`]}
                    errorId={errorId(index, 'sourceNote')}
                    onChange={(value) =>
                      updateText(term.id, 'sourceNote', value)
                    }
                  />
                </td>
                <td>
                  <div className="dimension-table__actions">
                    <button
                      type="button"
                      aria-label={`上移 ${label}`}
                      disabled={index === 0}
                      onClick={() =>
                        dispatch({
                          type: 'moveTerm',
                          termId: term.id,
                          direction: 'up',
                        })
                      }
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      aria-label={`下移 ${label}`}
                      disabled={index === draft.terms.length - 1}
                      onClick={() =>
                        dispatch({
                          type: 'moveTerm',
                          termId: term.id,
                          direction: 'down',
                        })
                      }
                    >
                      下移
                    </button>
                    <button
                      type="button"
                      aria-label={`删除 ${label}`}
                      onClick={() =>
                        dispatch({ type: 'removeTerm', termId: term.id })
                      }
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
        </table>
      </div>

      {draft.terms.length === 0 ? (
        <p className="dimension-table__empty" role="status">
          暂无组成环，点击“增加行”开始。
        </p>
      ) : null}
    </section>
  )
}
