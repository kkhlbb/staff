// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import {
  createSourceBinding,
  getSourceBinding,
  listSourceBindings,
} from '../sources/bindings'
import { importSourceRevision } from '../sources/revisions'
import { createProject } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import type { TermDraft } from '../workspace/draft'
import type { RenderPdfPage } from './PdfViewer'
import { SourcePanel } from './SourcePanel'

const terms: TermDraft[] = [
  {
    id: 't-h',
    symbol: 'H',
    name: '孔',
    nominal: '100',
    lower: '0',
    upper: '0.1',
    sign: 1,
    sourceNote: '',
    termRevision: 1,
  },
  {
    id: 't-b',
    symbol: 'B',
    name: '轴',
    nominal: '99.9',
    lower: '-0.05',
    upper: '0',
    sign: -1,
    sourceNote: '',
    termRevision: 1,
  },
]

const chain: ChainDefinition = {
  terms: [
    {
      id: 't-h',
      symbol: 'H',
      name: '孔',
      nominalQ: parseMm('100'),
      lowerDeviationQ: parseMm('0'),
      upperDeviationQ: parseMm('0.1'),
      sign: 1,
      sourceNote: '',
      termRevision: 1,
    },
    {
      id: 't-b',
      symbol: 'B',
      name: '轴',
      nominalQ: parseMm('99.9'),
      lowerDeviationQ: parseMm('-0.05'),
      upperDeviationQ: parseMm('0'),
      sign: -1,
      sourceNote: '',
      termRevision: 1,
    },
  ],
  target: null,
  assumptions: '',
}

const bytesV1 = buildSyntheticPdf({ pageCount: 2, variant: 'ui-v1' })
const bytesV2 = buildSyntheticPdf({ pageCount: 2, variant: 'ui-v2' })
const bytesByHash = new Map<string, Uint8Array>([
  [createHash('sha256').update(bytesV1).digest('hex'), bytesV1],
  [createHash('sha256').update(bytesV2).digest('hex'), bytesV2],
])
const loadBytes = async (revision: { sha256: string }) =>
  bytesByHash.get(revision.sha256) ?? null

const renderPageForTest: RenderPdfPage = (_page, canvas, viewport) => {
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  return { promise: Promise.resolve(), cancel: () => undefined }
}

async function createTestProject(): Promise<string> {
  const created = await createProject({ name: '版本处置面板测试', working: chain })
  expect(created.ok, created.ok ? '' : created.error.message).toBe(true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  return created.value.id
}

async function importRevision(
  projectId: string,
  bytes: Uint8Array,
  documentId?: string,
) {
  const imported = await importSourceRevision({
    projectId,
    fileName: '装配图.pdf',
    bytes,
    ...(documentId === undefined ? {} : { documentId }),
  })
  expect(imported.ok, imported.ok ? '' : imported.error.message).toBe(true)
  if (!imported.ok) {
    throw new Error(imported.error.message)
  }
  return imported.value.revision
}

/** 建立“旧绑定 + 同文档新版本”的现场。 */
async function setupNewVersion(): Promise<{ projectId: string; bindingId: string }> {
  const projectId = await createTestProject()
  const v1 = await importRevision(projectId, bytesV1)
  const created = await createSourceBinding({
    projectId,
    termId: 't-h',
    revisionId: v1.id,
    page: 1,
    rectPdf: [10, 10, 100, 100],
    pageBoxPdf: [0, 0, 600, 800],
    note: '孔公差框',
  })
  expect(created.ok, created.ok ? '' : created.error.message).toBe(true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  await importRevision(projectId, bytesV2, v1.documentId)
  return { projectId, bindingId: created.value.id }
}

function renderPanel(projectId: string) {
  return render(
    <SourcePanel
      projectId={projectId}
      terms={terms}
      selectedTermId="t-h"
      loadBytes={loadBytes}
      renderPage={renderPageForTest}
    />,
  )
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

describe('新版来源逐绑定三选一', () => {
  it('导入新版后显示待版本复核与三选一入口', async () => {
    const { projectId, bindingId } = await setupNewVersion()
    renderPanel(projectId)

    await waitFor(() => {
      expect(screen.getByTestId(`binding-review-${bindingId}`)).toHaveTextContent(
        '待版本复核',
      )
    })
    const actions = screen.getByTestId(`binding-version-actions-${bindingId}`)
    expect(within(actions).getByText('迁移到新版（重新框选）')).toBeInTheDocument()
    expect(within(actions).getByText('继续用旧版（填理由）')).toBeInTheDocument()
    expect(within(actions).getByText('解除绑定')).toBeInTheDocument()
  })

  it('继续用旧版：理由与范围必填，成功后显示历史来源与理由，不冒充最新', async () => {
    const { projectId, bindingId } = await setupNewVersion()
    const user = userEvent.setup()
    renderPanel(projectId)

    await waitFor(() => {
      expect(screen.getByTestId(`binding-accept-old-${bindingId}`)).toBeInTheDocument()
    })
    await user.click(screen.getByTestId(`binding-accept-old-${bindingId}`))
    await user.click(screen.getByTestId(`binding-accept-submit-${bindingId}`))
    expect(await screen.findByText('继续使用旧版必须填写理由与适用范围。')).toBeInTheDocument()

    await user.type(
      screen.getByLabelText('继续使用旧版的理由'),
      '新版只补充了签署页',
    )
    await user.type(
      screen.getByLabelText('继续使用旧版的适用范围'),
      '仅用于本轮尺寸校核',
    )
    await user.click(screen.getByTestId(`binding-accept-submit-${bindingId}`))

    await waitFor(() => {
      expect(screen.getByTestId(`binding-historical-${bindingId}`)).toHaveTextContent(
        '不是最新版本',
      )
    })
    expect(screen.getByTestId(`binding-historical-${bindingId}`)).toHaveTextContent(
      '新版只补充了签署页',
    )
    expect(screen.getByTestId(`binding-historical-${bindingId}`)).toHaveTextContent(
      '仅用于本轮尺寸校核',
    )
    expect(screen.getByTestId(`binding-review-${bindingId}`)).toHaveTextContent(
      '使用历史来源（已说明）',
    )

    const stored = await getSourceBinding(bindingId)
    expect(stored.ok).toBe(true)
    if (stored.ok) {
      expect(stored.value?.historicalAcceptance).toMatchObject({
        reason: '新版只补充了签署页',
        scope: '仅用于本轮尺寸校核',
      })
    }
  })

  it('迁移到新版：只打开最新版本作为建议位置，要求重新框选', async () => {
    const { projectId, bindingId } = await setupNewVersion()
    const user = userEvent.setup()
    renderPanel(projectId)

    await waitFor(() => {
      expect(screen.getByTestId(`binding-migrate-${bindingId}`)).toBeInTheDocument()
    })
    await user.click(screen.getByTestId(`binding-migrate-${bindingId}`))
    expect(await screen.findByText(/已打开最新版本/)).toHaveTextContent(
      '旧坐标不会自动沿用',
    )
    // 迁移尚未保存：绑定仍指向旧版本，也没有产生历史接受。
    const stored = await getSourceBinding(bindingId)
    expect(stored.ok).toBe(true)
    if (stored.ok) {
      expect(stored.value?.historicalAcceptance).toBeNull()
    }
  })

  it('解除绑定：二次确认后绑定消失，旧版本与附件不删除', async () => {
    const { projectId, bindingId } = await setupNewVersion()
    const user = userEvent.setup()
    renderPanel(projectId)

    await waitFor(() => {
      expect(screen.getByTestId(`binding-remove-${bindingId}`)).toBeInTheDocument()
    })
    await user.click(screen.getByTestId(`binding-remove-${bindingId}`))
    expect(screen.getByTestId(`binding-remove-confirm-${bindingId}`)).toHaveTextContent(
      '旧版本与附件不会被删除',
    )
    await user.click(screen.getByTestId(`binding-remove-confirm-yes-${bindingId}`))

    await waitFor(async () => {
      const listed = await listSourceBindings(projectId)
      expect(listed.ok && listed.value.length).toBe(0)
    })
    expect(await screen.findByText(/已解除绑定/)).toBeInTheDocument()
  })

  it('审查侧栏定位：打开指定绑定的确切 revision 与页码，而不是默认最后一条', async () => {
    const projectId = await createTestProject()
    const v1 = await importRevision(projectId, bytesV1)
    const v2 = await importRevision(projectId, bytesV2, v1.documentId)
    const first = await createSourceBinding({
      projectId,
      termId: 't-h',
      revisionId: v1.id,
      page: 1,
      rectPdf: [10, 10, 100, 100],
      pageBoxPdf: [0, 0, 600, 800],
    })
    const second = await createSourceBinding({
      projectId,
      termId: 't-h',
      revisionId: v2.id,
      page: 2,
      rectPdf: [20, 20, 120, 120],
      pageBoxPdf: [0, 0, 600, 800],
    })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) {
      return
    }

    render(
      <SourcePanel
        projectId={projectId}
        terms={terms}
        selectedTermId="t-h"
        loadBytes={loadBytes}
        renderPage={renderPageForTest}
        locateRequest={{
          bindingId: first.value.id,
          revisionId: v1.id,
          page: 1,
          token: 1,
        }}
      />,
    )

    await waitFor(() => {
      const fileLine = document.querySelector('.pdf-viewer__file')
      expect(fileLine?.textContent).toContain(v1.sha256.slice(0, 12))
    })
    expect(screen.getByLabelText('页码跳转')).toHaveValue(1)
  })
})
