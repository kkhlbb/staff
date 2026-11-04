import { useState } from 'react'
import { ChainDiagram } from '../components/ChainDiagram'
import { ChainExpression } from '../components/ChainExpression'
import { DimensionTable } from '../components/DimensionTable'
import { ResultPanel } from '../components/ResultPanel'
import type { ChainDefinition } from '../domain/types'
import { useWorkspace } from '../workspace/useWorkspace'
import './Workspace.css'

/**
 * 分析工作台：左侧组成环表、中部表达式与示意图、右侧结果卡。
 *
 * 页面只负责组合受控组件和保存交互状态；尺寸链计算全部来自 useWorkspace
 * （内部调用 calculateChain），这里不写任何计算或校验公式。
 */
export function Workspace() {
  const { draft, dispatch, chain, result, cellErrors, stale } = useWorkspace()
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null)

  // 按 React 文档“存储前一次渲染的信息”的写法记住最后一次有效链。
  // 草稿无效时 useWorkspace 会保留上次结果，但 chain 为 null，
  // 因此结果卡需要从这里取得上次有效链的目标区间。不要在渲染期读写 ref。
  const [lastValidChain, setLastValidChain] = useState<ChainDefinition | null>(
    chain,
  )
  if (chain !== null && chain !== lastValidChain) {
    setLastValidChain(chain)
  }
  const target = chain !== null ? chain.target : (lastValidChain?.target ?? null)

  return (
    <main className="workspace">
      <header className="workspace__header">
        <div>
          <h1 className="workspace__title">轴系轴向公差链分析</h1>
          <p className="workspace__subtitle">
            输入组成环与目标区间，核对尺寸关系与作用方向后查看正式判定。
            所有数值使用 mm，计算由本地计算内核完成。
          </p>
        </div>
        <span className="workspace__badge">MVP · 一维极值法</span>
      </header>

      <div className="workspace__grid">
        <div className="workspace__column workspace__column--table">
          <DimensionTable
            draft={draft}
            dispatch={dispatch}
            chain={chain}
            cellErrors={cellErrors}
            stale={stale}
            selectedTermId={selectedTermId}
            onSelect={setSelectedTermId}
          />
        </div>

        <div className="workspace__column workspace__column--middle">
          <ChainExpression draft={draft} />
          <ChainDiagram
            terms={draft.terms}
            selectedTermId={selectedTermId}
            onSelect={setSelectedTermId}
          />
        </div>

        <div className="workspace__column workspace__column--result">
          <ResultPanel
            draft={draft}
            dispatch={dispatch}
            result={result}
            target={target}
            cellErrors={cellErrors}
            stale={stale}
          />
        </div>
      </div>
    </main>
  )
}
