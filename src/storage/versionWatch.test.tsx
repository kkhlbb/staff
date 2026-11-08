// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseMm } from '../domain/units'
import { Workspace } from '../pages/Workspace'
import { DatabaseVersionGuard } from './DatabaseVersionGuard'
import { useDatabaseStaleVersion } from './databaseStale'
import {
  PROJECT_DB_VERSION,
  openDatabase,
  probeDatabaseVersion,
} from './db'
import { createProject } from './projects'
import { createRelationReview } from '../workspace/relation'
import { deleteProjectDatabase } from '../test/projectDb'

const chain = {
  terms: [
    {
      id: 't-h',
      symbol: 'H',
      name: '孔',
      nominalQ: parseMm('100'),
      lowerDeviationQ: parseMm('0'),
      upperDeviationQ: parseMm('0.1'),
      sign: 1 as const,
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
      sign: -1 as const,
      sourceNote: '',
      termRevision: 1,
    },
  ],
  target: { minQ: parseMm('0.05'), maxQ: parseMm('0.2') },
  assumptions: '',
}

function ProbeEditor() {
  const staleVersion = useDatabaseStaleVersion()
  return (
    <input
      aria-label="测试输入"
      defaultValue="草稿保留"
      disabled={staleVersion !== null}
    />
  )
}

async function seedProject(): Promise<string> {
  const created = await createProject({
    name: '跨版本守卫项目',
    working: chain,
    relationRevision: 1,
    relationReview: createRelationReview(
      chain,
      1,
      '2026-01-01T00:00:00.000Z',
    ),
  })
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  return created.value.id
}

/** 模拟另一个标签页把同一个库升级到更高版本。 */
async function upgradeDatabase(): Promise<void> {
  const db = await openDatabase({ version: PROJECT_DB_VERSION + 1 })
  db.close()
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

afterEach(async () => {
  await deleteProjectDatabase()
})

describe('跨版本守卫', () => {
  it('probeDatabaseVersion 读到实际版本，不触发升级', async () => {
    const current = await openDatabase()
    expect(current.version).toBe(PROJECT_DB_VERSION)
    current.close()

    await upgradeDatabase()
    await expect(probeDatabaseVersion()).resolves.toBe(
      PROJECT_DB_VERSION + 1,
    )
  })

  it('库版本高于预期且窗口重新获得焦点：出现常驻提示、编辑入口锁定、输入仍在内存', async () => {
    const projectId = await seedProject()
    render(
      <DatabaseVersionGuard
        expectedVersion={PROJECT_DB_VERSION}
        probe={async () => PROJECT_DB_VERSION + 1}
      >
        <Workspace projectId={projectId} />
      </DatabaseVersionGuard>,
    )

    const nominalInput = await screen.findByLabelText('H 基本尺寸')
    expect(nominalInput).toBeEnabled()
    const valueBeforeStale = (nominalInput as HTMLInputElement).value
    expect(screen.queryByTestId('database-stale-banner')).toBeNull()

    fireEvent.focus(window)

    const banner = await screen.findByTestId('database-stale-banner')
    expect(banner).toHaveTextContent(
      '数据库已升级到新版本，请刷新页面后再继续操作',
    )
    expect(banner).toHaveAttribute(
      'data-actual-version',
      String(PROJECT_DB_VERSION + 1),
    )

    // 只锁编辑入口，不卸载页面：输入值仍在，但不可再改。
    const lockedInput = screen.getByLabelText('H 基本尺寸')
    expect(lockedInput).toBeDisabled()
    expect((lockedInput as HTMLInputElement).value).toBe(valueBeforeStale)
    expect(screen.getByRole('button', { name: '增加行' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: '从表格追加/替换' }),
    ).toBeDisabled()

    // 只读入口仍可用，便于用户在刷新前导出/查看。
    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeEnabled()
  })

  it('真实数据库被升级到更高版本后，界面进入过期状态', async () => {
    const projectId = await seedProject()
    render(
      <DatabaseVersionGuard expectedVersion={PROJECT_DB_VERSION}>
        <Workspace projectId={projectId} />
      </DatabaseVersionGuard>,
    )
    await screen.findByLabelText('H 基本尺寸')

    await upgradeDatabase()

    const banner = await screen.findByTestId('database-stale-banner')
    expect(banner).toHaveAttribute(
      'data-actual-version',
      String(PROJECT_DB_VERSION + 1),
    )
    expect(screen.getByLabelText('H 基本尺寸')).toBeDisabled()
  })

  it('标签页重新可见时也会探测，不依赖 window focus', async () => {
    let probeCalls = 0
    render(
      <DatabaseVersionGuard
        expectedVersion={PROJECT_DB_VERSION}
        probe={async () => {
          probeCalls += 1
          return PROJECT_DB_VERSION + 1
        }}
      >
        <ProbeEditor />
      </DatabaseVersionGuard>,
    )

    expect(probeCalls).toBe(0)
    fireEvent(document, new Event('visibilitychange'))

    await waitFor(() => expect(probeCalls).toBe(1))
    expect(await screen.findByTestId('database-stale-banner')).toBeInTheDocument()
  })

  it('刷新后加载期望新版本的程序：提示消失，编辑恢复', async () => {
    await upgradeDatabase()
    let probeCalls = 0
    const probe = async (): Promise<number | null> => {
      probeCalls += 1
      return probeDatabaseVersion()
    }

    // 刷新后运行的是新代码：expectedVersion 与库一致（这里用 v7 模拟部署）。
    render(
      <DatabaseVersionGuard
        expectedVersion={PROJECT_DB_VERSION + 1}
        probe={probe}
      >
        <ProbeEditor />
      </DatabaseVersionGuard>,
    )

    fireEvent.focus(window)
    await waitFor(() => expect(probeCalls).toBe(1))

    expect(screen.queryByTestId('database-stale-banner')).toBeNull()
    expect(screen.getByLabelText('测试输入')).toBeEnabled()
    expect(screen.getByLabelText('测试输入')).toHaveValue('草稿保留')
  })

  it('探测失败（返回 null）不误报过期', async () => {
    render(
      <DatabaseVersionGuard
        expectedVersion={PROJECT_DB_VERSION}
        probe={async () => null}
      >
        <ProbeEditor />
      </DatabaseVersionGuard>,
    )

    fireEvent.focus(window)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(screen.queryByTestId('database-stale-banner')).toBeNull()
    expect(screen.getByLabelText('测试输入')).toBeEnabled()
  })
})
