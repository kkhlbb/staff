// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createHarness,
  failingWriteOps,
  stageRename,
  writeHookOps,
  type Harness,
} from './helpers/a04'
import { runCloseGate } from '../main/sessionController'
import { decodeProjectFile } from '../../src/project-file/codec'

let harness: Harness | undefined

beforeEach(() => {
  harness = undefined
})

afterEach(async () => {
  await harness?.dispose()
})

async function hashFile(target: string): Promise<string> {
  return createHash('sha256').update(await fsp.readFile(target)).digest('hex')
}

async function projectNameAt(target: string): Promise<string> {
  const decoded = await decodeProjectFile(new Uint8Array(await fsp.readFile(target)))
  if (!decoded.ok) {
    throw new Error(`decode failed: ${decoded.error.code}`)
  }
  return decoded.value.snapshot.project.name
}

describe('dirty gate', () => {
  it('取消：保持同一会话与编辑，磁盘不变', async () => {
    harness = await createHarness({ choices: ['cancel'] })
    const opened = await harness.openSample()
    const before = await hashFile(opened.path as string)
    const staged = await stageRename(harness, opened, 1, '改名一')
    expect(staged.ok).toBe(true)

    const session = harness.controller.sessionFor(1)
    expect(session).not.toBeNull()
    expect(harness.controller.isDirty(session!)).toBe(true)

    const result = await runCloseGate(harness.controller, 1, 'close')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('CANCELLED')
    }
    expect(harness.controller.sessionFor(1)).not.toBeNull()
    expect(harness.controller.isDirty(harness.controller.sessionFor(1)!)).toBe(true)
    expect(await hashFile(opened.path as string)).toBe(before)
    expect(harness.prompts).toHaveLength(1)
    expect(harness.prompts[0].projectName).toBe('改名一')
  })

  it('不保存：切换/关闭放行，磁盘不变，会话与草稿被清理', async () => {
    harness = await createHarness({ choices: ['discard'] })
    const opened = await harness.openSample()
    const before = await hashFile(opened.path as string)
    await stageRename(harness, opened, 1, '不要保存')
    // 先让草稿落盘，验证丢弃时会删除它。
    await harness.recovery.flush(harness.controller.sessionIdFor(1) as string)
    const drafts = await harness.recovery.list()
    expect(drafts.ok && drafts.value.items).toHaveLength(1)

    const result = await runCloseGate(harness.controller, 1, 'quit')
    expect(result.ok).toBe(true)
    expect(harness.controller.sessionFor(1)).toBeNull()
    expect(await hashFile(opened.path as string)).toBe(before)
    const afterDrafts = await harness.recovery.list()
    expect(afterDrafts.ok).toBe(true)
    if (afterDrafts.ok) {
      expect(afterDrafts.value.items).toHaveLength(0)
    }
  })

  it('保存：真实落盘成功后才放行；重开得到新名字，草稿清理，最近项目登记', async () => {
    harness = await createHarness({ choices: ['save'] })
    const opened = await harness.openSample()
    await stageRename(harness, opened, 1, '已保存的新名字')

    const result = await runCloseGate(harness.controller, 1, 'close')
    expect(result.ok).toBe(true)
    expect(harness.controller.sessionFor(1)).toBeNull()
    expect(await projectNameAt(opened.path as string)).toBe('已保存的新名字')

    const recent = await harness.recent.list()
    expect(recent.ok).toBe(true)
    if (recent.ok) {
      expect(recent.value.items).toHaveLength(1)
      expect(recent.value.items[0].path).toBe(opened.path)
      expect(recent.value.items[0].missing).toBe(false)
    }
    const drafts = await harness.recovery.list()
    expect(drafts.ok).toBe(true)
    if (drafts.ok) {
      expect(drafts.value.items).toHaveLength(0)
    }
  })

  it('保存失败：不切换、不退出，会话保留编辑，原文件不变', async () => {
    harness = await createHarness({
      choices: ['save'],
      fileOps: failingWriteOps('ENOSPC'),
    })
    const opened = await harness.openSample()
    const before = await hashFile(opened.path as string)
    await stageRename(harness, opened, 1, '保存失败也要保留')

    const result = await runCloseGate(harness.controller, 1, 'close')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NO_SPACE')
    }
    const session = harness.controller.sessionFor(1)
    expect(session).not.toBeNull()
    expect(session!.acceptedSeq).toBe(1)
    expect(session!.savedSeq).toBe(0)
    expect(harness.controller.isDirty(session!)).toBe(true)
    expect(await hashFile(opened.path as string)).toBe(before)
  })

  it('stage 竞态：保存期间出现更高 editSeq 时不放行，重新询问；取消后编辑仍在', async () => {
    const hook: { fn: (() => Promise<void>) | null } = { fn: null }
    harness = await createHarness({
      choices: ['save', 'cancel'],
      fileOps: writeHookOps(hook),
    })
    const opened = await harness.openSample()
    await stageRename(harness, opened, 1, '第一版')
    // 第一次落盘写临时文件时注入第二次编辑（editSeq=2）。
    hook.fn = async () => {
      const staged = await stageRename(harness as Harness, opened, 2, '第二版')
      expect(staged.ok).toBe(true)
    }

    const result = await runCloseGate(harness.controller, 1, 'close')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('CANCELLED')
    }
    // 两次询问：保存后检测到更新编辑，不能把旧序号当已保存。
    expect(harness.prompts).toHaveLength(2)
    const session = harness.controller.sessionFor(1)
    expect(session).not.toBeNull()
    expect(session!.savedSeq).toBe(1)
    expect(session!.acceptedSeq).toBe(2)
    expect(harness.controller.isDirty(session!)).toBe(true)
    // 第一次保存已提交 seq1 内容，第二次编辑未被误写。
    expect(await projectNameAt(opened.path as string)).toBe('第一版')
  })

  it('编辑屏障失败（超时）时不弹三选、不关闭', async () => {
    harness = await createHarness({ choices: ['save'] })
    const opened = await harness.openSample()
    await stageRename(harness, opened, 1, '屏障失败')
    // 打开成功后再让屏障失败：模拟关闭时 renderer 没有及时回复。
    harness.flushResult = {
      ok: false,
      error: {
        code: 'EDITOR_TIMEOUT',
        message: '等待编辑内容提交超时，窗口未关闭',
      },
    }
    const result = await runCloseGate(harness.controller, 1, 'close')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('EDITOR_TIMEOUT')
    }
    expect(harness.prompts).toHaveLength(0)
    expect(harness.controller.sessionFor(1)).not.toBeNull()
  })

  it('⌘Q 与红点走同一关闭流程（仅 purpose 不同）', async () => {
    for (const purpose of ['close', 'quit'] as const) {
      const local = await createHarness({ choices: ['cancel'] })
      try {
        const opened = await local.openSample()
        await stageRename(local, opened, 1, `purpose-${purpose}`)
        const result = await runCloseGate(local.controller, 1, purpose)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.code).toBe('CANCELLED')
        }
        expect(local.prompts).toHaveLength(1)
        expect(local.prompts[0].purpose).toBe(purpose)
        expect(local.controller.sessionFor(1)).not.toBeNull()
      } finally {
        await local.dispose()
      }
    }
  })

  it('并发 gate 直接 BUSY，不弹第二个对话框', async () => {
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let asked = 0
    harness = await createHarness({ choices: ['cancel'] })
    const opened = await harness.openSample()
    await stageRename(harness, opened, 1, '并发')
    // 重新构造带 onAskChoice 的控制器不现实；直接在端口层阻塞第一个 gate。
    const controller = harness.controller as unknown as {
      ports: { askChoice: (prompt: unknown) => Promise<string> }
    }
    const original = controller.ports.askChoice
    controller.ports.askChoice = async (prompt) => {
      asked += 1
      await blocked
      return original(prompt)
    }

    const first = runCloseGate(harness.controller, 1, 'close')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second = await runCloseGate(harness.controller, 1, 'quit')
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error.code).toBe('BUSY')
    }
    release?.()
    const firstResult = await first
    expect(asked).toBe(1)
    expect(firstResult.ok).toBe(false)
    if (!firstResult.ok) {
      expect(firstResult.error.code).toBe('CANCELLED')
    }
  })
})
