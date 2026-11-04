import type { WorkspaceDraft } from '../workspace/draft'

export type ChainExpressionTerm = Pick<
  WorkspaceDraft['terms'][number],
  'symbol' | 'sign'
>

export interface ChainExpressionProps {
  /** 可直接传入 useWorkspace 返回的 draft。 */
  draft?: Pick<WorkspaceDraft, 'terms'>
  /** 只需要顺序和方向时，也可以单独传入组成环。 */
  terms?: readonly ChainExpressionTerm[]
}

const EMPTY_EXPRESSION = 'C = （空链，请添加组成环）'

/**
 * 按草稿当前顺序和方向生成封闭环表达式。
 *
 * 只做展示，不重新排序也不计算数值；重排后的顺序就是用户当前看到的顺序。
 */
function formatExpression(terms: readonly ChainExpressionTerm[]): string {
  if (terms.length === 0) {
    return EMPTY_EXPRESSION
  }

  const body = terms
    .map((term, index) => {
      const sign = term.sign === 1 ? '+' : '-'
      // 第一项写成 +H，后续项写成 - B1，保持文档示例的空格形式。
      return index === 0 ? `${sign}${term.symbol}` : `${sign} ${term.symbol}`
    })
    .join(' ')

  return `C = ${body}`
}

/** 始终可见的尺寸链表达式展示组件。 */
export function ChainExpression({ draft, terms }: ChainExpressionProps) {
  const currentTerms = terms ?? draft?.terms ?? []
  const expression = formatExpression(currentTerms)

  return (
    <section className="chain-expression" aria-label="尺寸链表达式">
      <h2 className="chain-expression__title">尺寸链表达式</h2>
      <p
        className="chain-expression__formula"
        data-testid="chain-expression"
        aria-live="polite"
      >
        {expression}
      </p>
    </section>
  )
}
