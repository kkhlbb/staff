// @vitest-environment node
/**
 * A-04d：最近项目 Rev 与会话重新挂接（session:reattach）的通道级验收。
 *
 * 用真实临时目录、真实 ProjectService/RecoveryStore/FileStore 与假 IPC；
 * 不启动 Electron，也不改界面。重点断言：
 * - recent:list 的 rev 来自磁盘当前正式文件，路径失效为 null 且 missing 保留；
 * - reattach 命中返回 main 已接受序号与草稿状态，未命中只返回 {session:null}；
 * - reattach 不新建会话、不放宽 dirty gate，越权 sender 被拒绝。
 */
import { promises as fsp } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createHarness,
  makeEvent,
  stageRename,
  type Harness,
  type HarnessOptions,
} from './helpers/a04'
import { IPC_CHANNELS } from '../shared/contracts'
import type {
  ProjectOpenValue,
  ProjectSaveValue,
  RecentProjectListValue,
  SessionReattachValue,
} from '../shared/contracts'
import { SAMPLE_PROJECT_ID } from '../../src/project-file/__fixtures__/sampleProjectFile'

let active: Harness[] = []

afterEach(async () => {
  for (const harness of active) {
    await harness.dispose()
  }
  active = []
})

async function makeHarness(options: HarnessOptions = {}): Promise<Harness> {
  const harness = await createHarness(options)
  active.push(harness)
  return harness
}

function hasActiveSession(value: SessionReattachValue): value is { session: null } {
  return 'session' in value && value.session === null
}

describe('recent:list 返回当前正式版本号', () => {
  it('有效项目的 rev 取自 currentRevisionId 对应的 ProjectRevision', async () => {
    const harness = await makeHarness()
    const opened = await harness.openSample()

    const listed = await harness.invoke<RecentProjectListValue>(IPC_CHANNELS.recentList, {})
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    const item = listed.value.items.find((entry) => entry.path === opened.path)
    expect(item).toBeDefined()
    expect(item?.missing).toBe(false)
    expect(item?.rev).toBe('rev-a1')
  })

  it('路径失效时 rev 为 null 且 missing 仍为 true', async () => {
    const harness = await makeHarness()
    const opened = await harness.openSample()
    if (opened.path === null) throw new Error('openSample 应返回路径')
    await fsp.unlink(opened.path)

    const listed = await harness.invoke<RecentProjectListValue>(IPC_CHANNELS.recentList, {})
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    const item = listed.value.items.find((entry) => entry.path === opened.path)
    expect(item?.missing).toBe(true)
    expect(item?.rev).toBeNull()
  })

  it('文件存在但不是合法项目时 rev 为 null，列表不整体失败', async () => {
    const harness = await makeHarness()
    const brokenPath = harness.samplePath('broken')
    await fsp.writeFile(brokenPath, 'not a project')
    const recorded = await harness.recent.record({
      projectId: SAMPLE_PROJECT_ID,
      name: '坏文件',
      path: brokenPath,
      fingerprint: 'a'.repeat(64),
    })
    expect(recorded.ok).toBe(true)

    const listed = await harness.invoke<RecentProjectListValue>(IPC_CHANNELS.recentList, {})
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    const item = listed.value.items.find((entry) => entry.path === brokenPath)
    expect(item?.missing).toBe(false)
    expect(item?.rev).toBeNull()
  })

  it('relink 返回值同样带 rev', async () => {
    const harness = await makeHarness()
    const opened = await harness.openSample(undefined, 'first')
    if (opened.path === null) throw new Error('openSample 应返回路径')
    const movedPath = await harness.writeSample(await harness.newSnapshot(), 'moved')
    await fsp.unlink(opened.path)
    harness.relinkQueue.push(movedPath)

    const listed = await harness.invoke<RecentProjectListValue>(IPC_CHANNELS.recentList, {})
    if (!listed.ok) throw new Error('list failed')
    const item = listed.value.items.find((entry) => entry.path === opened.path)
    if (item === undefined) throw new Error('recent item missing')

    const relinked = await harness.invoke<{ item: { path: string; missing: boolean; rev: string | null } }>(
      IPC_CHANNELS.recentRelink,
      { recentId: item.recentId },
    )
    expect(relinked.ok).toBe(true)
    if (!relinked.ok) return
    expect(relinked.value.item.path).toBe(movedPath)
    expect(relinked.value.item.missing).toBe(false)
    expect(relinked.value.item.rev).toBe('rev-a1')
  })
})

describe('session:reattach', () => {
  it('main 没有活动会话时返回 {session:null}，且不新建会话', async () => {
    const harness = await makeHarness()
    const result = await harness.invoke<SessionReattachValue>(IPC_CHANNELS.sessionReattach, {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(hasActiveSession(result.value)).toBe(true)
    expect(harness.createdSessionIds).toHaveLength(0)
    expect(harness.controller.sessionFor(1)).toBeNull()
    expect(harness.recovery.activeSessionCount()).toBe(0)
  })

  it('命中时返回 main 已接受序号、快照、路径与指纹', async () => {
    const harness = await makeHarness()
    const opened = await harness.openSample()

    const first = await harness.invoke<SessionReattachValue>(IPC_CHANNELS.sessionReattach, {})
    expect(first.ok).toBe(true)
    if (!first.ok || hasActiveSession(first.value)) return
    expect(first.value.sessionId).toBe(opened.sessionId)
    expect(first.value.editSeq).toBe(0)
    expect(first.value.snapshot).toEqual(opened.snapshot)
    expect(first.value.path).toBe(opened.path)
    expect(first.value.fingerprint).toBe(opened.fingerprint)
    expect(first.value.recovery).toBe('none')

    // 重复挂接必须返回同一会话，不能悄悄再建一个。
    const second = await harness.invoke<SessionReattachValue>(IPC_CHANNELS.sessionReattach, {})
    expect(second.ok).toBe(true)
    if (!second.ok || hasActiveSession(second.value)) return
    expect(second.value.sessionId).toBe(opened.sessionId)
    expect(harness.createdSessionIds).toHaveLength(1)
  })

  it('脏编辑后 editSeq 与 recovery 反映 main 状态，且 dirty gate 没有被放宽', async () => {
    const harness = await makeHarness({ debounceMs: 60_000, choices: ['cancel'] })
    const opened = await harness.openSample()
    const staged = await stageRename(harness, opened, 1, '重命名后未保存')
    expect(staged.ok).toBe(true)

    const reattached = await harness.invoke<SessionReattachValue>(IPC_CHANNELS.sessionReattach, {})
    expect(reattached.ok).toBe(true)
    if (!reattached.ok || hasActiveSession(reattached.value)) return
    expect(reattached.value.editSeq).toBe(1)
    expect(reattached.value.snapshot.project.name).toBe('重命名后未保存')
    // 防抖窗口内：内存已接受、草稿尚未落盘。
    expect(reattached.value.recovery).toBe('pending')

    const session = harness.controller.sessionFor(1)
    if (session === null) throw new Error('session missing')
    expect(session.acceptedSeq).toBe(1)
    expect(session.savedSeq).toBe(0)
    expect(harness.controller.isDirty(session)).toBe(true)

    // 再次打开别的项目仍必须先过三选；取消后会话保持不变。
    const another = await harness.writeSample(await harness.newSnapshot(), 'another')
    harness.openQueue.push(another)
    const blocked = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.projectOpen, {})
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.error.code).toBe('CANCELLED')
    }
    expect(harness.prompts).toHaveLength(1)
    expect(harness.controller.sessionIdFor(1)).toBe(opened.sessionId)
  })

  it('保存成功后重新挂接看到相同 editSeq，且 dirty 已清除', async () => {
    const harness = await makeHarness()
    const opened = await harness.openSample()
    const staged = await stageRename(harness, opened, 1, '保存后')
    expect(staged.ok).toBe(true)

    const saved = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSave, {
      sessionId: opened.sessionId,
      editSeq: 1,
      expectedFingerprint: opened.fingerprint,
    })
    expect(saved.ok).toBe(true)

    const reattached = await harness.invoke<SessionReattachValue>(IPC_CHANNELS.sessionReattach, {})
    expect(reattached.ok).toBe(true)
    if (!reattached.ok || hasActiveSession(reattached.value)) return
    expect(reattached.value.sessionId).toBe(opened.sessionId)
    expect(reattached.value.editSeq).toBe(1)
    expect(reattached.value.recovery).toBe('none')
    const session = harness.controller.sessionFor(1)
    if (session === null) throw new Error('session missing')
    expect(session.savedSeq).toBe(1)
    expect(harness.controller.isDirty(session)).toBe(false)
  })

  it('拒绝未登记窗口与子框架调用，不泄露会话', async () => {
    const harness = await makeHarness()
    await harness.openSample()

    const foreign = await harness.ipc.invoke(
      IPC_CHANNELS.sessionReattach,
      {},
      makeEvent({ webContentsId: 99 }),
    )
    expect(foreign.ok).toBe(false)
    if (!foreign.ok) {
      expect(foreign.error.code).toBe('FORBIDDEN_SENDER')
    }

    const subFrame = await harness.ipc.invoke(
      IPC_CHANNELS.sessionReattach,
      {},
      makeEvent({ webContentsId: 1, subFrame: true }),
    )
    expect(subFrame.ok).toBe(false)
    if (!subFrame.ok) {
      expect(subFrame.error.code).toBe('FORBIDDEN_SENDER')
    }
    expect(harness.createdSessionIds).toHaveLength(1)
  })
})
