import type { M3MigrationReport } from './m3WorkbenchBridge'

export interface M3MigrationBannerProps {
  readonly report: M3MigrationReport
  readonly drawerOpen: boolean
  readonly onToggleDrawer: () => void
}

function formatVerdictLabel(verdict: 'pass' | 'fail' | 'boundary_pass'): {
  readonly label: string
  readonly tone: string
} {
  switch (verdict) {
    case 'pass':
      return { label: '✓ 通过', tone: 'pa-tone-pass' }
    case 'boundary_pass':
      return { label: '✓ 边界通过', tone: 'pa-tone-pass' }
    case 'fail':
      return { label: '✕ 失败', tone: 'pa-tone-danger' }
  }
}

export function M3MigrationBanner({
  report,
  drawerOpen,
  onToggleDrawer,
}: M3MigrationBannerProps) {
  return (
    <section
      className="pa-panel pa-migration-banner"
      aria-label="旧项目迁移差异提示"
      data-testid="migration-banner"
    >
      <div className="pa-header">
        <div className="pa-row">
          <span className="pa-pill pa-tone-pending">旧项目迁移差异</span>
          <strong>
            已读取 {report.sourceFormat} 项目，原文件已保留，未静默丢弃任何旧字段
          </strong>
          {report.originalFilePreserved ? (
            <span className="pa-pill pa-tone-pass">✓ 原件已保留</span>
          ) : null}
          <span
            className={`pa-pill ${
              report.legacyChainCompatibility.compatible ? 'pa-tone-pass' : 'pa-tone-danger'
            }`}
          >
            {report.legacyChainCompatibility.compatible
              ? '✓ 既有尺寸链兼容'
              : '✕ 既有尺寸链存在差异'}
          </span>
        </div>
        <button
          type="button"
          className="pa-btn"
          aria-expanded={drawerOpen}
          onClick={onToggleDrawer}
        >
          {drawerOpen ? '收起迁移差异详情' : '查看迁移差异详情'}
        </button>
      </div>

      <p className="pa-muted">
        保留在原件中的未解释旧字段 {report.unexplainedLegacyFields.length} 项 · 受限操作{' '}
        {report.restrictedOperations.length} 项 · {report.legacyChainCompatibility.summary}
      </p>

      {drawerOpen ? (
        <div className="pa-list pa-migration-drawer" aria-label="旧项目迁移差异抽屉">
          {report.originalFilePath ? (
            <p className="pa-muted pa-mono">
              原件路径：{report.originalFilePath}
              {report.migratedAtLabel ? ` · 迁移时间：${report.migratedAtLabel}` : ''}
            </p>
          ) : null}

          <div className="pa-card" aria-label="保留在原件中的未解释旧字段">
            <span className="pa-card-label">
              保留在原件中的未解释旧字段（{report.unexplainedLegacyFields.length} 项，不静默丢弃）
            </span>
            {report.unexplainedLegacyFields.length === 0 ? (
              <p className="pa-muted">无未解释旧字段。</p>
            ) : (
              <ul className="pa-list">
                {report.unexplainedLegacyFields.map((field) => (
                  <li key={field.fieldPath} className="pa-check">
                    <div>
                      <div className="pa-row">
                        <strong className="pa-mono">{field.fieldPath}</strong>
                        <span className="pa-pill pa-tone-muted pa-mono">
                          原值：{field.rawValueSummary}
                        </span>
                        <span className="pa-pill pa-tone-pass">保留在原件</span>
                      </div>
                      <p className="pa-muted">{field.reason}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="pa-card" aria-label="迁移后受限操作说明">
            <span className="pa-card-label">
              具体受限操作说明（{report.restrictedOperations.length} 项）
            </span>
            {report.restrictedOperations.length === 0 ? (
              <p className="pa-muted">当前无受限操作。</p>
            ) : (
              <ul className="pa-list">
                {report.restrictedOperations.map((item) => (
                  <li key={item.operation} className="pa-check">
                    <div>
                      <strong>{item.operation}</strong>
                      <p className="pa-muted">
                        限制原因：{item.reason}
                        {item.workaround ? ` · 建议：${item.workaround}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="pa-card" aria-label="既有尺寸链兼容结论">
            <div className="pa-header">
              <span className="pa-card-label">既有尺寸链兼容结论</span>
              <span
                className={`pa-pill ${
                  report.legacyChainCompatibility.compatible ? 'pa-tone-pass' : 'pa-tone-danger'
                }`}
              >
                {report.legacyChainCompatibility.compatible ? '✓ 兼容通过' : '✕ 不兼容'}
              </span>
            </div>
            <p className="pa-muted">{report.legacyChainCompatibility.summary}</p>
            {report.legacyChainCompatibility.samples &&
            report.legacyChainCompatibility.samples.length > 0 ? (
              <ul className="pa-list" aria-label="隔套一维尺寸链回归样例">
                {report.legacyChainCompatibility.samples.map((sample) => {
                  const badge = formatVerdictLabel(sample.verdict)
                  return (
                    <li key={`${sample.label}-${sample.lengthMm}`} className="pa-check">
                      <div className="pa-row">
                        <strong>{sample.label}</strong>
                        <span className="pa-mono pa-muted">长度 {sample.lengthMm}</span>
                        {sample.detail ? <span className="pa-muted">{sample.detail}</span> : null}
                      </div>
                      <span className={`pa-pill ${badge.tone}`}>{badge.label}</span>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
