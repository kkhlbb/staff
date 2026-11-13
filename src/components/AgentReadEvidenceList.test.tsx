// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentReadEvidenceList } from './AgentReadEvidenceList'

const image = { kind: 'agent-read', actorId: '李工', statement: '逐字说明 <原话>\n第二行', source: { kind: 'image', imageId: 'img-1', sha256: 'b'.repeat(64) } }
describe('读数出处列表', () => {
  it('图片来源显示人名、原话与身份，不伪造 PDF 页；重复引用只显示一次', () => {
    render(<AgentReadEvidenceList provenance={[image, image]} />)
    expect(screen.getAllByText('读数来源：图片，李工 提供')).toHaveLength(1)
    expect(screen.getByText(/逐字说明 <原话>/)).toBeInTheDocument()
    expect(screen.getByText(/来源图片 · 校验信息保存在项目文件中/)).toBeInTheDocument()
    expect(screen.queryByText(/img-1/)).not.toBeInTheDocument()
    expect(screen.queryByText(/第 .* 页/)).not.toBeInTheDocument()
  })
  it('非 agent-read 不根据相似字段伪装读数出处', () => {
    const { container } = render(<AgentReadEvidenceList provenance={[{ ...image, kind: 'user-attestation', requiresVerification: true }]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
