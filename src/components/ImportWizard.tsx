import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { Project } from '../domain/types'
import { formatMm } from '../domain/units'
import type { WorkspaceDraft } from '../workspace/draft'
import {
  commitImport,
  planImportCommit,
  type CommitImportSuccess,
  type ImportCommitMode,
} from '../import/commit'
import {
  FIELD_LABELS,
  candidateDirectionValue,
  directionTokens,
  emptyMapping,
  findLimitColumns,
  mappingColumnSummary,
  suggestMapping,
  validateMapping,
  type ColumnMapping,
  type DirectionValue,
  type ImportField,
} from '../import/mapColumns'
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  columnLabels,
  parseTableText,
  type RawTable,
} from '../import/parseTable'
import {
  applyMappingTemplate,
  listMappingTemplates,
  saveMappingTemplate,
  type MappingTemplate,
} from '../import/templates'
import {
  importCellKey,
  validateImport,
  type ImportCellErrors,
  type ImportEdits,
} from '../import/validateImport'
import './ImportWizard.css'

export interface ImportWizardProps {
  /** 已有项目时提供追加 / 替换；不提供时只能新建项目。 */
  project?: Project
  /** 工作台当前草稿；与 project 一起提供时用于追加 / 替换。 */
  baseDraft?: WorkspaceDraft
  onClose: () => void
  onImported: (result: CommitImportSuccess) => void
}

type WizardStep = 'input' | 'header' | 'mapping' | 'units' | 'preview'
type DirectionChoice = '' | DirectionValue

const STEP_LABELS: Array<{ step: WizardStep; label: string }> = [
  { step: 'input', label: '选择输入' },
  { step: 'header', label: '表头' },
  { step: 'mapping', label: '映射列' },
  { step: 'units', label: '单位与方向' },
  { step: 'preview', label: '预览校验' },
]

const COLUMN_FIELDS: Array<{
  field: ImportField
  label: string
  optional?: boolean
}> = [
  { field: 'symbol', label: '代号' },
  { field: 'nominal', label: '基本尺寸' },
  { field: 'lower', label: '下偏差' },
  { field: 'upper', label: '上偏差' },
  { field: 'sign', label: '方向' },
  { field: 'sourceNote', label: '来源备注', optional: true },
]

/** 预览行需要展示单元格错误的字段；名称列也必须显示，不能只显示其余映射列。 */
const ROW_ERROR_FIELDS: ImportField[] = [
  'symbol',
  'name',
  'nominal',
  'lower',
  'upper',
  'sign',
]

function columnFieldValue(
  mapping: ColumnMapping,
  field: ImportField,
): number | null {
  switch (field) {
    case 'symbol':
      return mapping.symbolColumn
    case 'nominal':
      return mapping.nominalColumn
    case 'lower':
      return mapping.lowerColumn
    case 'upper':
      return mapping.upperColumn
    case 'sign':
      return mapping.signColumn
    case 'sourceNote':
      return mapping.sourceNoteColumn
    case 'name':
      return mapping.nameColumn
  }
}

function withColumn(
  mapping: ColumnMapping,
  field: ImportField,
  value: number | null,
): ColumnMapping {
  switch (field) {
    case 'symbol':
      return { ...mapping, symbolColumn: value }
    case 'nominal':
      return { ...mapping, nominalColumn: value }
    case 'lower':
      return { ...mapping, lowerColumn: value }
    case 'upper':
      return { ...mapping, upperColumn: value }
    case 'sign':
      return { ...mapping, signColumn: value, directionValues: {} }
    case 'sourceNote':
      return { ...mapping, sourceNoteColumn: value }
    case 'name':
      return { ...mapping, nameColumn: value }
  }
}

/** 严格按 UTF-8 解码；非法字节返回错误，而不是用替换字符伪装成功。 */
async function readUtf8File(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error('文件不是有效的 UTF-8 文本')
  }
}

function fieldLabel(field: ImportField): string {
  return FIELD_LABELS[field]
}

function errorText(errors: ImportCellErrors, rowNumber: number, field: ImportField): string | undefined {
  return errors[importCellKey(rowNumber, field)]
}

export function ImportWizard({
  project,
  baseDraft,
  onClose,
  onImported,
}: ImportWizardProps) {
  const titleId = `${useId()}-import-title`
  const editableProject = project !== undefined && baseDraft !== undefined

  const [step, setStep] = useState<WizardStep>('input')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [table, setTable] = useState<RawTable | null>(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState<ColumnMapping>(() => emptyMapping(true))
  const [showMappingIssues, setShowMappingIssues] = useState(false)
  const [edits, setEdits] = useState<ImportEdits>({})
  const [directionChoices, setDirectionChoices] = useState<
    Record<string, DirectionChoice>
  >({})
  const [parseError, setParseError] = useState<string | null>(null)
  const [unitError, setUnitError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [commitCellErrors, setCommitCellErrors] = useState<ImportCellErrors>({})
  const [mode, setMode] = useState<ImportCommitMode>(
    editableProject ? 'append' : 'new',
  )
  const [projectName, setProjectName] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingReplace, setPendingReplace] = useState(false)
  const [templates, setTemplates] = useState<MappingTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [templateMessage, setTemplateMessage] = useState<string | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [templateBusy, setTemplateBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listMappingTemplates()
      .then((loaded) => {
        if (cancelled) {
          return
        }
        if (loaded.ok) {
          setTemplates(loaded.value)
        } else {
          setTemplateError(loaded.error.message)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTemplateError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const mappingIssues = useMemo(
    () => (table === null ? [] : validateMapping(table, mapping)),
    [table, mapping],
  )
  const tokens = useMemo(
    () => (table === null ? [] : directionTokens(table, mapping)),
    [table, mapping],
  )
  const preview = useMemo(
    () => (table === null ? null : validateImport(table, mapping, edits)),
    [table, mapping, edits],
  )
  const limitColumns = useMemo(
    () => (table === null ? [] : findLimitColumns(table, mapping.hasHeader)),
    [table, mapping.hasHeader],
  )

  const plan = useMemo(() => {
    if (
      preview === null ||
      preview.globalErrors.length > 0 ||
      preview.issues.length > 0 ||
      preview.validTerms.length !== preview.rows.length
    ) {
      return null
    }
    return planImportCommit({
      mode,
      baseDraft: editableProject ? baseDraft : null,
      terms: preview.validTerms,
    })
  }, [preview, mode, editableProject, baseDraft])

  const planCellErrors: ImportCellErrors =
    plan !== null && !plan.ok ? plan.cellErrors : {}
  const displayCellErrors: ImportCellErrors = {
    ...(preview?.cellErrors ?? {}),
    ...planCellErrors,
    ...commitCellErrors,
  }

  const canSubmit =
    preview !== null &&
    preview.globalErrors.length === 0 &&
    preview.issues.length === 0 &&
    Object.keys(preview.cellErrors).length === 0 &&
    plan !== null &&
    plan.ok &&
    !busy

  const resetFromTable = (nextTable: RawTable, nextHasHeader: boolean): void => {
    const next = suggestMapping(nextTable, nextHasHeader)
    setMapping(next)
    setHasHeader(nextHasHeader)
    setEdits({})
    setCommitCellErrors({})
    setShowMappingIssues(false)
    setDirectionChoices({})
    setUnitError(null)
    setSubmitError(null)
    setTemplateMessage(null)
    setTemplateError(null)
  }

  const handleParse = (): void => {
    setParseError(null)
    const parsed = parseTableText(text)
    if (!parsed.ok) {
      setParseError(parsed.error.message)
      return
    }
    setTable(parsed.table)
    resetFromTable(parsed.table, true)
    setStep('header')
  }

  const handleHeaderNext = (): void => {
    if (table === null) {
      return
    }
    resetFromTable(table, hasHeader)
    setStep('mapping')
  }

  const handleMappingNext = (): void => {
    if (table === null) {
      return
    }
    setShowMappingIssues(true)
    if (mappingIssues.length > 0) {
      return
    }
    const choices: Record<string, DirectionChoice> = {}
    for (const token of tokens) {
      choices[token] =
        mapping.directionValues[token] ??
        candidateDirectionValue(token) ??
        ''
    }
    setDirectionChoices(choices)
    setUnitError(null)
    setStep('units')
  }

  const handleUnitsNext = (): void => {
    const unmapped = tokens.filter((token) => directionChoices[token] === undefined || directionChoices[token] === '')
    if (unmapped.length > 0) {
      setUnitError(
        `请先为方向值 ${unmapped.map((token) => `「${token}」`).join('、')} 明确选择 +1 或 -1；未知方向不能默认按正环处理。`,
      )
      return
    }
    const directionValues: ColumnMapping['directionValues'] = {}
    for (const token of tokens) {
      const choice = directionChoices[token]
      if (choice === 1 || choice === -1) {
        directionValues[token] = choice
      }
    }
    setMapping((current) => ({ ...current, directionValues }))
    setEdits({})
    setCommitCellErrors({})
    setUnitError(null)
    setStep('preview')
  }

  const handleApplyTemplate = (): void => {
    if (table === null || selectedTemplateId === '') {
      return
    }
    const template = templates.find((item) => item.id === selectedTemplateId)
    if (template === undefined) {
      return
    }
    const applied = applyMappingTemplate(table, template)
    setHasHeader(template.hasHeader)
    setMapping(applied.mapping)
    setEdits({})
    setCommitCellErrors({})
    setShowMappingIssues(false)
    setDirectionChoices({})
    if (applied.ok) {
      setTemplateMessage(`已套用模板「${template.name}」，请核对映射后继续。`)
      setTemplateError(null)
    } else {
      setTemplateMessage(null)
      setTemplateError(applied.reason)
    }
  }

  const handleSaveTemplate = (): void => {
    if (table === null || templateName.trim() === '') {
      setTemplateError('请填写模板名称')
      return
    }
    if (mappingIssues.length > 0) {
      setShowMappingIssues(true)
      setTemplateError('请先完成必填映射再保存模板')
      return
    }
    setTemplateBusy(true)
    setTemplateError(null)
    setTemplateMessage(null)
    void saveMappingTemplate({
      name: templateName,
      table,
      mapping,
    })
      .then((saved) => {
        if (saved.ok) {
          setTemplateMessage(`已保存模板「${saved.value.name}」（不包含任何数据行）`)
          setTemplateName('')
          return listMappingTemplates()
        }
        setTemplateError(saved.error.message)
        return null
      })
      .then((listed) => {
        if (listed !== null) {
          if (listed.ok) {
            setTemplates(listed.value)
          } else {
            setTemplateError(listed.error.message)
          }
        }
      })
      .catch((error: unknown) => {
        setTemplateError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setTemplateBusy(false)
      })
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) {
      return
    }
    setParseError(null)
    setText('')
    setFileName(null)
    if (file.size > MAX_IMPORT_BYTES) {
      setParseError(`文件不能超过 1 MB，当前为 ${file.size} 字节`)
      return
    }
    void readUtf8File(file)
      .then((content) => {
        setText(content)
        setFileName(file.name)
      })
      .catch((error: unknown) => {
        setParseError(error instanceof Error ? error.message : String(error))
      })
  }

  const updateEdit = (rowNumber: number, field: ImportField, value: string): void => {
    setEdits((current) => ({
      ...current,
      [importCellKey(rowNumber, field)]: value,
    }))
    setCommitCellErrors({})
    setSubmitError(null)
  }

  const performCommit = (): void => {
    setPendingReplace(false)
    if (preview === null) {
      return
    }
    setBusy(true)
    setSubmitError(null)
    setCommitCellErrors({})
    void commitImport({
      mode,
      projectId: project?.id,
      projectName,
      baseDraft: editableProject ? baseDraft : null,
      terms: preview.validTerms,
    })
      .then((committed) => {
        if (committed.ok) {
          onImported(committed.value)
          onClose()
          return
        }
        setSubmitError(committed.error.message)
        setCommitCellErrors(committed.cellErrors)
      })
      .catch((error: unknown) => {
        setSubmitError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const handleSubmit = (): void => {
    if (!canSubmit) {
      return
    }
    if (mode === 'replace') {
      setPendingReplace(true)
      return
    }
    performCommit()
  }

  const stepIndex = STEP_LABELS.findIndex((item) => item.step === step)
  const columnOptions = table === null ? [] : columnLabels(table, hasHeader)

  return (
    <div className="import-wizard__backdrop">
      <section
        className="import-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="import-wizard__header">
          <div>
            <h2 id={titleId} className="import-wizard__title">
              {editableProject ? '从表格追加 / 替换组成环' : '从表格导入尺寸表'}
            </h2>
            <p className="import-wizard__subtitle">
              粘贴 Excel 制表符文本或 UTF-8 CSV。数值不会自动换算单位、展开对称公差或计算公式。
            </p>
          </div>
          <button
            type="button"
            className="import-wizard__close"
            onClick={onClose}
            aria-label="关闭导入向导"
            disabled={busy}
          >
            取消
          </button>
        </header>

        <ol className="import-wizard__steps" aria-label="导入步骤">
          {STEP_LABELS.map((item, index) => (
            <li
              key={item.step}
              className={
                index === stepIndex
                  ? 'import-wizard__step import-wizard__step--current'
                  : index < stepIndex
                    ? 'import-wizard__step import-wizard__step--done'
                    : 'import-wizard__step'
              }
              aria-current={index === stepIndex ? 'step' : undefined}
            >
              <span>{index + 1}</span>
              {item.label}
            </li>
          ))}
        </ol>

        <div className="import-wizard__body">
          {step === 'input' ? (
            <section aria-labelledby={`${titleId}-input`}>
              <h3 id={`${titleId}-input`} className="import-wizard__section-title">
                1. 选择输入
              </h3>
              <textarea
                className="import-wizard__textarea"
                aria-label="表格文本"
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                  setFileName(null)
                  setParseError(null)
                }}
                placeholder={'代号\t基本尺寸\t下偏差\t上偏差\t方向\nH\t100.0000\t0.0000\t0.1000\t+1'}
                spellCheck={false}
              />
              <div className="import-wizard__file-row">
                <label className="import-wizard__file-label">
                  选择 .csv / .tsv / .txt 文件（UTF-8）
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                    aria-label="选择 CSV 或 TSV 文件"
                    onChange={handleFileChange}
                  />
                </label>
                {fileName !== null ? (
                  <span className="import-wizard__file-name">已读取：{fileName}</span>
                ) : null}
              </div>
              <p className="import-wizard__hint">
                原文上限 1 MB；解析后最多 {MAX_IMPORT_ROWS} 行；最终提交组成环最多 20 项。
                完全空白行会被忽略并计数，部分空白行会逐字段报错。
              </p>
              {parseError !== null ? (
                <p className="import-wizard__error" role="alert">
                  {parseError}
                </p>
              ) : null}
            </section>
          ) : null}

          {step === 'header' && table !== null ? (
            <section aria-labelledby={`${titleId}-header`}>
              <h3 id={`${titleId}-header`} className="import-wizard__section-title">
                2. 是否有表头
              </h3>
              <p className="import-wizard__hint">
                已解析 {table.rows.length} 行，忽略完全空白行 {table.blankRows} 行；
                分隔符：{table.delimiter === '\t' ? '制表符（TSV）' : '逗号（CSV）'}。
              </p>
              <fieldset className="import-wizard__choice-group">
                <legend>第一行是否为表头？</legend>
                <label>
                  <input
                    type="radio"
                    name="has-header"
                    checked={hasHeader}
                    onChange={() => setHasHeader(true)}
                  />
                  有表头（第一行是列名）
                </label>
                <label>
                  <input
                    type="radio"
                    name="has-header"
                    checked={!hasHeader}
                    onChange={() => setHasHeader(false)}
                  />
                  无表头（第一行就是数据）
                </label>
              </fieldset>
              <div className="import-wizard__raw-preview" role="region" aria-label="原文前几行">
                {table.rows.slice(0, 4).map((row) => (
                  <p key={row.rowNumber}>
                    <span>第 {row.rowNumber} 行</span>
                    {row.cells.join(' | ')}
                  </p>
                ))}
              </div>
            </section>
          ) : null}

          {step === 'mapping' && table !== null ? (
            <section aria-labelledby={`${titleId}-mapping`}>
              <h3 id={`${titleId}-mapping`} className="import-wizard__section-title">
                3. 映射列
              </h3>
              <p className="import-wizard__hint">
                {hasHeader
                  ? '已根据表头给出自动映射候选，请逐项核对并由你确认。含“极限尺寸”的列不会自动映射到偏差。'
                  : '当前选择“无表头”，请按列位置逐项选择映射；系统不会按位置自动猜测。'}
              </p>

              <div className="import-wizard__template">
                <h4>映射模板（只保存列结构，不保存数据行）</h4>
                <div className="import-wizard__template-row">
                  <label>
                    套用模板
                    <select
                      aria-label="映射模板"
                      value={selectedTemplateId}
                      onChange={(event) => setSelectedTemplateId(event.target.value)}
                    >
                      <option value="">未选择模板</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                          {template.hasHeader ? '（有表头）' : '（无表头）'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={handleApplyTemplate}
                    disabled={selectedTemplateId === ''}
                  >
                    套用模板
                  </button>
                </div>
                <div className="import-wizard__template-row">
                  <label>
                    模板名称
                    <input
                      type="text"
                      aria-label="模板名称"
                      value={templateName}
                      onChange={(event) => setTemplateName(event.target.value)}
                      placeholder="例如：轴承尺寸表"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleSaveTemplate}
                    disabled={templateBusy}
                  >
                    {templateBusy ? '保存中…' : '保存当前映射为模板'}
                  </button>
                </div>
                {templateMessage !== null ? (
                  <p className="import-wizard__notice" role="status">
                    {templateMessage}
                  </p>
                ) : null}
                {templateError !== null ? (
                  <p className="import-wizard__error" role="alert">
                    {templateError}
                  </p>
                ) : null}
              </div>

              <div className="import-wizard__mapping-grid">
                {COLUMN_FIELDS.map(({ field, label, optional }) => {
                  const constant =
                    (field === 'lower' && mapping.lowerConstantZero) ||
                    (field === 'upper' && mapping.upperConstantZero)
                  return (
                    <div key={field} className="import-wizard__mapping-field">
                      <label>
                        {label}
                        {optional ? '（可选）' : ''}
                        <select
                          aria-label={`${label}映射列`}
                          value={columnFieldValue(mapping, field) ?? ''}
                          disabled={constant}
                          onChange={(event) =>
                            setMapping((current) =>
                              withColumn(
                                current,
                                field,
                                event.target.value === ''
                                  ? null
                                  : Number(event.target.value),
                              ),
                            )
                          }
                        >
                          <option value="">未选择</option>
                          {columnOptions.map((labelText, index) => (
                            <option key={index} value={index}>
                              {labelText}
                            </option>
                          ))}
                        </select>
                      </label>
                      {field === 'lower' || field === 'upper' ? (
                        <label className="import-wizard__constant">
                          <input
                            type="checkbox"
                            checked={
                              field === 'lower'
                                ? mapping.lowerConstantZero
                                : mapping.upperConstantZero
                            }
                            onChange={(event) =>
                              setMapping((current) => ({
                                ...current,
                                ...(field === 'lower'
                                  ? { lowerConstantZero: event.target.checked }
                                  : { upperConstantZero: event.target.checked }),
                              }))
                            }
                          />
                          该列使用常量 0（仅在你明确选择时）
                        </label>
                      ) : null}
                    </div>
                  )
                })}

                <div className="import-wizard__mapping-field">
                  <label>
                    名称来源
                    <select
                      aria-label="名称来源"
                      value={mapping.nameMode}
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          nameMode: event.target.value === 'column' ? 'column' : 'symbol',
                        }))
                      }
                    >
                      <option value="symbol">统一用代号</option>
                      <option value="column">名称来自某列</option>
                    </select>
                  </label>
                  {mapping.nameMode === 'column' ? (
                    <label>
                      名称列
                      <select
                        aria-label="名称映射列"
                        value={mapping.nameColumn ?? ''}
                        onChange={(event) =>
                          setMapping((current) => ({
                            ...current,
                            nameColumn:
                              event.target.value === ''
                                ? null
                                : Number(event.target.value),
                          }))
                        }
                      >
                        <option value="">未选择</option>
                        {columnOptions.map((labelText, index) => (
                          <option key={index} value={index}>
                            {labelText}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              </div>

              <p className="import-wizard__summary">
                当前映射：{mappingColumnSummary(table, mapping)}
              </p>

              {showMappingIssues && mappingIssues.length > 0 ? (
                <div className="import-wizard__error" role="alert">
                  {mappingIssues.map((issue, index) => (
                    <p key={`${issue.field}-${index}`}>{issue.message}</p>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {step === 'units' && table !== null ? (
            <section aria-labelledby={`${titleId}-units`}>
              <h3 id={`${titleId}-units`} className="import-wizard__section-title">
                4. 单位与含义确认
              </h3>
              <div className="import-wizard__unit-box">
                <p>
                  <strong>单位：毫米（mm）</strong>，最多 4 位小数。基本尺寸 + 上下偏差是唯一接受的格式；
                  不自动转换对称公差、逗号小数或中文千分位，公式文本按非法数值处理。
                </p>
                <p>
                  {mapping.lowerConstantZero ? '下偏差使用常量 0；' : ''}
                  {mapping.upperConstantZero ? '上偏差使用常量 0；' : ''}
                  {!mapping.lowerConstantZero && !mapping.upperConstantZero
                    ? '上下偏差均来自映射列。'
                    : ''}
                </p>
              </div>

              <h4>方向含义</h4>
              <p className="import-wizard__hint">
                方向只接受 +1（增加封闭环）或 -1（减小封闭环）。系统只给出显式候选，
                未知值必须由你选择，不能默认按正环处理。
              </p>
              {tokens.length === 0 ? (
                <p className="import-wizard__warning" role="note">
                  方向列没有非空值。继续后预览会逐行报告缺失方向，修正后才能提交。
                </p>
              ) : (
                <div className="import-wizard__direction-list">
                  {tokens.map((token) => (
                    <label key={token}>
                      方向值「{token}」
                      <select
                        aria-label={`方向值「${token}」的含义`}
                        value={
                          directionChoices[token] === undefined
                            ? ''
                            : String(directionChoices[token])
                        }
                        onChange={(event) => {
                          const value = event.target.value
                          setDirectionChoices((current) => ({
                            ...current,
                            [token]: value === '' ? '' : (Number(value) as DirectionValue),
                          }))
                          setUnitError(null)
                        }}
                      >
                        <option value="">未映射</option>
                        <option value="1">+1（增加封闭环）</option>
                        <option value="-1">-1（减小封闭环）</option>
                      </select>
                    </label>
                  ))}
                </div>
              )}
              {unitError !== null ? (
                <p className="import-wizard__error" role="alert">
                  {unitError}
                </p>
              ) : null}
            </section>
          ) : null}

          {step === 'preview' && preview !== null && table !== null ? (
            <section aria-labelledby={`${titleId}-preview`}>
              <h3 id={`${titleId}-preview`} className="import-wizard__section-title">
                5. 预览校验
              </h3>
              <p className="import-wizard__hint">
                共 {preview.rows.length} 个数据行，忽略完全空白行 {preview.ignoredBlankRows} 行；
                有效 {preview.validTerms.length} 行。代号已 trim，其他数值不会静默改写。
              </p>
              {limitColumns.length > 0 ? (
                <p className="import-wizard__warning" role="note">
                  检测到极限尺寸列：{limitColumns.join('、')}。这些列不会自动映射到下/上偏差，
                  请使用“基本尺寸 + 上下偏差”格式。
                </p>
              ) : null}
              {preview.globalErrors.length > 0 ? (
                <div className="import-wizard__error" role="alert">
                  {preview.globalErrors.map((message, index) => (
                    <p key={index}>{message}</p>
                  ))}
                </div>
              ) : null}
              {plan !== null && !plan.ok ? (
                <div className="import-wizard__error" role="alert">
                  {plan.message}
                </div>
              ) : null}
              {submitError !== null ? (
                <p className="import-wizard__error" role="alert">
                  {submitError}
                </p>
              ) : null}

              <div className="import-wizard__rows">
                {preview.rows.map((row) => {
                  const rowErrors = row.errors
                  return (
                    <article
                      key={row.rowNumber}
                      className={
                        Object.keys(rowErrors).length > 0
                          ? 'import-wizard__row import-wizard__row--error'
                          : 'import-wizard__row'
                      }
                      data-testid={`import-row-${row.rowNumber}`}
                    >
                      <header className="import-wizard__row-header">
                        <h4>第 {row.rowNumber} 行</h4>
                        <span>{row.term !== null ? '有效' : '有错误'}</span>
                      </header>
                      <p className="import-wizard__raw">
                        原文：{row.sourceCells.length === 0 ? '（空）' : row.sourceCells.join(' | ')}
                      </p>
                      {row.warnings.map((warning, index) => (
                        <p key={index} className="import-wizard__warning" role="note">
                          {warning}
                        </p>
                      ))}
                      <div className="import-wizard__row-grid">
                        <label>
                          代号
                          <input
                            type="text"
                            aria-label={`第 ${row.rowNumber} 行 代号`}
                            value={row.values.symbol}
                            aria-invalid={rowErrors.symbol === undefined ? undefined : true}
                            onChange={(event) =>
                              updateEdit(row.rowNumber, 'symbol', event.target.value)
                            }
                          />
                        </label>
                        <label>
                          名称
                          <input
                            type="text"
                            aria-label={`第 ${row.rowNumber} 行 名称`}
                            value={row.values.name}
                            readOnly={mapping.nameMode === 'symbol'}
                            aria-invalid={rowErrors.name === undefined ? undefined : true}
                            onChange={(event) =>
                              updateEdit(row.rowNumber, 'name', event.target.value)
                            }
                          />
                        </label>
                        <label>
                          基本尺寸
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`第 ${row.rowNumber} 行 基本尺寸`}
                            value={row.values.nominal}
                            aria-invalid={
                              rowErrors.nominal === undefined ? undefined : true
                            }
                            onChange={(event) =>
                              updateEdit(row.rowNumber, 'nominal', event.target.value)
                            }
                          />
                        </label>
                        <label>
                          下偏差
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`第 ${row.rowNumber} 行 下偏差`}
                            value={row.values.lower}
                            readOnly={mapping.lowerConstantZero}
                            aria-invalid={rowErrors.lower === undefined ? undefined : true}
                            onChange={(event) =>
                              updateEdit(row.rowNumber, 'lower', event.target.value)
                            }
                          />
                        </label>
                        <label>
                          上偏差
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`第 ${row.rowNumber} 行 上偏差`}
                            value={row.values.upper}
                            readOnly={mapping.upperConstantZero}
                            aria-invalid={rowErrors.upper === undefined ? undefined : true}
                            onChange={(event) =>
                              updateEdit(row.rowNumber, 'upper', event.target.value)
                            }
                          />
                        </label>
                        <label>
                          方向
                          <select
                            aria-label={`第 ${row.rowNumber} 行 方向`}
                            value={
                              row.values.sign === '1' || row.values.sign === '-1'
                                ? row.values.sign
                                : ''
                            }
                            aria-invalid={rowErrors.sign === undefined ? undefined : true}
                            onChange={(event) =>
                              updateEdit(row.rowNumber, 'sign', event.target.value)
                            }
                          >
                            <option value="">未选择</option>
                            <option value="1">+1（增加封闭环）</option>
                            <option value="-1">-1（减小封闭环）</option>
                          </select>
                        </label>
                        <label>
                          来源备注
                          <input
                            type="text"
                            aria-label={`第 ${row.rowNumber} 行 来源备注`}
                            value={row.values.sourceNote}
                            onChange={(event) =>
                              updateEdit(row.rowNumber, 'sourceNote', event.target.value)
                            }
                          />
                        </label>
                      </div>
                      <p className="import-wizard__parsed">
                        解析值：
                        {row.parsed.nominal === undefined
                          ? '基本尺寸 —'
                          : `基本尺寸 ${formatMm(row.parsed.nominal)}`}
                        {row.parsed.lower === undefined
                          ? '；下偏差 —'
                          : `；下偏差 ${formatMm(row.parsed.lower)}`}
                        {row.parsed.upper === undefined
                          ? '；上偏差 —'
                          : `；上偏差 ${formatMm(row.parsed.upper)}`}
                      </p>
                      {ROW_ERROR_FIELDS.map((field) => {
                        const message = errorText(
                          displayCellErrors,
                          row.rowNumber,
                          field,
                        )
                        return message === undefined ? null : (
                          <p
                            key={field}
                            className="import-wizard__cell-error"
                            data-testid={`import-error-${row.rowNumber}-${field}`}
                          >
                            {fieldLabel(field)}：{message}
                          </p>
                        )
                      })}
                    </article>
                  )
                })}
              </div>

              <div className="import-wizard__commit">
                {editableProject ? (
                  <label>
                    提交方式
                    <select
                      aria-label="提交方式"
                      value={mode}
                      onChange={(event) => {
                        setMode(event.target.value as ImportCommitMode)
                        setSubmitError(null)
                        setCommitCellErrors({})
                      }}
                    >
                      <option value="append">追加组成环</option>
                      <option value="replace">替换全部组成环</option>
                    </select>
                  </label>
                ) : (
                  <label>
                    新项目名称（可选）
                    <input
                      type="text"
                      aria-label="新项目名称"
                      value={projectName}
                      onChange={(event) => setProjectName(event.target.value)}
                      placeholder="未命名项目"
                    />
                  </label>
                )}
                <p className="import-wizard__hint">
                  {mode === 'replace'
                    ? '替换会移除当前全部组成环；提交前会再次确认。目标区间与假设说明保留。'
                    : mode === 'append'
                      ? '追加会检查与现有代号冲突，并清除关系确认。'
                      : '新建项目会以本次导入的组成环建立尺寸链，关系确认保持未确认。'}
                </p>
                {mode === 'replace' ? (
                  <p className="import-wizard__warning" role="note">
                    替换全部组成环需要二次确认。
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>

        <footer className="import-wizard__footer">
          <button
            type="button"
            className="import-wizard__cancel"
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <div className="import-wizard__footer-actions">
            {step !== 'input' ? (
              <button
                type="button"
                onClick={() => {
                  setSubmitError(null)
                  if (step === 'header') {
                    setStep('input')
                  } else if (step === 'mapping') {
                    setStep('header')
                  } else if (step === 'units') {
                    setStep('mapping')
                  } else if (step === 'preview') {
                    setStep('units')
                  }
                }}
                disabled={busy}
              >
                上一步
              </button>
            ) : null}
            {step === 'input' ? (
              <button
                type="button"
                className="import-wizard__primary"
                onClick={handleParse}
                disabled={text.trim() === ''}
              >
                下一步
              </button>
            ) : null}
            {step === 'header' ? (
              <button
                type="button"
                className="import-wizard__primary"
                onClick={handleHeaderNext}
              >
                下一步
              </button>
            ) : null}
            {step === 'mapping' ? (
              <button
                type="button"
                className="import-wizard__primary"
                onClick={handleMappingNext}
              >
                下一步
              </button>
            ) : null}
            {step === 'units' ? (
              <button
                type="button"
                className="import-wizard__primary"
                onClick={handleUnitsNext}
              >
                下一步
              </button>
            ) : null}
            {step === 'preview' ? (
              <button
                type="button"
                className="import-wizard__primary"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {busy
                  ? '提交中…'
                  : mode === 'new'
                    ? '导入并新建项目'
                    : mode === 'append'
                      ? `追加 ${preview?.validTerms.length ?? 0} 个组成环`
                      : '替换全部组成环'}
              </button>
            ) : null}
          </div>
        </footer>

        {pendingReplace ? (
          <ConfirmDialog
            title="替换全部组成环？"
            message="当前工作台的全部组成环将被本次导入的组成环替换。提交后会清除关系确认；若写入失败，原项目保持不变。"
            confirmLabel="确认替换"
            onConfirm={performCommit}
            onCancel={() => setPendingReplace(false)}
          />
        ) : null}
      </section>
    </div>
  )
}
