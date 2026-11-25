import { useState } from 'react'
import './ProjectAgentPanel.css'
import { ProjectAgentPanel } from './ProjectAgentPanel'
import {
  createEmptyObservationSnapshot,
  M0_FIXTURE_IDS,
  resolveM0Fixture,
} from './m0PreviewFixtures'

const EMPTY_SNAPSHOT = createEmptyObservationSnapshot()

export function ProjectAgentM0Preview() {
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [selectedTab, setSelectedTab] = useState<'model' | 'drawing'>('model')

  const active = selectedCaseId ? resolveM0Fixture(selectedCaseId) : { snapshot: EMPTY_SNAPSHOT, needsSnapshot: false }

  return (
    <main className="pa-preview" aria-label="M0 只读模拟预览">
      <div className="pa-header">
        <h1 className="pa-title">M0 只读模拟预览</h1>
        <span className="pa-muted">非正式工作台</span>
      </div>
      <div className="pa-controls">
        {!selectedCaseId ? (
          <button type="button" className="pa-btn" onClick={() => setSelectedCaseId(M0_FIXTURE_IDS[0])}>
            打开模拟样本
          </button>
        ) : (
          <>
            <label className="pa-toggle">
              模拟样本
              <select
                aria-label="选择模拟样本"
                className="pa-select"
                value={selectedCaseId}
                onChange={(e) => setSelectedCaseId(e.target.value)}
              >
                {M0_FIXTURE_IDS.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>
            <button type="button" className="pa-btn" onClick={() => setSelectedCaseId(null)}>
              返回空观察
            </button>
          </>
        )}
        <label className="pa-toggle">
          <input type="checkbox" checked={narrow} onChange={(e) => setNarrow(e.target.checked)} />
          窄屏模式
        </label>
        <button type="button" className={`pa-btn ${selectedTab === 'model' ? 'pa-btn-active' : ''}`} onClick={() => setSelectedTab('model')}>
          模型
        </button>
        <button type="button" className={`pa-btn ${selectedTab === 'drawing' ? 'pa-btn-active' : ''}`} onClick={() => setSelectedTab('drawing')}>
          图纸
        </button>
      </div>
      <ProjectAgentPanel
        snapshot={active.snapshot}
        needsSnapshot={active.needsSnapshot}
        synthetic={selectedCaseId !== null}
        narrow={narrow}
        selectedTab={selectedTab}
      />
      <p className="pa-muted">
        说明：expired-confirmation 与 reference-stale 场景尚无 DTO 样本规范，当前不虚构数据，正式保存始终不可用。
      </p>
    </main>
  )
}
