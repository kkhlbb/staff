// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateChain } from '../domain/calculate'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import {
  createProject,
  getDraft,
  getProject,
  listDrafts,
  listProjects,
} from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import type { CommitImportSuccess } from '../import/commit'
import { chainToDraft } from '../workspace/draft'
import { ImportWizard } from './ImportWizard'

beforeEach(async () => {
  await deleteProjectDatabase()
})

const CAL_TSV = [
  '代号\t名称\t基本尺寸\t下偏差\t上偏差\t方向',
  'H\t机架\t100.0000\t0.0000\t0.1000\t+1',
  'B1\t轴承 1\t20.0000\t-0.0200\t0.0000\t-1',
  'S\t隔套\t59.8000\t-0.0500\t0.0500\t-1',
  'B2\t轴承 2\t20.0000\t-0.0200\t0.0000\t-1',
].join('\n')

function chainA(): ChainDefinition {
  return {
    terms: [
      {
        id: 'a-h',
        symbol: 'H',
        name: '机架',
        nominalQ: parseMm('100'),
        lowerDeviationQ: parseMm('0'),
        upperDeviationQ: parseMm('0.1'),
        sign: 1,
        sourceNote: '',
        termRevision: 1,
      },
      {
        id: 'a-b1',
        symbol: 'B1',
        name: '轴承',
        nominalQ: parseMm('20'),
        lowerDeviationQ: parseMm('-0.02'),
        upperDeviationQ: parseMm('0'),
        sign: -1,
        sourceNote: '',
        termRevision: 1,
      },
      {
        id: 'a-s',
        symbol: 'S',
        name: '隔套',
        nominalQ: parseMm('59.8'),
        lowerDeviationQ: parseMm('-0.05'),
        upperDeviationQ: parseMm('0.05'),
        sign: -1,
        sourceNote: '',
        termRevision: 1,
      },
      {
        id: 'a-b2',
        symbol: 'B2',
        name: '轴承 2',
        nominalQ: parseMm('20'),
        lowerDeviationQ: parseMm('-0.02'),
        upperDeviationQ: parseMm('0'),
        sign: -1,
        sourceNote: '',
        termRevision: 1,
      },
    ],
    target: { minQ: parseMm('0.1'), maxQ: parseMm('0.3') },
    assumptions: '',
  }
}

async function seedProject() {
  const created = await createProject({ name: '已有项目', working: chainA() })
  expect(created.ok).toBe(true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  return created.value
}

async function advanceToPreview(text: string): Promise<void> {
  const user = userEvent.setup()
  fireEvent.change(screen.getByLabelText('表格文本'), {
    target: { value: text },
  })
  await user.click(screen.getByRole('button', { name: '下一步' }))
  await screen.findByText('2. 是否有表头')
  await user.click(screen.getByRole('button', { name: '下一步' }))
  await screen.findByText('3. 映射列')
  await user.click(screen.getByRole('button', { name: '下一步' }))
  await screen.findByText('4. 单位与含义确认')
  await user.click(screen.getByRole('button', { name: '下一步' }))
  await screen.findByText('5. 预览校验')
}

describe('ImportWizard：IMP-01 主路径', () => {
  it('粘贴 CAL-01 四行 TSV，新建并确认后 Cmin/Cmax 与手输一致', async () => {
    const user = userEvent.setup()
    const onImported = vi.fn<(result: CommitImportSuccess) => void>()
    const onClose = vi.fn()
    render(<ImportWizard onClose={onClose} onImported={onImported} />)

    await advanceToPreview(CAL_TSV)

    expect(screen.getByText(/有效 4 行/)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '导入并新建项目' })
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1)
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    const imported = onImported.mock.calls[0][0]
    expect(imported.chain.terms).toHaveLength(4)
    expect(imported.chain.terms.every((term) => term.termRevision === 1)).toBe(true)
    const result = calculateChain(imported.chain)
    expect(result.minQ).toBe(1500)
    expect(result.maxQ).toBe(3900)
    expect(result.nominalQ).toBe(2000)

    const projects = await listProjects()
    expect(projects.ok).toBe(true)
    if (projects.ok) {
      expect(projects.value).toHaveLength(1)
      expect(projects.value[0].working).toEqual(imported.chain)
    }
  })
})

describe('ImportWizard：IMP-03 错误阻止提交', () => {
  it('缺方向、重复代号、非法偏差、超过 4 位小数定位到单元格且不能提交', async () => {
    render(
      <ImportWizard
        onClose={() => undefined}
        onImported={() => undefined}
      />,
    )

    await advanceToPreview(
      [
        '代号\t基本尺寸\t下偏差\t上偏差\t方向',
        'H\t100.0000\t0.0000\t0.1000\t+1',
        'H\t20.0000\t0.0000\t0.0000\t-1',
        'B1\t20.0000\tabc\t0.0000\t-1',
        'B2\t20.0000\t0.0000\t0.12345\t-1',
        'S\t59.8000\t-0.0500\t0.0500\t',
      ].join('\n'),
    )

    expect(await screen.findByTestId('import-error-3-symbol')).toHaveTextContent(
      '与第 2 行重复',
    )
    expect(await screen.findByTestId('import-error-4-lower')).toHaveTextContent(
      '格式不正确',
    )
    expect(await screen.findByTestId('import-error-5-upper')).toHaveTextContent(
      '最多 4 位小数',
    )
    expect(await screen.findByTestId('import-error-6-sign')).toHaveTextContent(
      '方向不能为空',
    )

    expect(
      screen.getByRole('button', { name: '导入并新建项目' }),
    ).toBeDisabled()
  })
})

describe('ImportWizard：IMP-04 追加冲突', () => {
  it('追加代号与现有组成环冲突时阻止提交，原项目不变', async () => {
    const project = await seedProject()
    const before = await getProject(project.id)

    render(
      <ImportWizard
        project={project}
        baseDraft={chainToDraft(project.working)}
        onClose={() => undefined}
        onImported={() => undefined}
      />,
    )

    await advanceToPreview(
      [
        '代号\t基本尺寸\t下偏差\t上偏差\t方向',
        'H\t100.0000\t0.0000\t0.1000\t+1',
        'X\t10.0000\t0.0000\t0.1000\t+1',
      ].join('\n'),
    )

    expect(await screen.findByTestId('import-error-2-symbol')).toHaveTextContent(
      '重复',
    )
    expect(
      screen.getByRole('button', { name: '追加 2 个组成环' }),
    ).toBeDisabled()
    expect(await getProject(project.id)).toEqual(before)
  })
})

describe('ImportWizard：名称列为空与修正', () => {
  it('名称列为空时显示单元格错误；补名称后恢复可提交', async () => {
    const user = userEvent.setup()
    render(
      <ImportWizard onClose={() => undefined} onImported={() => undefined} />,
    )

    await advanceToPreview(
      [
        '代号\t名称\t基本尺寸\t下偏差\t上偏差\t方向',
        'H\t\t100.0000\t0.0000\t0.1000\t+1',
        'B1\t轴承\t20.0000\t-0.0200\t0.0000\t-1',
      ].join('\n'),
    )

    expect(await screen.findByTestId('import-error-2-name')).toHaveTextContent(
      '名称不能为空',
    )
    const submit = screen.getByRole('button', { name: '导入并新建项目' })
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText('第 2 行 名称'), '机架')

    await waitFor(() => {
      expect(screen.queryByTestId('import-error-2-name')).not.toBeInTheDocument()
    })
    expect(submit).toBeEnabled()
  })
})

describe('ImportWizard：方向确认与单行追加', () => {
  it('把原文「1」确认成 -1 后，预览与提交都按 -1', async () => {
    const user = userEvent.setup()
    const onImported = vi.fn<(result: CommitImportSuccess) => void>()
    render(
      <ImportWizard onClose={() => undefined} onImported={onImported} />,
    )

    fireEvent.change(screen.getByLabelText('表格文本'), {
      target: {
        value: [
          '代号\t基本尺寸\t下偏差\t上偏差\t方向',
          'A\t20.0000\t0.0000\t0.1000\t1',
          'B\t10.0000\t0.0000\t0.1000\t-1',
        ].join('\n'),
      },
    })
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('2. 是否有表头')
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('3. 映射列')
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('4. 单位与含义确认')

    await user.selectOptions(screen.getByLabelText('方向值「1」的含义'), '-1')
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('5. 预览校验')

    expect(screen.getByLabelText('第 2 行 方向')).toHaveValue('-1')
    expect(screen.getByLabelText('第 3 行 方向')).toHaveValue('-1')

    await user.click(screen.getByRole('button', { name: '导入并新建项目' }))
    await waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1)
    })
    const imported = onImported.mock.calls[0][0]
    expect(imported.chain.terms.map((item) => item.sign)).toEqual([-1, -1])
  })

  it('单行表格可以追加到已有合法链（UI 可达）', async () => {
    const project = await seedProject()
    const user = userEvent.setup()
    const onImported = vi.fn<(result: CommitImportSuccess) => void>()
    render(
      <ImportWizard
        project={project}
        baseDraft={chainToDraft(project.working)}
        onClose={() => undefined}
        onImported={onImported}
      />,
    )

    await advanceToPreview(
      [
        '代号\t基本尺寸\t下偏差\t上偏差\t方向',
        'X2\t10.0000\t0.0000\t0.1000\t+1',
      ].join('\n'),
    )

    const submit = screen.getByRole('button', { name: '追加 1 个组成环' })
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1)
    })
    const imported = onImported.mock.calls[0][0]
    expect(imported.chain.terms).toHaveLength(5)
    expect(imported.chain.terms[4].symbol).toBe('X2')
  })

  it('预览中取消导入不写入 project 或 draft', async () => {
    const project = await seedProject()
    const onClose = vi.fn()
    render(
      <ImportWizard
        project={project}
        baseDraft={chainToDraft(project.working)}
        onClose={onClose}
        onImported={() => undefined}
      />,
    )

    await advanceToPreview(
      [
        '代号\t基本尺寸\t下偏差\t上偏差\t方向',
        'X2\t10.0000\t0.0000\t0.1000\t+1',
      ].join('\n'),
    )

    const before = await getProject(project.id)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(await getProject(project.id)).toEqual(before)
    expect(await getDraft(project.id)).toEqual({ ok: true, value: null })
    const drafts = await listDrafts()
    expect(drafts.ok && drafts.value).toEqual([])
  })
})
