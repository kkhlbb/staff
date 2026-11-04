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
    relationConfirmed: true,
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
  return expectOk(await createProject({ name, working: chainA() }))
}

async function seedCaseB(name = '案例 B'): Promise<Project> {
  return expectOk(await createProject({ name, working: chainB() }))
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

function statusBadge(project: Project): HTMLElement {
  return screen.getByTestId(`project-status-${project.id}`)
}

/** 等待自动保存从“保存中”落到“已保存”，确保返回列表前草稿已写入 IndexedDB。 */
async function waitForAutoSave(): Promise<void> {
  await screen.findByText('保存中')
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
    expect(copy.working).toEqual(chainA())
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

    const unknownVersion = mutateJson(exportProjectJson(existing), (raw) => {
      raw.schemaVersion = 2
    })
    await uploadJson(jsonFile(unknownVersion, 'unknown-version.json'))
    expect(await screen.findByText('未知版本：2')).toBeInTheDocument()

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
    await waitForAutoSave()

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

      expect(download.blobs).toHaveLength(1)
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
      expect(imported.working).toEqual(original.working)
      expect(calculateChain(imported.working)).toEqual(
        calculateChain(original.working),
      )
      expect(expectOk(await getProject(original.id))).toEqual(original)
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
