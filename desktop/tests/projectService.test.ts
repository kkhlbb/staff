import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileStore, nodeFileOps, type FileOps } from '../main/fileStore'
import { ProjectService } from '../main/projectService'
import { encodeProjectFile } from '../../src/project-file/codec'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import type { ProjectFileSnapshot } from '../../src/project-file/types'

let directory: string
let counter = 0

beforeEach(async () => {
  directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'cunlian-a02-svc-'))
  counter = 0
})

afterEach(async () => {
  await fsp.rm(directory, { recursive: true, force: true })
})

function newService(options: { store?: FileStore } = {}): ProjectService {
  return new ProjectService({
    store: options.store,
    newSessionId: () => `session-${(counter += 1)}`,
  })
}

async function encodedBytes(snapshot: ProjectFileSnapshot): Promise<Uint8Array> {
  const encoded = await encodeProjectFile(snapshot)
  if (!encoded.ok) {
    throw new Error(`fixture encode failed: ${encoded.error.message}`)
  }
  return encoded.value.bytes
}

function projectPath(name = 'project'): string {
  return path.join(directory, `${name}.cunlian`)
}

async function openSample(service: ProjectService): Promise<{
  sessionId: string
  snapshot: ProjectFileSnapshot
}> {
  const snapshot = await createSampleSnapshot()
  const bytes = await encodedBytes(snapshot)
  const opened = await service.openBytes(bytes, null, null)
  if (!opened.ok) {
    throw new Error(`openBytes failed: ${opened.error.code}`)
  }
  return { sessionId: opened.value.sessionId, snapshot }
}

describe('ProjectService 会话与保存', () => {
  it('saveAs 落盘后重新打开得到同样的工程聚合', async () => {
    const service = newService()
    const { sessionId, snapshot } = await openSample(service)

    const staged = (await service.stage(sessionId, 1, { ...snapshot, project: { ...snapshot.project, name: '改名后的项目' } }))
    expect(staged.ok).toBe(true)

    const saved = await service.saveAs(sessionId, {
      editSeq: 1,
      expectedFingerprint: null,
      targetPath: projectPath(),
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.value.savedSeq).toBe(1)
    expect(saved.value.path).toBe(projectPath())

    const reopened = await service.openFile(projectPath())
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.value.snapshot.project.name).toBe('改名后的项目')
    expect('attachments' in reopened.value.snapshot).toBe(false)
    expect(reopened.value.path).toBe(projectPath())
    expect(reopened.value.fingerprint).toBe(saved.value.fingerprint)
  })

  it('已有路径的 save 使用会话指纹，覆盖后 savedSeq 前进', async () => {
    const service = newService()
    const { sessionId } = await openSample(service)
    const first = await service.saveAs(sessionId, {
      editSeq: 0,
      expectedFingerprint: null,
      targetPath: projectPath(),
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const reopened = await service.openFile(projectPath())
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    const session2 = reopened.value.sessionId
    const session = service.getSession(session2)
    expect(session?.path).toBe(projectPath())
    expect(session?.fingerprint).toBe(first.value.fingerprint)

    const snapshot = session?.snapshot as ProjectFileSnapshot
    (await service.stage(session2, 1, {
      ...snapshot,
      project: { ...snapshot.project, name: '第二次保存' },
    }))
    const saved = await service.save(session2, {
      editSeq: 1,
      expectedFingerprint: reopened.value.fingerprint,
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.value.savedSeq).toBe(1)
    expect(saved.value.fingerprint).not.toBe(first.value.fingerprint)

    const again = await service.openFile(projectPath())
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.value.snapshot.project.name).toBe('第二次保存')
  })

  it('未保存过的新会话直接 save 被拒绝，必须另存为', async () => {
    const service = newService()
    const { sessionId } = await openSample(service)
    const result = await service.save(sessionId, { editSeq: 0, expectedFingerprint: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_REQUEST')
  })

  it('stage 序号必须严格递增，非法序号与跨项目聚合被拒绝', async () => {
    const service = newService()
    const { sessionId, snapshot } = await openSample(service)

    const zero = (await service.stage(sessionId, 0, snapshot))
    expect(zero.ok).toBe(false)
    if (!zero.ok) expect(zero.error.code).toBe('STALE_EDIT')

    const negative = (await service.stage(sessionId, -1, snapshot))
    expect(negative.ok).toBe(false)
    if (!negative.ok) expect(negative.error.code).toBe('INVALID_REQUEST')

    const fractional = (await service.stage(sessionId, 1.5, snapshot))
    expect(fractional.ok).toBe(false)
    if (!fractional.ok) expect(fractional.error.code).toBe('INVALID_REQUEST')

    const otherProject = (await service.stage(sessionId, 1, {
      ...snapshot,
      project: { ...snapshot.project, id: 'other-project' },
    }))
    expect(otherProject.ok).toBe(false)
    if (!otherProject.ok) expect(otherProject.error.code).toBe('INVALID_REQUEST')

    expect((await service.stage(sessionId, 1, snapshot)).ok).toBe(true)
  })

  it('保存的 editSeq 与已接受序号不一致时返回 STALE_EDIT', async () => {
    const service = newService()
    const { sessionId, snapshot } = await openSample(service)
    await service.saveAs(sessionId, {
      editSeq: 0,
      expectedFingerprint: null,
      targetPath: projectPath(),
    })
    await service.stage(sessionId, 2, snapshot)
    const result = await service.save(sessionId, { editSeq: 1, expectedFingerprint: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STALE_EDIT')
  })

  it('磁盘文件被外部修改后保存返回 EXTERNAL_MODIFIED，且不覆盖外部内容', async () => {
    const service = newService()
    const { sessionId } = await openSample(service)
    const first = await service.saveAs(sessionId, {
      editSeq: 0,
      expectedFingerprint: null,
      targetPath: projectPath(),
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const reopened = await service.openFile(projectPath())
    if (!reopened.ok) throw new Error('reopen failed')
    const session = service.getSession(reopened.value.sessionId)
    const snapshot = session?.snapshot as ProjectFileSnapshot
    (await service.stage(reopened.value.sessionId, 1, {
      ...snapshot,
      project: { ...snapshot.project, name: '本地修改' },
    }))

    const externalBytes = new TextEncoder().encode('external edit')
    await fsp.writeFile(projectPath(), externalBytes)

    const result = await service.save(reopened.value.sessionId, {
      editSeq: 1,
      expectedFingerprint: reopened.value.fingerprint,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('EXTERNAL_MODIFIED')
    expect(await fsp.readFile(projectPath(), 'utf8')).toBe('external edit')
  })

  it('另存为覆盖已有文件需要当前指纹确认', async () => {
    const service = newService()
    const { sessionId } = await openSample(service)
    await service.saveAs(sessionId, {
      editSeq: 0,
      expectedFingerprint: null,
      targetPath: projectPath('a'),
    })
    // 复制一个已存在的目标来模拟“用户选了一个已有文件”。
    await fsp.copyFile(projectPath('a'), projectPath('b'))
    const existingFingerprint = await new FileStore().fingerprint(projectPath('b'))

    const blocked = await service.saveAs(sessionId, {
      editSeq: 0,
      expectedFingerprint: null,
      targetPath: projectPath('b'),
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error.code).toBe('EXTERNAL_MODIFIED')

    const confirmed = await service.saveAs(sessionId, {
      editSeq: 0,
      expectedFingerprint: null,
      targetPath: projectPath('b'),
      overwriteFingerprint: existingFingerprint,
    })
    expect(confirmed.ok).toBe(true)
  })

  it('并发保存被串行化：底层写入不重叠', async () => {
    let active = 0
    let maxActive = 0
    const delayingOps: FileOps = {
      ...nodeFileOps,
      writeExclusive: async (filePath, bytes) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 30))
        try {
          await nodeFileOps.writeExclusive(filePath, bytes)
        } finally {
          active -= 1
        }
      },
    }
    const service = newService({ store: new FileStore({ ops: delayingOps }) })
    const { sessionId } = await openSample(service)

    const [first, second] = await Promise.all([
      service.saveAs(sessionId, {
        editSeq: 0,
        expectedFingerprint: null,
        targetPath: projectPath('one'),
      }),
      service.saveAs(sessionId, {
        editSeq: 0,
        expectedFingerprint: null,
        targetPath: projectPath('two'),
      }),
    ])
    expect(maxActive).toBe(1)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    const [one, two] = await Promise.all([
      service.openFile(projectPath('one')),
      service.openFile(projectPath('two')),
    ])
    expect(one.ok).toBe(true)
    expect(two.ok).toBe(true)
  })

  it('损坏文件打开失败时不建立会话', async () => {
    const service = newService()
    const broken = projectPath('broken')
    await fsp.writeFile(broken, 'not a zip')
    const result = await service.openFile(broken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_ZIP')
    expect(service.getSession('session-1')).toBeNull()
  })
})
