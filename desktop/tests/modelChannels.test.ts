import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../shared/contracts'
import type {
  ModelCommitValue,
  ModelLinkValue,
  ModelPickValue,
  ModelReadValue,
} from '../shared/contracts'
import type { ProjectFileDimensionLink, ProjectFileSnapshot, ProjectFileVisualReferenceLink } from '../../src/project-file/types'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import { sampleStlTriangle } from '../../src/project-file/__fixtures__/modelProjectFile'
import { decodeProjectFile } from '../../src/project-file/codec'
import { parseStl } from '../../src/parts/stlValidation'
import { DEFAULT_STL_LIMITS } from '../../src/parts/stlLimits'
import { sha256Hex } from '../../src/sources/hash'
import {
  registerModelChannels,
  type ModelFileIo,
} from '../main/modelChannels'
import type { ProjectSession } from '../main/projectService'
import {
  createHarness,
  makeEvent,
  type Harness,
} from './helpers/a04'

function visualLinks(links: ProjectFileDimensionLink[]): ProjectFileVisualReferenceLink[] {
  return links.filter((link): link is ProjectFileVisualReferenceLink => link.kind === 'visual-reference')
}

const WINDOW = 1

interface ModelHarness extends Harness {
  files: Map<string, Uint8Array>
  io: ModelFileIo
  pickQueue: (string | null)[]
  openSession: (snapshot?: ProjectFileSnapshot) => Promise<ProjectSession>
}

async function createModelHarness(): Promise<ModelHarness> {
  const base = await createHarness()
  const files = new Map<string, Uint8Array>()
  const pickQueue: (string | null)[] = []
  let sizeOverride: number | null = null
  const io: ModelFileIo = {
    async kindOf(targetPath) {
      if (targetPath.startsWith('dir:')) return 'directory'
      if (targetPath.startsWith('link:')) return 'symlink'
      return files.has(targetPath) ? 'file' : 'missing'
    },
    async sizeOf(targetPath) {
      if (sizeOverride !== null) {
        const value = sizeOverride
        sizeOverride = null
        return value
      }
      return files.get(targetPath)?.byteLength ?? null
    },
    async readUpTo(targetPath, max) {
      const bytes = files.get(targetPath)
      if (bytes === undefined) throw new Error('ENOENT')
      return bytes.slice(0, max)
    },
  }
  registerModelChannels(base.ipc, {
    guard: base.guard,
    controller: base.controller,
    projectService: base.projectService,
    recovery: base.recovery,
    pickModelPath: async () => pickQueue.shift() ?? null,
    io,
    now: () => new Date('2026-11-09T10:00:00.000Z').getTime(),
    newId: (() => {
      let counter = 0
      return () => `id-${(counter += 1)}`
    })(),
  })
  const harness: ModelHarness = {
    ...base,
    files,
    io,
    pickQueue,
    openSession: async (snapshot) => {
      const opened = base.projectService.adoptSnapshot(
        snapshot ?? (await createSampleSnapshot()),
        null,
        null,
      )
      if (!opened.ok) throw new Error(opened.error.code)
      await base.controller.attach(WINDOW, opened.value.sessionId)
      const session = base.projectService.getSession(opened.value.sessionId)
      if (session === null) throw new Error('session missing')
      return session
    },
  }
  void sizeOverride
  return harness
}

function invokeAs<T>(
  harness: ModelHarness,
  channel: string,
  params: unknown,
  webContentsId = WINDOW,
): Promise<{ ok: boolean; value?: T; error?: { code: string; message: string; detail?: string } }> {
  return harness.ipc
    .invoke(channel, params, makeEvent({ webContentsId }))
    .then((result) => result as { ok: boolean; value?: T; error?: { code: string; message: string; detail?: string } })
}

describe('B2-03 模型导入通道', () => {
  it('pick：sender 白名单、会话/编辑序号、常规文件与 10 MiB 上限', async () => {
    const harness = await createModelHarness()
    const session = await harness.openSession()
    const stl = sampleStlTriangle()
    harness.files.set('/models/ok.stl', stl)
    harness.files.set('/models/empty.stl', new Uint8Array())
    harness.files.set('/models/big.stl', new Uint8Array(DEFAULT_STL_LIMITS.maxBytes + 1))

    // 非白名单窗口
    const foreign = await invokeAs(harness, IPC_CHANNELS.modelPick, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
    }, 99)
    expect(foreign.ok).toBe(false)
    expect(foreign.error?.code).toBe('FORBIDDEN_SENDER')

    // 编辑序号不匹配
    const stale = await invokeAs(harness, IPC_CHANNELS.modelPick, {
      sessionId: session.sessionId,
      baseEditSeq: 5,
    })
    expect(stale.error?.code).toBe('STALE_EDIT')

    // 目录 / 符号链接
    harness.pickQueue.push('dir:foo')
    const dir = await invokeAs(harness, IPC_CHANNELS.modelPick, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
    })
    expect(dir.error?.code).toBe('READ_FAILED')
    harness.pickQueue.push('link:foo')
    const symlink = await invokeAs(harness, IPC_CHANNELS.modelPick, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
    })
    expect(symlink.error?.code).toBe('READ_FAILED')

    // 空文件 / 超限
    harness.pickQueue.push('/models/empty.stl')
    const empty = await invokeAs(harness, IPC_CHANNELS.modelPick, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
    })
    expect(empty.error?.code).toBe('STL_EMPTY')
    harness.pickQueue.push('/models/big.stl')
    const big = await invokeAs(harness, IPC_CHANNELS.modelPick, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
    })
    expect(big.error?.code).toBe('STL_TOO_LARGE')
    expect(big.error?.detail).toContain(`${DEFAULT_STL_LIMITS.maxBytes + 1}`)

    // 取消
    harness.pickQueue.push(null)
    const cancelled = await invokeAs(harness, IPC_CHANNELS.modelPick, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
    })
    expect(cancelled.error?.code).toBe('CANCELLED')
  })

  it('pick → read → commit：创建部件/版本/blob，acceptedSeq 递增，可保存后重开', async () => {
    const harness = await createModelHarness()
    const session = await harness.openSession()
    const stl = sampleStlTriangle()
    harness.files.set('/models/sleeve.stl', stl)
    harness.pickQueue.push('/models/sleeve.stl')

    const picked = await invokeAs<ModelPickValue>(harness, IPC_CHANNELS.modelPick, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
    })
    expect(picked.ok).toBe(true)
    if (!picked.ok || !picked.value) return
    expect(picked.value.fileName).toBe('sleeve.stl')
    expect(picked.value.sha256).toBe(await sha256Hex(stl))

    const read = await invokeAs<ModelReadValue>(harness, IPC_CHANNELS.modelRead, {
      sessionId: session.sessionId,
      ref: { kind: 'candidate', token: picked.value.candidateToken },
    })
    expect(read.ok).toBe(true)
    if (read.ok && read.value) {
      expect(Array.from(read.value.bytes)).toEqual(Array.from(stl))
    }

    const committed = await invokeAs<ModelCommitValue>(harness, IPC_CHANNELS.modelCommit, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
      candidateToken: picked.value.candidateToken,
      expectedCurrentModelRevisionId: null,
      partName: '隔套外形',
      unitNote: '单位：mm（用户备注，不缩放顶点）',
    })
    expect(committed.ok).toBe(true)
    if (!committed.ok || !committed.value) return
    expect(committed.value.acceptedSeq).toBe(1)
    expect(committed.value.snapshot.project.parts).toHaveLength(1)
    expect(committed.value.snapshot.project.modelRevisions).toHaveLength(1)
    const model = committed.value.snapshot.project.modelRevisions[0]!
    expect(model.triangleCount).toBe(1)
    expect(model.encoding).toBe('binary')
    expect(model.unitNote).toBe('单位：mm（用户备注，不缩放顶点）')
    expect(model.parentModelRevisionId).toBeNull()

    const after = harness.projectService.getSession(session.sessionId)!
    expect(after.snapshot.attachments.some((item) => item.blobKey === model.blobKey)).toBe(true)

    // 保存 → 重新解码：模型与字节都在。
    const target = harness.samplePath('with-model')
    const saved = await harness.projectService.saveAs(session.sessionId, {
      editSeq: 1,
      expectedFingerprint: null,
      targetPath: target,
      overwriteFingerprint: null,
    })
    expect(saved.ok).toBe(true)
    const { promises: fsp } = await import('node:fs')
    const decoded = await decodeProjectFile(new Uint8Array(await fsp.readFile(target)))
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.value.manifest.formatVersion).toBe(2)
      expect(decoded.value.snapshot.project.modelRevisions).toHaveLength(1)
      expect(
        decoded.value.snapshot.attachments.find((item) => item.blobKey === model.blobKey)
          ?.bytes.byteLength,
      ).toBe(stl.byteLength)
    }
  })

  it('截断二进制在 commit 被拒：具体长度原因，会话与版本不变', async () => {
    const harness = await createModelHarness()
    const session = await harness.openSession()
    const full = sampleStlTriangle()
    harness.files.set('/models/broken.stl', full.slice(0, full.byteLength - 10))
    harness.pickQueue.push('/models/broken.stl')
    const picked = await invokeAs<ModelPickValue>(harness, IPC_CHANNELS.modelPick, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
    })
    expect(picked.ok).toBe(true)
    if (!picked.ok || !picked.value) return
    const committed = await invokeAs<ModelCommitValue>(harness, IPC_CHANNELS.modelCommit, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
      candidateToken: picked.value.candidateToken,
      expectedCurrentModelRevisionId: null,
      partName: '坏文件',
      unitNote: '',
    })
    expect(committed.ok).toBe(false)
    expect(committed.error?.code).toBe('STL_BINARY_LENGTH_MISMATCH')
    expect(committed.error?.detail).toContain('声明 1 面')
    const after = harness.projectService.getSession(session.sessionId)!
    expect(after.acceptedSeq).toBe(0)
    expect(after.snapshot.project.modelRevisions).toHaveLength(0)
    expect(after.snapshot.blobs).toHaveLength(1) // 只有原 PDF
  })

  it('200001 面在 commit 预检阶段被拒，不进入几何分配', async () => {
    const harness = await createModelHarness()
    const session = await harness.openSession()
    const count = DEFAULT_STL_LIMITS.maxTriangles + 1
    const bytes = new Uint8Array(84 + count * 50)
    new DataView(bytes.buffer).setUint32(80, count, true)
    // 面内容留空 → 若预检失效会先报退化/非有限；断言必须是面数错误。
    harness.files.set('/models/huge.stl', bytes)
    harness.pickQueue.push('/models/huge.stl')
    const picked = await invokeAs<ModelPickValue>(harness, IPC_CHANNELS.modelPick, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
    })
    expect(picked.ok).toBe(true)
    if (!picked.ok || !picked.value) return
    const committed = await invokeAs<ModelCommitValue>(harness, IPC_CHANNELS.modelCommit, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
      candidateToken: picked.value.candidateToken,
      expectedCurrentModelRevisionId: null,
      partName: '超大',
      unitNote: '',
    })
    expect(committed.error?.code).toBe('STL_TOO_MANY_TRIANGLES')
    expect(committed.error?.detail).toContain('200001')
  })

  it('候选 token：跨窗口读取、过期、release 后读取均被拒', async () => {
    const harness = await createModelHarness()
    const session = await harness.openSession()
    harness.files.set('/models/a.stl', sampleStlTriangle())
    harness.pickQueue.push('/models/a.stl')
    const picked = await invokeAs<ModelPickValue>(harness, IPC_CHANNELS.modelPick, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
    })
    if (!picked.ok || !picked.value) throw new Error('pick failed')

    const cross = await invokeAs(harness, IPC_CHANNELS.modelRead, {
      sessionId: session.sessionId,
      ref: { kind: 'candidate', token: picked.value.candidateToken },
    }, 2)
    expect(cross.ok).toBe(false)

    const released = await invokeAs<{ released: boolean }>(harness, IPC_CHANNELS.modelRelease, {
      sessionId: session.sessionId,
      candidateToken: picked.value.candidateToken,
    })
    expect(released.ok && released.value?.released).toBe(true)
    const again = await invokeAs<{ released: boolean }>(harness, IPC_CHANNELS.modelRelease, {
      sessionId: session.sessionId,
      candidateToken: picked.value.candidateToken,
    })
    expect(again.ok && again.value?.released).toBe(false)
    const read = await invokeAs(harness, IPC_CHANNELS.modelRead, {
      sessionId: session.sessionId,
      ref: { kind: 'candidate', token: picked.value.candidateToken },
    })
    expect(read.error?.code).toBe('CANDIDATE_EXPIRED')
  })

  it('CAS 与容量：stale edit 拒绝；附件额度超限拒绝且旧会话不变', async () => {
    const harness = await createModelHarness()
    const base = await createSampleSnapshot()
    // 10 个 10 MiB 的“PDF”blob（声明缺失，避免构造 100 MiB 真实字节）。
    const bigBlobs = Array.from({ length: 10 }, (_, index) => ({
      blobKey: `blob-fill-${index}`,
      projectId: base.project.id,
      sha256: 'a'.repeat(64),
      byteSize: 10 * 1024 * 1024,
    }))
    const nearLimit: ProjectFileSnapshot = {
      ...base,
      blobs: bigBlobs,
      revisions: [],
      documents: [],
      bindings: [],
      snapshotReferences: [],
      attachments: [],
    }
    const session = await harness.openSession(nearLimit)
    harness.files.set('/models/x.stl', sampleStlTriangle())
    harness.pickQueue.push('/models/x.stl')
    const picked = await invokeAs<ModelPickValue>(harness, IPC_CHANNELS.modelPick, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
    })
    if (!picked.ok || !picked.value) throw new Error('pick failed')

    // 先制造编辑序号变化，再提交旧 baseEditSeq。
    session.acceptedSeq = 1
    const stale = await invokeAs(harness, IPC_CHANNELS.modelCommit, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
      candidateToken: picked.value.candidateToken,
      expectedCurrentModelRevisionId: null,
      partName: 'x',
      unitNote: '',
    })
    expect(stale.error?.code).toBe('STALE_EDIT')

    session.acceptedSeq = 0
    const tooLarge = await invokeAs(harness, IPC_CHANNELS.modelCommit, {
      sessionId: session.sessionId,
      baseEditSeq: 0,
      candidateToken: picked.value.candidateToken,
      expectedCurrentModelRevisionId: null,
      partName: 'x',
      unitNote: '',
    })
    expect(tooLarge.error?.code).toBe('PROJECT_ASSETS_TOO_LARGE')
    expect(tooLarge.error?.detail).toContain('104857600')
    expect(session.snapshot.project.modelRevisions).toHaveLength(0)
    expect(session.acceptedSeq).toBe(0)
  })

  it('替换：新版本父指向旧版、同 partId、关联转 pending 且旧目标保留', async () => {
    const harness = await createModelHarness()
    const session = await harness.openSession()
    harness.files.set('/models/v1.stl', sampleStlTriangle(1))
    harness.files.set('/models/v2.stl', sampleStlTriangle(2))

    async function importFile(target: string, baseEditSeq: number, replacePartId?: string) {
      harness.pickQueue.push(target)
      const picked = await invokeAs<ModelPickValue>(harness, IPC_CHANNELS.modelPick, {
        sessionId: session.sessionId,
        baseEditSeq,
        ...(replacePartId === undefined ? {} : { replacePartId }),
      })
      if (!picked.ok || !picked.value) throw new Error(`pick failed: ${picked.error?.code}`)
      const current = harness.projectService.getSession(session.sessionId)!
      const part = current.snapshot.project.parts.find((item) => item.partId === replacePartId)
      return invokeAs<ModelCommitValue>(harness, IPC_CHANNELS.modelCommit, {
        sessionId: session.sessionId,
        baseEditSeq,
        candidateToken: picked.value.candidateToken,
        expectedCurrentModelRevisionId: part?.currentModelRevisionId ?? null,
        partName: '隔套外形',
        unitNote: '',
      })
    }

    const first = await importFile('/models/v1.stl', 0)
    expect(first.ok).toBe(true)
    if (!first.ok || !first.value) return
    const model1 = first.value.snapshot.project.modelRevisions[0]!
    const partId = model1.partId

    const bound = await invokeAs<ModelLinkValue>(harness, IPC_CHANNELS.modelLink, {
      sessionId: session.sessionId,
      baseEditSeq: first.value.acceptedSeq,
      operation: 'bind',
      termId: 't-s',
      target: { granularity: 'model', partId, modelRevisionId: model1.modelRevisionId },
      expectedCurrentModelRevisionId: model1.modelRevisionId,
    })
    expect(bound.ok).toBe(true)
    if (!bound.ok || !bound.value) return
    expect(bound.value.warning).toContain('不改变尺寸链数值')
    const chainBefore = JSON.stringify(bound.value.snapshot.project.dimensionChain)
    const linkId = visualLinks(bound.value.snapshot.project.dimensionLinks)[0]!.linkId

    const second = await importFile('/models/v2.stl', bound.value.acceptedSeq, partId)
    expect(second.ok).toBe(true)
    if (!second.ok || !second.value) return
    const snapshot = second.value.snapshot
    expect(snapshot.project.parts).toHaveLength(1)
    expect(snapshot.project.parts[0]!.currentModelRevisionId).not.toBe(model1.modelRevisionId)
    const model2 = snapshot.project.modelRevisions.find(
      (item) => item.modelRevisionId === snapshot.project.parts[0]!.currentModelRevisionId,
    )!
    expect(model2.parentModelRevisionId).toBe(model1.modelRevisionId)
    expect(model2.partId).toBe(partId)
    const link = visualLinks(snapshot.project.dimensionLinks).find((item) => item.linkId === linkId)!
    expect(link.reviewStatus).toBe('pending')
    expect(link.reason).toBe('model-replaced')
    expect(link.target.modelRevisionId).toBe(model1.modelRevisionId)
    expect(link.reviewedModelRevisionId).toBe(model1.modelRevisionId)
    // 尺寸链数值零变化
    expect(JSON.stringify(snapshot.project.dimensionChain)).toBe(chainBefore)

    // 核对新版
    const confirmed = await invokeAs<ModelLinkValue>(harness, IPC_CHANNELS.modelLink, {
      sessionId: session.sessionId,
      baseEditSeq: second.value.acceptedSeq,
      operation: 'confirm-new',
      linkId,
      termId: 't-s',
      target: { granularity: 'model', partId, modelRevisionId: model2.modelRevisionId },
      expectedCurrentModelRevisionId: model2.modelRevisionId,
    })
    expect(confirmed.ok).toBe(true)
    if (confirmed.ok && confirmed.value) {
      const after = visualLinks(confirmed.value.snapshot.project.dimensionLinks).find(
        (item) => item.linkId === linkId,
      )!
      expect(after.reviewStatus).toBe('confirmed')
      expect(after.target.modelRevisionId).toBe(model2.modelRevisionId)
      expect(after.reviewedAt).toBe('2026-11-09T10:00:00.000Z')
      expect(JSON.stringify(confirmed.value.snapshot.project.dimensionChain)).toBe(chainBefore)
    }
  })

  it('相同字节替换也创建新版本但复用 blob', async () => {
    const harness = await createModelHarness()
    const session = await harness.openSession()
    const bytes = sampleStlTriangle()
    harness.files.set('/models/same.stl', bytes)

    async function importOnce(baseEditSeq: number, replacePartId?: string) {
      harness.pickQueue.push('/models/same.stl')
      const picked = await invokeAs<ModelPickValue>(harness, IPC_CHANNELS.modelPick, {
        sessionId: session.sessionId,
        baseEditSeq,
        ...(replacePartId === undefined ? {} : { replacePartId }),
      })
      if (!picked.ok || !picked.value) throw new Error('pick failed')
      const current = harness.projectService.getSession(session.sessionId)!
      const part = current.snapshot.project.parts.find((item) => item.partId === replacePartId)
      return invokeAs<ModelCommitValue>(harness, IPC_CHANNELS.modelCommit, {
        sessionId: session.sessionId,
        baseEditSeq,
        candidateToken: picked.value.candidateToken,
        expectedCurrentModelRevisionId: part?.currentModelRevisionId ?? null,
        partName: '隔套外形',
        unitNote: '',
      })
    }

    const first = await importOnce(0)
    if (!first.ok || !first.value) throw new Error('first failed')
    const partId = first.value.snapshot.project.parts[0]!.partId
    const blobKey = first.value.snapshot.project.modelRevisions[0]!.blobKey
    const second = await importOnce(first.value.acceptedSeq, partId)
    expect(second.ok).toBe(true)
    if (!second.ok || !second.value) return
    expect(second.value.snapshot.project.modelRevisions).toHaveLength(2)
    expect(second.value.snapshot.blobs.filter((item) => item.blobKey === blobKey)).toHaveLength(1)
    expect(second.value.snapshot.blobs).toHaveLength(2) // PDF + 共享模型 blob
    const mainSnapshot = harness.projectService.getSession(session.sessionId)!.snapshot
    expect(
      mainSnapshot.attachments.filter((item) => item.blobKey === blobKey),
    ).toHaveLength(1)
  })
})

describe('B2-01 解析器与通道共享同一上限', () => {
  it('200001 面在纯解析器同样报 TOO_MANY，且不依赖通道', () => {
    const count = DEFAULT_STL_LIMITS.maxTriangles + 1
    const bytes = new Uint8Array(84 + count * 50)
    new DataView(bytes.buffer).setUint32(80, count, true)
    const result = parseStl(bytes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STL_TOO_MANY_TRIANGLES')
  })
})
