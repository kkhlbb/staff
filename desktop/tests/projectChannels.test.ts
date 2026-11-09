// @vitest-environment node
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createHarness,
  dtoOf,
  failingWriteOps,
  renamed,
  stageRename,
  type Harness,
} from './helpers/a04'
import { IPC_CHANNELS } from '../shared/contracts'
import type {
  ProjectOpenValue,
  ProjectSaveValue,
  RecentProjectListValue,
  RecoveryListValue,
} from '../shared/contracts'
import { createNewProjectSnapshot } from '../main/newProject'
import { decodeProjectFile, encodeProjectFile } from '../../src/project-file/codec'
import { createSampleSnapshot, SAMPLE_PROJECT_ID } from '../../src/project-file/__fixtures__/sampleProjectFile'

let harness: Harness | undefined

afterEach(async () => {
  await harness?.dispose()
})

async function openOn(harness: Harness): Promise<ProjectOpenValue> {
  return harness.openSample()
}

describe('项目会话通道', () => {
  it('renderer 传 dirty:false 不能绕过 gate：strict schema 直接拒绝，序号不变', async () => {
    harness = await createHarness()
    const opened = await openOn(harness)
    const snapshot = dtoOf(renamed(await createSampleSnapshot(), '试图绕过'))
    const result = await harness.invoke(IPC_CHANNELS.projectStage, {
      sessionId: opened.sessionId,
      editSeq: 1,
      snapshot,
      dirty: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_REQUEST')
    }
    expect(harness.projectService.getSession(opened.sessionId)!.acceptedSeq).toBe(0)

    const saved = await harness.invoke(IPC_CHANNELS.projectSave, {
      sessionId: opened.sessionId,
      editSeq: 0,
      expectedFingerprint: opened.fingerprint,
      dirty: false,
    })
    expect(saved.ok).toBe(false)
    if (!saved.ok) {
      expect(saved.error.code).toBe('INVALID_REQUEST')
    }
  })

  it('新建 chain-demo：返回 editSeq 0，另存后重开得到 A-MAC-2 的整数链', async () => {
    harness = await createHarness()
    const created = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.projectNew, {
      name: '尺寸链示例（A）',
      template: 'chain-demo',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.editSeq).toBe(0)
    expect(created.value.path).toBeNull()

    const target = path.join(harness.directory, 'demo.cunlian')
    harness.saveTargetValue = target
    const saved = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSaveAs, {
      sessionId: created.value.sessionId,
      editSeq: 0,
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.value.path).toBe(target)

    const decoded = await decodeProjectFile(new Uint8Array(await fsp.readFile(target)))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const chain = decoded.value.snapshot.project.dimensionChain
    expect(chain.terms.map((term) => [term.symbol, term.nominalQ])).toEqual([
      ['H', 522000],
      ['B1', 200000],
      ['S', 120000],
      ['B2', 200000],
    ])
    expect(chain.target).toEqual({ minQ: 1000, maxQ: 3000 })
    expect(decoded.value.snapshot.project.name).toBe('尺寸链示例（A）')
  })

  it('stage → save 走同一会话；保存失败不改变路径/指纹/序号', async () => {
    harness = await createHarness({ fileOps: failingWriteOps('ENOSPC') })
    const opened = await openOn(harness)
    const staged = await stageRename(harness, opened, 1, '保存失败')
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    // 草稿写盘用真实 workspace I/O，仍应成功；保存失败只影响正式文件。
    expect(['pending', 'written', 'unchanged']).toContain(staged.value.recovery)

    const saved = await harness.invoke(IPC_CHANNELS.projectSave, {
      sessionId: opened.sessionId,
      editSeq: 1,
      expectedFingerprint: opened.fingerprint,
    })
    expect(saved.ok).toBe(false)
    if (!saved.ok) {
      expect(saved.error.code).toBe('NO_SPACE')
    }
    const session = harness.projectService.getSession(opened.sessionId)!
    expect(session.path).toBe(opened.path)
    expect(session.fingerprint).toBe(opened.fingerprint)
    expect(session.acceptedSeq).toBe(1)
    expect(session.savedSeq).toBe(0)
  })

  it('按 recentId 打开：只解析本机索引，不弹目录对话框', async () => {
    harness = await createHarness()
    const opened = await openOn(harness)
    const listed = await harness.invoke<RecentProjectListValue>(IPC_CHANNELS.recentList, {})
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.value.items).toHaveLength(1)
    const recentId = listed.value.items[0].recentId

    const reopened = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.projectOpen, { recentId })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.value.path).toBe(opened.path)
    expect(harness.openPathCalls).toBe(1) // 只有首次 openSample 用了对话框
  })

  it('relink 项目 ID 不符返回 PROJECT_ID_MISMATCH，且不切换当前会话', async () => {
    harness = await createHarness()
    const opened = await openOn(harness)
    const listed = await harness.invoke<RecentProjectListValue>(IPC_CHANNELS.recentList, {})
    if (!listed.ok) throw new Error('list failed')
    const recentId = listed.value.items[0].recentId

    const other = createNewProjectSnapshot({
      name: '另一个项目',
      template: 'empty',
      appVersion: '2.0.0-test',
      electronVersion: '45.2.3-test',
    })
    const otherEncoded = await encodeProjectFile(other)
    if (!otherEncoded.ok) throw new Error('encode failed')
    const otherPath = path.join(harness.directory, 'other.cunlian')
    await fsp.writeFile(otherPath, otherEncoded.value.bytes)
    harness.relinkQueue.push(otherPath)

    const result = await harness.invoke(IPC_CHANNELS.recentRelink, { recentId })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('PROJECT_ID_MISMATCH')
    }
    expect(harness.controller.sessionIdFor(1)).toBe(opened.sessionId)
    const untouched = await harness.recent.get(recentId)
    expect(untouched.ok).toBe(true)
    if (untouched.ok) {
      expect(untouched.value.projectId).toBe(SAMPLE_PROJECT_ID)
    }
  })

  it('最近项目路径失效：按 recentId 打开返回 NOT_FOUND，当前会话不变', async () => {
    harness = await createHarness()
    const opened = await openOn(harness)
    const listed = await harness.invoke<RecentProjectListValue>(IPC_CHANNELS.recentList, {})
    if (!listed.ok) throw new Error('list failed')
    expect(listed.value.items[0].missing).toBe(false)
    await fsp.unlink(opened.path as string)

    const result = await harness.invoke(IPC_CHANNELS.projectOpen, {
      recentId: listed.value.items[0].recentId,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND')
    }
    expect(harness.controller.sessionIdFor(1)).toBe(opened.sessionId)
  })

  it('恢复草稿：dirty gate 后切换为 path=null 的未保存副本，并重新落草稿', async () => {
    harness = await createHarness({ choices: ['discard'] })
    const opened = await openOn(harness)
    await stageRename(harness, opened, 1, '恢复用编辑')
    await harness.recovery.flush(opened.sessionId)
    const drafts = await harness.invoke<RecoveryListValue>(IPC_CHANNELS.recoveryList, {})
    expect(drafts.ok).toBe(true)
    if (!drafts.ok) return
    expect(drafts.value.items).toHaveLength(1)
    const recoveryId = drafts.value.items[0].recoveryId

    const restored = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.recoveryRestore, {
      recoveryId,
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.value.sessionId).not.toBe(opened.sessionId)
    expect(restored.value.path).toBeNull()
    expect(restored.value.warnings.join('\n')).toContain('未保存副本')
    expect(harness.projectService.getSession(opened.sessionId)).toBeNull()

    const draftsAfter = await harness.invoke<RecoveryListValue>(IPC_CHANNELS.recoveryList, {})
    expect(draftsAfter.ok).toBe(true)
    if (draftsAfter.ok) {
      expect(draftsAfter.value.items).toHaveLength(1)
    }
  })

  it('最近索引损坏时通道返回 INDEX_READ_FAILED', async () => {
    harness = await createHarness()
    await fsp.mkdir(harness.workspace, { recursive: true })
    await fsp.writeFile(path.join(harness.workspace, 'recent-projects.v1.json'), 'broken')
    const listed = await harness.invoke(IPC_CHANNELS.recentList, {})
    expect(listed.ok).toBe(false)
    if (!listed.ok) {
      expect(listed.error.code).toBe('INDEX_READ_FAILED')
    }
  })

  it('saveAs 成功后会话路径与指纹切换，可直接重开', async () => {
    harness = await createHarness()
    const created = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.projectNew, {
      name: '另存测试',
      template: 'empty',
    })
    if (!created.ok) throw new Error('new failed')
    const target = path.join(harness.directory, 'saved-as.cunlian')
    harness.saveTargetValue = target
    const saved = await harness.invoke<ProjectSaveValue>(IPC_CHANNELS.projectSaveAs, {
      sessionId: created.value.sessionId,
      editSeq: 0,
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.value.path).toBe(target)
    const session = harness.projectService.getSession(created.value.sessionId)!
    expect(session.path).toBe(target)
    expect(session.fingerprint).toBe(saved.value.fingerprint)
    expect(session.savedSeq).toBe(0)
  })
})
