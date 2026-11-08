// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateChain } from '../domain/calculate'
import type { ChainDefinition, DimensionTerm, Project } from '../domain/types'
import { parseMm } from '../domain/units'
import { createRelationReview } from '../workspace/relation'
import {
  DEMO_DISCLAIMER,
  createDemoChain,
  demoCaseName,
  type DemoCaseId,
} from '../fixtures/demo'
import {
  MAX_IMPORT_BYTES,
  createEmptyProject,
  createProject,
  exportProjectJson,
  getProject,
  listProjects,
  updateProject,
  type StorageResult,
} from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import App from '../App'
import { Workspace } from './Workspace'
import { ProjectList } from './ProjectList'

beforeEach(async () => {
  await deleteProjectDatabase()
})

afterEach(async () => {
  vi.restoreAllMocks()
  window.location.hash = ''
  await deleteProjectDatabase()
})

function expectOk<T>(result: StorageResult<T>): T {
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`)
  }
  return result.value
}

function term(
  id: string,
  symbol: string,
  name: string,
  nominal: string,
  lower: string,
  upper: string,
  sign: 1 | -1,
): DimensionTerm {
  return {
    id,
    symbol,
    name,
    nominalQ: parseMm(nominal),
    lowerDeviationQ: parseMm(lower),
    upperDeviationQ: parseMm(upper),
    sign,
    sourceNote: '',
    termRevision: 1,
  }
}

/** 文档案例 A。 */
function chainA(): ChainDefinition {
  return {
    terms: [
      term('a-h', 'H', '机架', '100.0000', '0.0000', '0.1000', 1),
      term('a-b1', 'B1', '轴承 1', '20.0000', '-0.0200', '0.0000', -1),
      term('a-s', 'S', '隔套', '59.8000', '-0.0500', '0.0500', -1),
      term('a-b2', 'B2', '轴承 2', '20.0000', '-0.0200', '0.0000', -1),
    ],
    target: { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') },
    assumptions: '',
  }
}

/** 文档案例 B。 */
function chainB(): ChainDefinition {
  const chain = chainA()
  chain.terms = chain.terms.map((item) => {
    if (item.symbol === 'H') {
      return { ...item, upperDeviationQ: parseMm('0.0300') }
    }
    if (item.symbol === 'S') {
      return {
        ...item,
        lowerDeviationQ: parseMm('-0.0200'),
        upperDeviationQ: parseMm('0.0200'),
      }
    }
    return item
  })
  return chain
}

async function seedCaseA(name = '案例 A'): Promise<Project> {
  const working = chainA()
  return expectOk(
    await createProject({
      name,
      working,
      relationRevision: 1,
      relationReview: createRelationReview(working, 1, '2026-01-01T00:00:00.000Z'),
    }),
  )
}

async function seedCaseB(name = '案例 B'): Promise<Project> {
  const working = chainB()
  return expectOk(
    await createProject({
      name,
      working,
      relationRevision: 1,
      relationReview: createRelationReview(working, 1, '2026-01-01T00:00:00.000Z'),
    }),
  )
}

function openWorkspace(project: Project): void {
  window.location.hash = workspaceHashForTest(project.id)
}

function workspaceHashForTest(projectId: string): string {
  return `#/projects/${encodeURIComponent(projectId)}`
}

function resultStatus(): string {
  const cell = screen.getByTestId('result-status').querySelector('dd')
  if (cell === null) {
    throw new Error('结果状态行缺少 dd')
  }
  return cell.textContent ?? ''
}

function resultValue(testId: string): string {
  const cell = screen.getByTestId(testId).querySelector('dd')
  if (cell === null) {
    throw new Error(`结果行 ${testId} 缺少 dd`)
  }
  return cell.textContent ?? ''
}

function statusBadge(project: Project): HTMLElement {
  return screen.getByTestId(`project-status-${project.id}`)
}

/** 等待自动保存从“保存中”落到“已保存”，确保返回列表前草稿已写入 IndexedDB。 */
async function waitForAutoSave(): Promise<void> {
  await screen.findByText('保存中')
  await screen.findByText('已保存', undefined, { timeout: 3000 })
}

/** 关系确认只写凭据、不改草稿，持久化可能瞬时完成；只等待落定。 */
async function waitForSaveSettled(): Promise<void> {
  await screen.findByText('已保存', undefined, { timeout: 3000 })
}

function projectRows(): HTMLElement[] {
  const list = screen.queryByRole('list', { name: '项目列表' })
  return list === null ? [] : within(list).getAllByRole('listitem')
}

function rowFor(project: Project): HTMLElement {
  return screen.getByTestId(`project-${project.id}`)
}

async function uploadJson(file: File): Promise<void> {
  fireEvent.change(screen.getByLabelText('导入 JSON 文件'), {
    target: { files: [file] },
  })
}

function jsonFile(json: string, name = 'project.json'): File {
  return new File([json], name, { type: 'application/json' })
}

function mutateJson(
  json: string,
  mutate: (raw: Record<string, unknown>) => void,
): string {
  const raw = JSON.parse(json) as Record<string, unknown>
  mutate(raw)
  return JSON.stringify(raw)
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('读取导出的 Blob 失败'))
    }
    reader.readAsText(blob)
  })
}

interface DownloadMock {
  blobs: Blob[]
  restore: () => void
}

function installDownloadMock(): DownloadMock {
  const blobs: Blob[] = []
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn((value: Blob | MediaSource) => {
      blobs.push(value as Blob)
      return 'blob:project-export'
    }),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => undefined)

  return {
    blobs,
    restore: () => {
      clickSpy.mockRestore()
      if (typeof originalCreateObjectURL === 'function') {
        Object.defineProperty(URL, 'createObjectURL', {
          configurable: true,
          writable: true,
          value: originalCreateObjectURL,
        })
      } else {
        Reflect.deleteProperty(URL, 'createObjectURL')
      }
      if (typeof originalRevokeObjectURL === 'function') {
        Object.defineProperty(URL, 'revokeObjectURL', {
          configurable: true,
          writable: true,
          value: originalRevokeObjectURL,
        })
      } else {
        Reflect.deleteProperty(URL, 'revokeObjectURL')
      }
    },
  }
}

describe('ProjectList：项目列表操作', () => {
  it('新建两个项目后列表显示两条，并显示由领域计算结果得出的状态', async () => {
    const user = userEvent.setup()
    const opened: string[] = []
    render(<ProjectList onOpenProject={(id) => opened.push(id)} />)

    await screen.findByText(/还没有项目/)
    await user.click(screen.getByRole('button', { name: '新建' }))
    await waitFor(() => {
      expect(projectRows()).toHaveLength(1)
    })

    await user.click(screen.getByRole('button', { name: '新建' }))
    await waitFor(() => {
      expect(projectRows()).toHaveLength(2)
    })

    expect(opened).toHaveLength(2)
    expect(new Set(opened).size).toBe(2)
    expect(screen.getAllByText('未完成')).toHaveLength(2)
  })

  it('列表显示案例 A 的计算状态，复制后改副本不影响原项目', async () => {
    const user = userEvent.setup()
    const original = await seedCaseA()
    render(<ProjectList onOpenProject={() => undefined} />)

    await waitFor(() => {
      expect(projectRows()).toHaveLength(1)
    })
    expect(
      within(rowFor(original)).getByTestId(`project-status-${original.id}`),
    ).toHaveTextContent('不满足')

    await user.click(within(rowFor(original)).getByRole('button', { name: '复制' }))
    await waitFor(() => {
      expect(projectRows()).toHaveLength(2)
    })

    const all = expectOk(await listProjects())
    expect(all).toHaveLength(2)
    const copy = all.find((project) => project.id !== original.id)
    expect(copy).toBeDefined()
    if (copy === undefined) {
      return
    }
    expect(copy.name).toBe('案例 A（副本）')
    // 复制通过导出/导入生成新项目，人工确认按导入规则清除。
    expect(copy.working).toEqual({ ...chainA() })
    expect(expectOk(await getProject(original.id))).toEqual(original)

    expectOk(await updateProject(copy.id, { working: chainB() }))
    expect(expectOk(await getProject(original.id))?.working).toEqual(chainA())
    expect(expectOk(await getProject(copy.id))?.working).toEqual(chainB())
  })

  it('删除先确认，取消不删除；确认后删除', async () => {
    const user = userEvent.setup()
    const project = await seedCaseA()
    render(<ProjectList onOpenProject={() => undefined} />)

    await waitFor(() => {
      expect(projectRows()).toHaveLength(1)
    })

    await user.click(within(rowFor(project)).getByRole('button', { name: '删除' }))
    const dialog = await screen.findByRole('alertdialog', { name: '删除项目？' })
    expect(dialog).toHaveTextContent('操作不能撤销')
    await user.click(within(dialog).getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTestId(`project-${project.id}`)).toBeInTheDocument()
    expect(expectOk(await getProject(project.id))).not.toBeNull()

    await user.click(within(rowFor(project)).getByRole('button', { name: '删除' }))
    const confirmDialog = await screen.findByRole('alertdialog', {
      name: '删除项目？',
    })
    await user.click(
      within(confirmDialog).getByRole('button', { name: '确认删除' }),
    )

    await waitFor(() => {
      expect(screen.queryByTestId(`project-${project.id}`)).toBeNull()
    })
    expect(screen.getByText(/还没有项目/)).toBeInTheDocument()
    expect(expectOk(await getProject(project.id))).toBeNull()
  })

  it('项目列表读取失败时说明存储不可用，点“重试”会重新打开数据库', async () => {
    const originalOpen = indexedDB.open.bind(indexedDB)
    let openCount = 0
    vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(
      (name, version) => {
        openCount += 1
        if (openCount === 1) {
          throw new Error('模拟 IndexedDB 打开失败')
        }
        return originalOpen(name, version)
      },
    )

    const user = userEvent.setup()
    render(<ProjectList onOpenProject={() => undefined} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('无法打开本地数据库')
    expect(alert).toHaveTextContent('接下来')

    await user.click(within(alert).getByRole('button', { name: '重试' }))

    expect(await screen.findByText(/还没有项目/)).toBeInTheDocument()
    expect(openCount).toBeGreaterThan(1)
  })

  it('坏 JSON、未知版本、超过 1 MB 分别逐条显示拒收原因，已有项目不变', async () => {
    const existing = await seedCaseA()
    const before = expectOk(await listProjects())
    render(<ProjectList onOpenProject={() => undefined} />)

    await waitFor(() => {
      expect(projectRows()).toHaveLength(1)
    })

    await uploadJson(jsonFile('{ not json', 'bad.json'))
    expect(await screen.findByText('JSON.parse 失败')).toBeInTheDocument()
    expect(screen.getByText(/项目 JSON 格式无效/)).toBeInTheDocument()
    expect(
      screen.getByText(/现有项目不会被覆盖或删除/),
    ).toBeInTheDocument()

    const unknownVersion = mutateJson(exportProjectJson(existing), (raw) => {
      raw.schemaVersion = 3
    })
    await uploadJson(jsonFile(unknownVersion, 'unknown-version.json'))
    expect(await screen.findByText('未知版本：3')).toBeInTheDocument()

    await uploadJson(
      jsonFile('x'.repeat(MAX_IMPORT_BYTES + 1), 'too-large.json'),
    )
    expect(
      await screen.findByText(new RegExp(`上限为 ${MAX_IMPORT_BYTES} 字节`)),
    ).toBeInTheDocument()

    expect(projectRows()).toHaveLength(1)
    expect(expectOk(await listProjects())).toEqual(before)
    expect(expectOk(await getProject(existing.id))).toEqual(existing)
  })
})

describe('ProjectList：状态与工作台一致', () => {
  it('改值清除确认后列表显示待确认，重新确认并保存后显示满足', async () => {
    const user = userEvent.setup()
    const project = await seedCaseB()
    openWorkspace(project)
    render(<App />)

    await screen.findByRole('button', { name: '增加行' })
    expect(resultStatus()).toBe('满足')

    // 与工作台同一路径：编辑数值会清除 relationConfirmed，但数值仍在目标区间内。
    fireEvent.change(screen.getByRole('textbox', { name: 'H 上偏差' }), {
      target: { value: '0.0200' },
    })
    expect(resultStatus()).toBe('待确认（预览）')
    await waitForAutoSave()

    await user.click(screen.getByRole('button', { name: '返回项目列表' }))
    await screen.findByRole('list', { name: '项目列表' })
    expect(statusBadge(project)).toHaveTextContent('待确认')
    expect(statusBadge(project)).not.toHaveTextContent('满足')

    await user.click(within(rowFor(project)).getByRole('button', { name: '打开' }))
    await screen.findByRole('button', { name: '增加行' })
    await user.click(
      screen.getByRole('checkbox', { name: '已核对尺寸关系与作用方向' }),
    )
    expect(resultStatus()).toBe('满足')
    await waitForSaveSettled()

    await user.click(screen.getByRole('button', { name: '返回项目列表' }))
    await screen.findByRole('list', { name: '项目列表' })
    expect(statusBadge(project)).toHaveTextContent('满足')
  })

  it('草稿无效时列表不使用已保存方案的满足结论', async () => {
    const user = userEvent.setup()
    const project = await seedCaseB()
    openWorkspace(project)
    render(<App />)

    await screen.findByRole('button', { name: '增加行' })
    expect(resultStatus()).toBe('满足')

    // 基本尺寸清空后草稿无效；已保存工作方案仍是满足的案例 B。
    fireEvent.change(screen.getByRole('textbox', { name: 'H 基本尺寸' }), {
      target: { value: '' },
    })
    expect(
      screen.getByText('输入有误，显示的是上次有效结果'),
    ).toBeInTheDocument()
    await waitForAutoSave()

    await user.click(screen.getByRole('button', { name: '返回项目列表' }))
    await screen.findByRole('list', { name: '项目列表' })

    expect(statusBadge(project)).not.toHaveTextContent('满足')
    expect(statusBadge(project)).toHaveTextContent('待确认')
  })
})

describe('ProjectList：JSON 导出再导入', () => {
  it('案例 A 从 Workspace 导出再导入得到新 ID 项目，原项目与重算结果不变', async () => {
    const original = await seedCaseA()
    const download = installDownloadMock()

    try {
      const workspace = render(
        <Workspace projectId={original.id} onBackToList={() => undefined} />,
      )
      await screen.findByRole('button', { name: '增加行' })
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: '导出 JSON' }))

      await waitFor(() => {
        expect(download.blobs).toHaveLength(1)
      })
      const exportedJson = await readBlobText(download.blobs[0])
      const exportedRaw = JSON.parse(exportedJson) as Record<string, unknown>
      expect(exportedRaw.id).toBe(original.id)

      workspace.unmount()
      render(<ProjectList onOpenProject={() => undefined} />)
      await waitFor(() => {
        expect(projectRows()).toHaveLength(1)
      })
      await uploadJson(jsonFile(exportedJson, 'case-a.json'))

      await waitFor(() => {
        expect(projectRows()).toHaveLength(2)
      })

      const all = expectOk(await listProjects())
      const imported = all.find((project) => project.id !== original.id)
      expect(imported).toBeDefined()
      if (imported === undefined) {
        return
      }
      // F-04：导入清除人工确认，但数值与重算结果保持一致。
      expect(imported.working).toEqual({
        ...original.working,
      })
      expect(imported.relationReview).toBeNull()
      expect(calculateChain(imported.working)).toEqual(
        calculateChain(original.working),
      )
      expect(expectOk(await getProject(original.id))).toEqual(original)
      // 列表徽标与工作台共用确认门槛：导入后显示待确认。
      expect(
        within(rowFor(imported)).getByTestId(`project-status-${imported.id}`),
      ).toHaveTextContent('待确认')

      // F-04/F-05：打开导入项目先显示待确认，重新勾选后才给出正式判定。
      const user = userEvent.setup()
      const importedWorkspace = render(
        <Workspace projectId={imported.id} onBackToList={() => undefined} />,
      )
      await screen.findByRole('button', { name: '增加行' })
      const importedCheckbox = screen.getByRole('checkbox', {
        name: '已核对尺寸关系与作用方向',
      })
      expect(importedCheckbox).not.toBeChecked()
      expect(resultStatus()).toBe('待确认（预览）')
      expect(resultValue('result-min')).toBe('0.1500')
      expect(resultValue('result-max')).toBe('0.3900')
      expect(resultValue('result-target')).toBe('0.1000 ~ 0.3000')

      await user.click(importedCheckbox)
      expect(importedCheckbox).toBeChecked()
      expect(resultStatus()).toBe('不满足')
      importedWorkspace.unmount()
    } finally {
      download.restore()
    }
  })

  it('空项目导出再导入成功，并可作为未完成项目打开', async () => {
    const empty = expectOk(await createEmptyProject('空项目'))
    const json = exportProjectJson(empty)

    render(<ProjectList onOpenProject={() => undefined} />)
    await waitFor(() => {
      expect(projectRows()).toHaveLength(1)
    })
    expect(
      within(rowFor(empty)).getByTestId(`project-status-${empty.id}`),
    ).toHaveTextContent('未完成')

    await uploadJson(jsonFile(json, 'empty.json'))
    await waitFor(() => {
      expect(projectRows()).toHaveLength(2)
    })

    const all = expectOk(await listProjects())
    const imported = all.find((project) => project.id !== empty.id)
    expect(imported).toBeDefined()
    if (imported === undefined) {
      return
    }
    expect(imported.working.terms).toEqual([])

    render(
      <Workspace projectId={imported.id} onBackToList={() => undefined} />,
    )
    await screen.findByRole('button', { name: '增加行' })
    expect(screen.getByText(/暂无组成环/)).toBeInTheDocument()
    expect(screen.getByText('请先添加组成环')).toBeInTheDocument()
  })
})

describe('ProjectList：内置演示案例', () => {
  it('依次打开 A/B/C 都经 storage 新建项目，已有项目不变，免责说明可见', async () => {
    const user = userEvent.setup()
    const original = await seedCaseA('原有项目')
    const opened: string[] = []
    render(<ProjectList onOpenProject={(id) => opened.push(id)} />)

    await waitFor(() => {
      expect(projectRows()).toHaveLength(1)
    })
    expect(screen.getByText(DEMO_DISCLAIMER)).toBeInTheDocument()

    const cases: DemoCaseId[] = ['A', 'B', 'C']
    for (const [index, caseId] of cases.entries()) {
      await user.selectOptions(screen.getByLabelText('演示案例'), caseId)
      await user.click(screen.getByRole('button', { name: '打开演示案例' }))

      await waitFor(() => {
        expect(opened).toHaveLength(index + 1)
      })
      await waitFor(() => {
        expect(projectRows()).toHaveLength(index + 2)
      })
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: '打开演示案例' }),
        ).toBeEnabled()
      })
      expect(screen.getByText(DEMO_DISCLAIMER)).toBeInTheDocument()
    }

    expect(new Set(opened).size).toBe(3)
    expect(opened).not.toContain(original.id)

    const all = expectOk(await listProjects())
    expect(all).toHaveLength(4)
    expect(new Set(all.map((project) => project.id)).size).toBe(4)
    expect(expectOk(await getProject(original.id))).toEqual(original)

    for (const [index, caseId] of cases.entries()) {
      const created = all.find((project) => project.id === opened[index])
      expect(created).toBeDefined()
      expect(created?.name).toBe(demoCaseName(caseId))
      expect(created?.working).toEqual(createDemoChain(caseId))
    }
  })

  it('打开演示案例后进入工作台，确认关系后才显示案例 A 的正式判定', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText(/还没有项目/)
    expect(screen.getByText(DEMO_DISCLAIMER)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '打开演示案例' }))

    await screen.findByRole('button', { name: '增加行' })
    expect(screen.getByText(/演示案例 A：不满足目标的轴向间隙/)).toBeInTheDocument()
    expect(resultStatus()).toBe('待确认（预览）')
    expect(screen.getByTestId('result-max')).toHaveTextContent('0.3900')

    await user.click(
      screen.getByRole('checkbox', { name: '已核对尺寸关系与作用方向' }),
    )
    expect(resultStatus()).toBe('不满足')
    await waitForSaveSettled()

    await user.click(screen.getByRole('button', { name: '返回项目列表' }))
    await screen.findByRole('list', { name: '项目列表' })
  })

  it('分别打开演示案例 A/B/C，均先显示待确认，勾选关系确认后才显示正式判定', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText(/还没有项目/)

    const cases: Array<{ id: DemoCaseId; name: RegExp; status: string }> = [
      { id: 'A', name: /演示案例 A：不满足目标的轴向间隙/, status: '不满足' },
      { id: 'B', name: /演示案例 B：修改后的满足方案/, status: '满足' },
      { id: 'C', name: /演示案例 C：负间隙和边界/, status: '满足' },
    ]

    for (const item of cases) {
      await user.selectOptions(screen.getByLabelText('演示案例'), item.id)
      await user.click(screen.getByRole('button', { name: '打开演示案例' }))

      await screen.findByRole('button', { name: '增加行' })
      expect(screen.getByText(item.name)).toBeInTheDocument()
      const confirmed = screen.getByRole('checkbox', {
        name: '已核对尺寸关系与作用方向',
      })
      expect(confirmed).not.toBeChecked()
      expect(resultStatus()).toBe('待确认（预览）')

      await user.click(confirmed)
      expect(confirmed).toBeChecked()
      expect(resultStatus()).toBe(item.status)
      await waitForSaveSettled()

      await user.click(screen.getByRole('button', { name: '返回项目列表' }))
      await screen.findByRole('list', { name: '项目列表' })
    }
  })
})

describe('ProjectList：迁移前预览、原始备份与恢复入口', () => {
  const legacy = {
    schemaVersion: 1,
    engineVersion: 'v1-engine',
    id: 'legacy-ui',
    name: '旧版界面项目',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    working: {
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
        },
      ],
      target: null,
      assumptions: '',
      relationConfirmed: true,
    },
    baseline: null,
  }

  async function seedLegacy(project: unknown): Promise<void> {
    const { openDatabase, transactionDone } = await import('../storage/db')
    const db = await openDatabase()
    try {
      const transaction = db.transaction(['projects', 'drafts'], 'readwrite')
      const done = transactionDone(transaction)
      transaction.objectStore('projects').put(project)
      transaction.objectStore('drafts').put({
        projectId: 'legacy-ui',
        savedAt: '2026-01-02T00:00:00.000Z',
        draft: {
          terms: [
            {
              id: 't-h',
              symbol: 'H',
              name: '孔',
              nominal: '',
              lower: '0.0000',
              upper: '0.1000',
              sign: 1,
              sourceNote: '',
            },
          ],
          targetMin: '',
          targetMax: 'bad',
          assumptions: '',
          relationConfirmed: true,
        },
      })
      await done
    } finally {
      db.close()
    }
  }

  it('先看到影响并拿到原始备份文件，再显式迁移；迁移后原项目变为 v2', async () => {
    await seedLegacy(legacy)
    const download = installDownloadMock()
    try {
      render(<ProjectList onOpenProject={() => undefined} />)

      const panel = await screen.findByTestId('legacy-migration-panel')
      expect(panel).toHaveTextContent('检测到 1 个旧版（V1）项目，尚未迁移')
      const row = within(panel).getByTestId('legacy-project-legacy-ui')
      expect(row).toHaveTextContent('旧版界面项目')
      expect(row).toHaveTextContent('2 个组成环')
      expect(row).toHaveTextContent('草稿（含无效输入，将保留）')
      expect(row).toHaveTextContent('旧人工确认将被清除')
      // 未迁移的 V1 记录不进入正常项目列表，避免按 v2 字段计算状态。
      expect(screen.queryByTestId('project-legacy-ui')).toBeNull()

      // 恢复步骤在界面上始终可找到。
      const help = screen.getByTestId('legacy-migration-help')
      expect(help).toHaveTextContent('迁移与恢复步骤')
      expect(help).toHaveTextContent('导入迁移前原始备份')

      fireEvent.click(
        within(panel).getByRole('button', {
          name: '导出迁移前原始备份（1 个项目）',
        }),
      )
      // 必须等提示真正出现，不能点完立即断言。
      const exportedNotice = await screen.findByText(/已导出迁移前原始备份：1 个项目、1 份草稿/)
      expect(exportedNotice).toBeInTheDocument()
      await waitFor(() => expect(download.blobs).toHaveLength(1))
      const backupText = await readBlobText(download.blobs[0])
      const backup = JSON.parse(backupText) as {
        format: string
        projects: { id: string; schemaVersion: number; working: { relationConfirmed: boolean } }[]
        drafts: { projectId: string; draft: { terms: { nominal: string }[] } }[]
      }
      expect(backup.format).toBe('cunlian-legacy-backup')
      expect(backup.projects).toHaveLength(1)
      expect(backup.projects[0].id).toBe('legacy-ui')
      expect(backup.projects[0].schemaVersion).toBe(1)
      expect(backup.projects[0].working.relationConfirmed).toBe(true)
      expect(backup.drafts[0].draft.terms[0].nominal).toBe('')

      // 迁移前仍是 V1（导出动作没有偷偷迁移）。这里直接读原始记录，
      // 不能用 getProject——它在读取时会自动迁移。
      const stillLegacy = await (async () => {
        const { openDatabase, requestResult, transactionDone } = await import(
          '../storage/db'
        )
        const db = await openDatabase()
        try {
          const transaction = db.transaction('projects', 'readonly')
          const done = transactionDone(transaction)
          const record = await requestResult(
            transaction.objectStore('projects').get('legacy-ui'),
          )
          await done
          return record as { schemaVersion: number }
        } finally {
          db.close()
        }
      })()
      expect(stillLegacy.schemaVersion).toBe(1)

      fireEvent.click(
        screen.getByRole('button', { name: '开始迁移（1 个项目）' }),
      )
      await screen.findByText(/已迁移 1 个旧版项目/)
      await waitFor(() =>
        expect(screen.queryByTestId('legacy-migration-panel')).toBeNull(),
      )
      const migrated = await getProject('legacy-ui')
      expect(migrated.ok && migrated.value?.schemaVersion).toBe(2)
      expect(migrated.ok && migrated.value?.relationReview).toBeNull()
      expect(screen.getByTestId('project-legacy-ui')).toBeInTheDocument()

      // 迁移后用同一份备份在界面上恢复：得到新项目，原项目仍在。
      fireEvent.change(screen.getByLabelText('迁移前原始备份文件'), {
        target: {
          files: [new File([backupText], '迁移前原始备份.json', { type: 'application/json' })],
        },
      })
      const restoredNotice = await screen.findByText(/已从迁移前备份恢复 1 个项目为新项目/)
      expect(restoredNotice).toBeInTheDocument()
      const afterRestore = expectOk(await listProjects())
      expect(afterRestore.map((project) => project.id)).toContain('legacy-ui')
      expect(afterRestore).toHaveLength(2)
    } finally {
      download.restore()
    }
  })

  it('存在会阻止迁移的记录时禁用“开始迁移”并说明整批回滚', async () => {
    await seedLegacy({
      ...legacy,
      id: 'legacy-broken-ui',
      name: '坏记录',
      working: {
        terms: [
          {
            id: 'bad',
            symbol: 'X',
            name: '非法',
            nominalQ: 0,
            lowerDeviationQ: 0,
            upperDeviationQ: 0,
            sign: 1,
            sourceNote: '',
          },
          {
            id: 'ok',
            symbol: 'Y',
            name: '合法',
            nominalQ: parseMm('10'),
            lowerDeviationQ: parseMm('0'),
            upperDeviationQ: parseMm('0.1'),
            sign: 1,
            sourceNote: '',
          },
        ],
        target: null,
        assumptions: '',
        relationConfirmed: false,
      },
    })

    render(<ProjectList onOpenProject={() => undefined} />)
    const panel = await screen.findByTestId('legacy-migration-panel')
    expect(within(panel).getByText(/无法迁移：/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /开始迁移/ }),
    ).toBeDisabled()
    expect(
      within(panel).getByText(/有 1 个项目会让整批迁移失败/),
    ).toBeInTheDocument()
  })
})
