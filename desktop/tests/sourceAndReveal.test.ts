// @vitest-environment node
/**
 * A-04c：source:read 与 project:reveal 的通道级验收。
 *
 * 用真实临时目录、真实 ProjectService/FileStore 与假 IPC；不启动 Electron。
 * 每个失败路径都断言错误码与“没有越权读到别的项目/没有凭空成功”。
 */
import { promises as fsp } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness, type HarnessOptions } from './helpers/a04'
import { IPC_CHANNELS } from '../shared/contracts'
import type {
  ProjectFileSnapshot,
} from '../../src/project-file/types'
import type {
  ProjectOpenValue,
  ProjectRevealValue,
  SourceReadValue,
} from '../shared/contracts'
import {
  createSampleSnapshot,
  SAMPLE_PDF_BYTES,
} from '../../src/project-file/__fixtures__/sampleProjectFile'
import { sha256Hex } from '../../src/sources/hash'

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

/** 另一个项目的完整聚合：项目/文档/版本/blob 都换成 B 的 ID，引用保持自洽。 */
async function createOtherProjectSnapshot(): Promise<ProjectFileSnapshot> {
  const base = await createSampleSnapshot()
  const project = { ...base.project, id: 'project-b', name: '另一个项目' }
  const document = {
    ...base.documents[0],
    id: 'doc-b',
    projectId: project.id,
    latestRevisionId: 'sr-b',
  }
  const revision = {
    ...base.revisions[0],
    id: 'sr-b',
    projectId: project.id,
    documentId: document.id,
    blobKey: 'blob-b',
    fileName: '别的项目.pdf',
  }
  const blob = { ...base.blobs[0], blobKey: revision.blobKey, projectId: project.id }
  return {
    ...base,
    project,
    documents: [document],
    revisions: [revision],
    blobs: [blob],
    bindings: [],
    events: base.events.map((event) => ({ ...event, projectId: project.id })),
    analysisSnapshots: base.analysisSnapshots.map((item) => ({
      ...item,
      projectId: project.id,
      projectName: project.name,
    })),
    snapshotReferences: [
      { snapshotId: 'snap-1', revisionIds: [revision.id], blobKeys: [blob.blobKey] },
    ],
    attachments: [{ blobKey: blob.blobKey, bytes: SAMPLE_PDF_BYTES }],
    fileRevisions: base.fileRevisions.map((item) => ({ ...item, project })),
  }
}

describe('source:read', () => {
  it('返回内存聚合里的附件字节（Uint8Array）、哈希与文件名', async () => {
    const harness = await makeHarness()
    const opened = await harness.openSample()

    const result = await harness.invoke<SourceReadValue>(IPC_CHANNELS.sourceRead, {
      sessionId: opened.sessionId,
      revisionId: 'sr-1',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(result.value.bytes)).toEqual(Array.from(SAMPLE_PDF_BYTES))
    expect(result.value.sha256).toBe(await sha256Hex(SAMPLE_PDF_BYTES))
    expect(result.value.fileName).toBe('轴系装配图.pdf')
    // 返回的是副本：renderer 改字节不污染 main 会话。
    result.value.bytes[0] = 0
    const session = harness.projectService.getSession(opened.sessionId)
    expect(session?.snapshot.attachments[0].bytes[0]).not.toBe(0)
  })

  it('越权读取别的项目的 revision：只按当前会话聚合解析，返回 ATTACHMENT_MISSING', async () => {
    // 先在 B 项目自己的会话里证明 sr-b 是真实可读的版本。
    const otherHarness = await makeHarness()
    const otherOpened = await otherHarness.openSample(
      await createOtherProjectSnapshot(),
      'other-project',
    )
    const readOwn = await otherHarness.invoke<SourceReadValue>(IPC_CHANNELS.sourceRead, {
      sessionId: otherOpened.sessionId,
      revisionId: 'sr-b',
    })
    expect(readOwn.ok).toBe(true)
    if (readOwn.ok) {
      expect(readOwn.value.fileName).toBe('别的项目.pdf')
    }

    // 在 A 项目会话里拿 B 的 revision ID 读取：B 的字节不在 A 的内存聚合里。
    const harness = await makeHarness()
    const opened = await harness.openSample()
    const crossProject = await harness.invoke<SourceReadValue>(IPC_CHANNELS.sourceRead, {
      sessionId: opened.sessionId,
      revisionId: 'sr-b',
    })
    expect(crossProject.ok).toBe(false)
    if (!crossProject.ok) {
      expect(crossProject.error.code).toBe('ATTACHMENT_MISSING')
    }
  })

  it('路径注入：revisionId 含路径段或额外 path/blobKey 字段都按 INVALID_REQUEST 拒绝', async () => {
    const harness = await makeHarness()
    const opened = await harness.openSample()

    const pathLike = await harness.invoke(IPC_CHANNELS.sourceRead, {
      sessionId: opened.sessionId,
      revisionId: '../../../../etc/passwd',
    })
    expect(pathLike.ok).toBe(false)
    if (!pathLike.ok) {
      expect(pathLike.error.code).toBe('INVALID_REQUEST')
    }

    const extraPath = await harness.invoke(IPC_CHANNELS.sourceRead, {
      sessionId: opened.sessionId,
      revisionId: 'sr-1',
      path: '/etc/passwd',
    })
    expect(extraPath.ok).toBe(false)
    if (!extraPath.ok) {
      expect(extraPath.error.code).toBe('INVALID_REQUEST')
    }

    const extraBlobKey = await harness.invoke(IPC_CHANNELS.sourceRead, {
      sessionId: opened.sessionId,
      revisionId: 'sr-1',
      blobKey: 'blob-1',
    })
    expect(extraBlobKey.ok).toBe(false)
    if (!extraBlobKey.ok) {
      expect(extraBlobKey.error.code).toBe('INVALID_REQUEST')
    }
  })

  it('哈希不符：内存字节被改动后拒绝返回，报 HASH_MISMATCH', async () => {
    const harness = await makeHarness()
    const opened = await harness.openSample()
    const session = harness.projectService.getSession(opened.sessionId)
    expect(session).not.toBeNull()
    if (session === null) return
    session.snapshot.attachments = [
      { blobKey: 'blob-1', bytes: new TextEncoder().encode('%PDF-1.7 tampered') },
    ]

    const result = await harness.invoke<SourceReadValue>(IPC_CHANNELS.sourceRead, {
      sessionId: opened.sessionId,
      revisionId: 'sr-1',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('HASH_MISMATCH')
    }
  })

  it('附件缺失：版本存在但没有字节时返回 ATTACHMENT_MISSING', async () => {
    const harness = await makeHarness()
    const opened = await harness.openSample()
    const session = harness.projectService.getSession(opened.sessionId)
    if (session === null) return
    session.snapshot.attachments = []

    const result = await harness.invoke<SourceReadValue>(IPC_CHANNELS.sourceRead, {
      sessionId: opened.sessionId,
      revisionId: 'sr-1',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('ATTACHMENT_MISSING')
    }
  })

  it('历史归档：能解析退役 revision，但归档不携带字节，返回 ATTACHMENT_MISSING', async () => {
    const harness = await makeHarness()
    const opened = await harness.openSample()
    const session = harness.projectService.getSession(opened.sessionId)
    if (session === null) return
    session.snapshot.legacyArchive = {
      sourceProjectId: 'retired-project',
      sourceManifest: {},
      records: [
        {
          kind: 'revision',
          projectId: 'retired-project',
          record: {
            id: 'legacy-rev-1',
            projectId: 'retired-project',
            documentId: 'legacy-doc',
            fileName: '退役.pdf',
            sha256: 'a'.repeat(64),
            byteSize: 10,
            pageCount: 1,
            createdAt: '2026-11-09T08:00:00.000Z',
            blobKey: 'legacy-blob',
          },
        },
      ],
      warnings: [],
    }

    const result = await harness.invoke<SourceReadValue>(IPC_CHANNELS.sourceRead, {
      sessionId: opened.sessionId,
      revisionId: 'legacy-rev-1',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('ATTACHMENT_MISSING')
      expect(result.error.message).toContain('历史归档')
    }
  })
})

describe('project:reveal', () => {
  it('已落盘会话：只把会话正式路径交给 reveal 端口，返回 shown:true', async () => {
    const harness = await makeHarness()
    const opened = await harness.openSample()
    expect(opened.path).not.toBeNull()

    const result = await harness.invoke<ProjectRevealValue>(IPC_CHANNELS.projectReveal, {
      sessionId: opened.sessionId,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ shown: true })
    expect(harness.revealCalls).toEqual([opened.path])
  })

  it('未落盘会话：path=null 时返回 NOT_FOUND，不调用 reveal', async () => {
    const harness = await makeHarness()
    const created = await harness.invoke<ProjectOpenValue>(IPC_CHANNELS.projectNew, {
      name: '尚未保存',
      template: 'empty',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.path).toBeNull()

    const result = await harness.invoke<ProjectRevealValue>(IPC_CHANNELS.projectReveal, {
      sessionId: created.value.sessionId,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND')
    }
    expect(harness.revealCalls).toEqual([])
  })

  it('文件已删除：返回 NOT_FOUND，不把失效路径交给 reveal', async () => {
    const harness = await makeHarness()
    const opened = await harness.openSample()
    if (opened.path === null) throw new Error('sample path missing')
    await fsp.unlink(opened.path)

    const result = await harness.invoke<ProjectRevealValue>(IPC_CHANNELS.projectReveal, {
      sessionId: opened.sessionId,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND')
    }
    expect(harness.revealCalls).toEqual([])
  })

  it('reveal 端口失败：返回 REVEAL_FAILED，不谎报 shown', async () => {
    const harness = await makeHarness({ revealError: new Error('injected reveal failure') })
    const opened = await harness.openSample()

    const result = await harness.invoke<ProjectRevealValue>(IPC_CHANNELS.projectReveal, {
      sessionId: opened.sessionId,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('REVEAL_FAILED')
    }
  })
})
