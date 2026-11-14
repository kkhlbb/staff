// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createSpacerSnapshot } from '../project-file/__fixtures__/spacerProjectFile'
import type { CunlianApi, IpcResult, StepExportValue } from '../../desktop/shared/contracts'
import { HistoricalStepExport } from './HistoricalStepExport'

async function fixture() {
  const snapshot = await createSpacerSnapshot({ length: '12.0001' })
  snapshot.fileRevisions[0].project = structuredClone(snapshot.fileRevisions[0].project)
  snapshot.fileRevisions[0].project.parameters = structuredClone(snapshot.project.parameters).map(p => ({ ...p, reviewStatus: 'confirmed' }))
  const stepExport = vi.fn<CunlianApi['stepExport']>(async request => ({ ok: true, value: {
    fileName: 'real.step', byteSize: 9000, sha256: 'a'.repeat(64), revisionId: request.revisionId,
    inputFingerprint: request.expectedInputFingerprint, geometryFingerprint: 'geom',
    kernelVersion: 'OCCT', wasmSha256: 'b'.repeat(64), generatorVersion: 'spacer-step-generator-v1',
    schema: 'AP214IS', unit: 'mm', historicalByteIdentical: null, warnings: ['测试回执警告'],
  } }))
  const stepCancel = vi.fn<CunlianApi['stepCancel']>(async () => ({ ok: true, value: { cancelled: false } }))
  return { snapshot, api: { stepExport, stepCancel } }
}

describe('historical STEP UI', () => {
  it('requires explicit selection and exports only exact historical identity, then shows receipt', async () => {
    const { snapshot, api } = await fixture()
    render(<HistoricalStepExport snapshot={snapshot} sessionId="session" baseEditSeq={7} api={api} />)
    const button = screen.getByRole('button', { name: '导出所选历史版本 STEP' })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText('STEP 正式历史版本'), { target: { value: snapshot.fileRevisions[0].revisionId } })
    fireEvent.click(button)
    await screen.findByText(/real.step/)
    expect(api.stepExport).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session', baseEditSeq: 7, revisionId: snapshot.fileRevisions[0].revisionId, jobId: expect.any(String), expectedInputFingerprint: expect.any(String) }))
    expect(screen.getByText(/测试回执警告/)).toBeInTheDocument()
    expect(screen.getByText(/非当时 STEP 字节重出/)).toBeInTheDocument()
  })
  it('does not invent cancellation while export is still running', async () => {
    const { snapshot, api } = await fixture()
    let finish!: (value: IpcResult<StepExportValue>) => void
    api.stepExport.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    render(<HistoricalStepExport snapshot={snapshot} sessionId="session" baseEditSeq={7} api={api} />)
    fireEvent.change(screen.getByLabelText('STEP 正式历史版本'), { target: { value: snapshot.fileRevisions[0].revisionId } })
    fireEvent.click(screen.getByText('导出所选历史版本 STEP'))
    fireEvent.click(await screen.findByRole('button', { name: '取消 STEP 导出' }))
    await screen.findByText(/未取消；等待导出最终回执/)
    expect(api.stepCancel).toHaveBeenCalledWith({ sessionId: 'session', jobId: api.stepExport.mock.calls[0][0].jobId })
    finish({ ok: false, error: { code: 'COMMITTED_UNCONFIRMED', message: '已替换但未确认' } })
    await screen.findByText(/COMMITTED_UNCONFIRMED/)
  })
  it('rejects a mismatched success receipt rather than displaying a fabricated success', async () => {
    const { snapshot, api } = await fixture()
    const implementation = api.stepExport.getMockImplementation()!
    api.stepExport.mockImplementation(async request => {
      const result = await implementation(request)
      if (result.ok) result.value.inputFingerprint = 'wrong'
      return result
    })
    render(<HistoricalStepExport snapshot={snapshot} sessionId="session" baseEditSeq={7} api={api} />)
    fireEvent.change(screen.getByLabelText('STEP 正式历史版本'), { target: { value: snapshot.fileRevisions[0].revisionId } })
    fireEvent.click(screen.getByText('导出所选历史版本 STEP'))
    await screen.findByText(/回执身份不匹配/)
    expect(screen.queryByLabelText('STEP 主进程回执')).not.toBeInTheDocument()
  })
  it('refuses missing desktop permission/API and draft parameter identity', async () => {
    const { snapshot, api } = await fixture()
    snapshot.fileRevisions[0].project.parameters = structuredClone(snapshot.project.parameters)
    render(<HistoricalStepExport snapshot={snapshot} sessionId={null} baseEditSeq={7} api={api} />)
    fireEvent.change(screen.getByLabelText('STEP 正式历史版本'), { target: { value: snapshot.fileRevisions[0].revisionId } })
    await waitFor(() => expect(screen.getByText(/草稿参数不能正式导出/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '导出所选历史版本 STEP' })).toBeDisabled()
    expect(api.stepExport).not.toHaveBeenCalled()
  })
})
