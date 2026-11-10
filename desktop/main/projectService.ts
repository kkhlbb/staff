/**
 * 项目文件会话服务（A-02 纯部分）。
 *
 * 只负责：
 * - 打开 `.cunlian`：读取字节 → 完整解码校验 → 建立 main 侧会话（持有附件字节）；
 * - stage：接受 renderer 的编辑序号与聚合副本，序号必须严格递增；
 * - save / saveAs：与序号对齐后用 fileStore 原子保存，成功后更新路径/指纹。
 *
 * 不负责（A-04）：dirty gate 三选、恢复草稿、最近项目、IPC 注册、对话框。
 * 附件字节永远留在 main；返回给 renderer 的是去掉 attachments 的 DTO。
 */
import { randomUUID } from 'node:crypto'
import { decodeProjectFile, encodeProjectFile, toSnapshotDto } from '../../src/project-file/codec'
import { assembleSnapshot } from '../../src/project-file/validation'
import { upgradeSnapshotToV2 } from '../../src/project-file/upgrade'
import type {
  ProjectFileDrawingRecord,
  ProjectFileSnapshot,
  ProjectFileSpacerParameter,
} from '../../src/project-file/types'
import { PROJECT_FILE_SCHEMA_VERSION } from '../../src/project-file/types'
import type { IpcErrorCode, IpcErrorPayload, IpcResult } from '../shared/contracts'
import { FileStore, type SaveError } from './fileStore'
import {
  createMigrationBackup,
  migrationBackupNotice,
  type MigrationBackupRecord,
} from './migrationBackup'

export type SnapshotDto = ReturnType<typeof toSnapshotDto>

export interface ProjectSession {
  sessionId: string
  /** renderer 已提交的最高编辑序号。 */
  acceptedSeq: number
  /** 已成功落盘的编辑序号；dirty 由 A-04 根据它与 acceptedSeq 判定。 */
  savedSeq: number
  path: string | null
  fingerprint: string | null
  snapshot: ProjectFileSnapshot
  /**
   * 打开时磁盘项目的 schema 版本（manifest 声明）。< 7 表示首次正式写盘
   * 需要先创建可恢复副本；保存成功后置为当前版本。
   */
  sourceProjectSchemaVersion: number
  /** 本会话已创建的迁移前副本；null 表示尚未创建或无需创建。 */
  migrationBackup: MigrationBackupRecord | null
}

export interface OpenResult {
  sessionId: string
  editSeq: 0
  snapshot: SnapshotDto
  path: string | null
  fingerprint: string | null
}

export interface SaveValue {
  path: string
  fingerprint: string
  savedSeq: number
  warnings: string[]
}

export interface SaveRequest {
  editSeq: number
  expectedFingerprint: string | null
}

export interface SaveAsRequest extends SaveRequest {
  targetPath: string
  /** 覆盖已存在目标必须给出其当前指纹（A-04 对话框确认后传入）。 */
  overwriteFingerprint?: string | null
}

export interface CommitCandidateRequest {
  baseEditSeq: number
  candidate: ProjectFileSnapshot
  /** 无会话路径时由 main 对话框选定的目标；有路径时忽略。 */
  targetPath?: string | null
  overwriteFingerprint?: string | null
  /** 返回非 null 即拒绝提交（rename 前仍会再次调用）。 */
  guard: () => string | null
}

export interface CommitCandidateValue {
  acceptedSeq: number
  path: string
  fingerprint: string
  warnings: string[]
}

export interface ProjectServiceOptions {
  store?: FileStore
  newSessionId?: () => string
  now?: () => Date
  newBackupSuffix?: () => string
}

function ipcFailure(code: IpcErrorCode, message: string, detail?: string): IpcResult<never> {
  const error: IpcErrorPayload =
    detail === undefined ? { code, message } : { code, message, detail }
  return { ok: false, error }
}

function fromSaveError(error: SaveError): IpcResult<never> {
  return { ok: false, error: { code: error.code, message: error.message, detail: error.detail } }
}

export class ProjectService {
  private readonly store: FileStore
  private readonly newSessionId: () => string
  private readonly now: () => Date
  private readonly newBackupSuffix: () => string
  private readonly sessions = new Map<string, ProjectSession>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(options: ProjectServiceOptions = {}) {
    this.store = options.store ?? new FileStore()
    this.newSessionId = options.newSessionId ?? (() => randomUUID())
    this.now = options.now ?? (() => new Date())
    this.newBackupSuffix =
      options.newBackupSuffix ?? (() => randomUUID().replace(/-/g, '').slice(0, 16))
  }

  getSession(sessionId: string): ProjectSession | null {
    return this.sessions.get(sessionId) ?? null
  }

  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.queues.delete(sessionId)
  }

  /** dirty gate 用：存在已接受但未成功落盘的编辑即视为有未保存工作。 */
  dirtySessionCount(): number {
    let count = 0
    for (const session of this.sessions.values()) {
      if (session.acceptedSeq > session.savedSeq) {
        count += 1
      }
    }
    return count
  }

  /** 打开并完整校验项目文件；失败不创建会话。 */
  async openFile(targetPath: string): Promise<IpcResult<OpenResult>> {
    const read = await this.store.readProjectFile(targetPath)
    if (!read.ok) {
      return fromSaveError(read.error)
    }
    return this.openBytes(read.value.bytes, targetPath, read.value.fingerprint)
  }

  /** 用已读入的字节建立会话（供测试与后续迁移复用）。 */
  async openBytes(
    bytes: Uint8Array,
    targetPath: string | null,
    fingerprint: string | null,
  ): Promise<IpcResult<OpenResult>> {
    const decoded = await decodeProjectFile(bytes)
    if (!decoded.ok) {
      return ipcFailure(decoded.error.code, decoded.error.message, decoded.error.detail)
    }
    return this.adoptSnapshot(
      decoded.value.snapshot,
      targetPath,
      fingerprint,
      decoded.value.manifest.project.projectSchemaVersion,
    )
  }

  /**
   * 用 main 已构造/已校验的内存聚合建立会话（新建项目、恢复草稿）。
   * 不写磁盘；附件字节继续由 main 持有。
   *
   * `sourceProjectSchemaVersion` 记录磁盘来源版本：< 7 时首次覆盖写盘前必须
   * 创建可恢复副本（新建/恢复的内存项目默认已是当前 schema）。
   */
  adoptSnapshot(
    snapshot: ProjectFileSnapshot,
    targetPath: string | null,
    fingerprint: string | null,
    sourceProjectSchemaVersion: number = PROJECT_FILE_SCHEMA_VERSION,
  ): IpcResult<OpenResult> {
    const sessionId = this.newSessionId()
    const session: ProjectSession = {
      sessionId,
      acceptedSeq: 0,
      savedSeq: 0,
      path: null,
      fingerprint: null,
      snapshot,
      sourceProjectSchemaVersion,
      migrationBackup: null,
    }
    if (targetPath !== null && fingerprint !== null) {
      session.path = targetPath
      session.fingerprint = fingerprint
    }
    this.sessions.set(sessionId, session)
    return {
      ok: true,
      value: {
        sessionId,
        editSeq: 0,
        snapshot: toSnapshotDto(session.snapshot),
        path: session.path,
        fingerprint: session.fingerprint,
      },
    }
  }

  /**
   * 接受 renderer 的编辑副本。
   *
   * 序号必须严格大于已接受序号；草稿字段可以含无效数值字符串，但结构、引用
   * 与附件元数据必须自洽（允许缺字节声明）。main 这里不做落盘。
   */
  stage(
    sessionId: string,
    editSeq: number,
    snapshot: ProjectFileSnapshot,
  ): IpcResult<{ acceptedSeq: number }> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      return ipcFailure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    if (!Number.isSafeInteger(editSeq) || editSeq < 0) {
      return ipcFailure('INVALID_REQUEST', 'editSeq 必须是非负安全整数')
    }
    if (editSeq <= session.acceptedSeq) {
      return ipcFailure(
        'STALE_EDIT',
        '编辑序号未递增，已拒绝',
        `acceptedSeq=${session.acceptedSeq}, editSeq=${editSeq}`,
      )
    }
    if (snapshot.project.id !== session.snapshot.project.id) {
      return ipcFailure('INVALID_REQUEST', '提交的聚合属于其它项目')
    }
    session.snapshot = snapshot
    session.acceptedSeq = editSeq
    return { ok: true, value: { acceptedSeq: editSeq } }
  }

  /**
   * 接受 renderer 的非附件 DTO（A-04 IPC 入口）。
   *
   * 与 `stage` 的区别：附件字节只取 main 已持有的副本，renderer 不能注入
   * 新字节或路径；manifestMeta（writer/createdAt/迁移来源）也以 main 为准。
   * 其余部分走与打开/保存同一套 `assembleSnapshot` 结构、引用与数量校验，
   * 允许草稿字段是无效数值字符串，但结构必须合法。
   */
  stageFromDto(
    sessionId: string,
    editSeq: number,
    dto: Omit<ProjectFileSnapshot, 'attachments'>,
  ): IpcResult<{ acceptedSeq: number }> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      return ipcFailure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    if (!Number.isSafeInteger(editSeq) || editSeq < 0) {
      return ipcFailure('INVALID_REQUEST', 'editSeq 必须是非负安全整数')
    }
    if (editSeq <= session.acceptedSeq) {
      return ipcFailure(
        'STALE_EDIT',
        '编辑序号未递增，已拒绝',
        `acceptedSeq=${session.acceptedSeq}, editSeq=${editSeq}`,
      )
    }
    if (typeof dto !== 'object' || dto === null) {
      return ipcFailure('INVALID_REQUEST', '快照必须是对象')
    }
    // 权威字段由 main 保护：模型/版本/关联/文件版本/当前版本/来源格式
    // 只能通过 model:commit/link 或 main 的升级流程变更，stageDraft 不能
    // 伪造模型、篡改旧版本、自行确认 pending，或把已升级的项目退回格式 1。
    const authoritative = session.snapshot
    const protectedProject = {
      ...(dto.project as unknown as Record<string, unknown>),
      sourceFormatVersion: authoritative.project.sourceFormatVersion,
      currentRevisionId: authoritative.project.currentRevisionId,
      parts: authoritative.project.parts,
      modelRevisions: authoritative.project.modelRevisions,
      dimensionLinks: authoritative.project.dimensionLinks,
      // C 的三参数与图纸引用同样只能经 drawing:update-spacer 事务改动，
      // stageDraft 不能伪造参数、图纸指纹或复核状态。
      parameters: authoritative.project.parameters,
      drawings: authoritative.project.drawings,
      // V3.6：提取候选与逐条决定只能经 extraction:run/decide 写入；
      // stageDraft 不能伪造“已确认”、决定时间或出处。
      extractionDrafts: authoritative.project.extractionDrafts,
    }
    const assembled = assembleSnapshot({
      project: protectedProject,
      draft: dto.draft,
      documents: dto.documents,
      revisions: dto.revisions,
      bindings: dto.bindings,
      blobs: dto.blobs,
      events: dto.events,
      analysisSnapshots: dto.analysisSnapshots,
      importSnapshots: dto.importSnapshots,
      migrationBackups: dto.migrationBackups,
      legacyArchive: dto.legacyArchive,
      fileRevisions: authoritative.fileRevisions,
      // 附件字节只能来自 main 已持有的副本。
      attachments: session.snapshot.attachments,
      missingAttachments: dto.missingAttachments,
      snapshotReferences: dto.snapshotReferences,
      // 写者身份与迁移来源由 main 维护，renderer 不能改写。
      manifestMeta: session.snapshot.manifestMeta,
    })
    if (!assembled.ok) {
      return ipcFailure(assembled.error.code, assembled.error.message, assembled.error.detail)
    }
    if (assembled.value.project.id !== session.snapshot.project.id) {
      return ipcFailure('INVALID_REQUEST', '提交的聚合属于其它项目')
    }
    // D：已绑定参数的组成环只允许通过参数联动确认改 nominal；renderer 不能
    // 借普通 stage 绕过参数（也就不会出现“环改了、参数没改”的第二真源）。
    const boundTerms = new Set(
      authoritative.project.dimensionLinks.flatMap((link) =>
        link.kind === 'parameter-binding' ? [link.termId] : [],
      ),
    )
    if (boundTerms.size > 0) {
      for (const term of assembled.value.project.dimensionChain.terms) {
        const before = authoritative.project.dimensionChain.terms.find((item) => item.id === term.id)
        if (before !== undefined && boundTerms.has(term.id) && before.nominalQ !== term.nominalQ) {
          return ipcFailure(
            'INVALID_BINDING',
            '该组成环已绑定参数：请编辑参数或先解除绑定，不能直接改 nominal',
            `termId=${term.id}`,
          )
        }
      }
    }
    session.snapshot = assembled.value
    session.acceptedSeq = editSeq
    return { ok: true, value: { acceptedSeq: editSeq } }
  }

  /**
   * C：原子接纳隔套参数与图纸引用。
   *
   * 两项在同一个 main 事务里替换，失败不改任何一项；`baseEditSeq` 必须等于
   * 当前 acceptedSeq，成功后序号 +1。调用方（drawing:update-spacer）负责先用
   * 同一 DrawingData 生成器重建并校验指纹。
   */
  applySpacerDrawing(
    sessionId: string,
    baseEditSeq: number,
    parameters: ProjectFileSpacerParameter[],
    drawing: ProjectFileDrawingRecord,
  ): IpcResult<{ acceptedSeq: number }> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      return ipcFailure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    if (!Number.isSafeInteger(baseEditSeq) || baseEditSeq < 0) {
      return ipcFailure('INVALID_REQUEST', 'baseEditSeq 必须是非负安全整数')
    }
    if (baseEditSeq !== session.acceptedSeq) {
      return ipcFailure(
        'STALE_EDIT',
        '图纸编辑序号已过期，请基于最新状态重试',
        `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${baseEditSeq}`,
      )
    }
    if (drawing.partId !== parameters[0]?.partId) {
      return ipcFailure('INVALID_DRAWING', '图纸与参数不属于同一部件')
    }
    const nextSeq = baseEditSeq + 1
    // 先构造完整的新快照再一次性赋值；中途没有可观察的半更新状态。
    session.snapshot = {
      ...session.snapshot,
      project: {
        ...session.snapshot.project,
        parameters,
        drawings: [drawing],
      },
    }
    session.acceptedSeq = nextSeq
    return { ok: true, value: { acceptedSeq: nextSeq } }
  }

  /**
   * D：一次原子提交完整候选聚合。
   *
   * 与 save 的区别：候选不是 renderer DTO，而是 main 已构造并自校验的完整聚合；
   * 磁盘成功后一次性发布内存状态。`guard` 在临时文件回读后、rename 前再次执行，
   * 用于挡住 await 编码/校验期间的基准/草稿竞态（返回非 null 即拒绝）。
   */
  async commitCandidate(
    sessionId: string,
    request: CommitCandidateRequest,
  ): Promise<IpcResult<CommitCandidateValue>> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      return ipcFailure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    if (!Number.isSafeInteger(request.baseEditSeq) || request.baseEditSeq < 0) {
      return ipcFailure('INVALID_REQUEST', 'baseEditSeq 必须是非负安全整数')
    }
    if (request.baseEditSeq !== session.acceptedSeq) {
      return ipcFailure(
        'STALE_EDIT',
        '提交基准已过期，请重新预览',
        `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${request.baseEditSeq}`,
      )
    }
    const guarded = request.guard()
    if (guarded !== null) {
      return ipcFailure('STALE_BASE', '提交前基准已变化，已拒绝', guarded)
    }
    const encoded = await encodeProjectFile(request.candidate)
    if (!encoded.ok) {
      return ipcFailure(
        encoded.error.code,
        `无法生成合法的项目文件：${encoded.error.message}`,
        encoded.error.detail,
      )
    }
    const targetPath = session.path ?? request.targetPath ?? null
    if (targetPath === null) {
      return ipcFailure('INVALID_REQUEST', '当前项目尚未保存过，需要先选择保存位置')
    }
    // 旧 schema 文件被覆盖前先留可恢复副本；失败即阻止提交，原文件不变。
    const backup = await this.ensureMigrationBackup(session, targetPath)
    if (!backup.ok) {
      return ipcFailure(backup.error.code, backup.error.message, backup.error.detail)
    }
    const warnings = backup.value === null ? [] : [migrationBackupNotice(backup.value)]
    const overwriteFingerprint =
      session.path === null
        ? (request.overwriteFingerprint ?? (await this.store.fingerprint(targetPath)))
        : session.fingerprint

    const saved = await this.store.saveAtomic({
      targetPath,
      bytes: encoded.value.bytes,
      expectedFingerprint: overwriteFingerprint,
      verify: async (bytes) => {
        const late = request.guard()
        if (late !== null) {
          return { ok: false, code: 'STALE_BASE', message: late }
        }
        const decoded = await decodeProjectFile(bytes)
        if (!decoded.ok) {
          return {
            ok: false,
            code: decoded.error.code,
            message: decoded.error.message,
            detail: decoded.error.detail,
          }
        }
        if (decoded.value.snapshot.project.id !== session.snapshot.project.id) {
          return { ok: false, code: 'INVALID_RECORD', message: '自校验读到的项目 ID 不一致' }
        }
        if (decoded.value.snapshot.project.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION) {
          return { ok: false, code: 'INVALID_RECORD', message: '自校验读到的项目 schema 不是当前版本' }
        }
        return { ok: true }
      },
    })
    if (!saved.ok) {
      return fromSaveError(saved.error)
    }

    // 磁盘是提交点；这里一次性发布完整内存聚合，不再安排可能失败的业务写入。
    session.snapshot = request.candidate
    session.path = saved.value.path
    session.fingerprint = saved.value.fingerprint
    session.acceptedSeq = request.baseEditSeq + 1
    session.savedSeq = session.acceptedSeq
    session.sourceProjectSchemaVersion = PROJECT_FILE_SCHEMA_VERSION
    if (backup.value !== null) session.migrationBackup = backup.value
    return {
      ok: true,
      value: {
        acceptedSeq: session.acceptedSeq,
        path: saved.value.path,
        fingerprint: saved.value.fingerprint,
        warnings: [...warnings, ...saved.value.warnings],
      },
    }
  }

  /** 读取磁盘指纹（不创建会话）；供 dirty gate 的另存覆盖确认与 relink 使用。 */
  async fingerprint(targetPath: string): Promise<string | null> {
    return this.store.fingerprint(targetPath)
  }

  /**
   * 迁移前副本：仅在“即将覆盖打开时的旧 schema 文件”时创建一次。
   * 写入新目标时原文件仍留在原路径，本身就是恢复来源，不重复复制。
   * 失败一律阻止升级（返回错误，原文件保持不变）。
   */
  private async ensureMigrationBackup(
    session: ProjectSession,
    targetPath: string,
  ): Promise<IpcResult<MigrationBackupRecord | null>> {
    if (session.migrationBackup !== null) {
      return { ok: true, value: session.migrationBackup }
    }
    if (session.sourceProjectSchemaVersion >= PROJECT_FILE_SCHEMA_VERSION) {
      return { ok: true, value: null }
    }
    if (session.path === null || targetPath !== session.path) {
      return { ok: true, value: null }
    }
    const backup = await createMigrationBackup({
      ops: this.store.fileOps,
      originalPath: targetPath,
      expectedFingerprint: session.fingerprint,
      now: this.now,
      newSuffix: this.newBackupSuffix,
    })
    if (!backup.ok) {
      return ipcFailure(backup.error.code, backup.error.message, backup.error.detail)
    }
    return { ok: true, value: backup.value }
  }

  /** 只判断目标文件类型（不读内容）。 */
  async kindOf(targetPath: string): Promise<'missing' | 'file' | 'directory' | 'symlink' | 'other'> {
    return this.store.kindOf(targetPath)
  }

  /** 读取项目文件字节与指纹；失败不创建会话。 */
  async readProjectBytes(
    targetPath: string,
  ): Promise<IpcResult<{ bytes: Uint8Array; fingerprint: string }>> {
    const read = await this.store.readProjectFile(targetPath)
    if (!read.ok) {
      return fromSaveError(read.error)
    }
    return { ok: true, value: read.value }
  }

  /** 保存到会话已有路径；没有路径时必须走 saveAs。 */
  async save(sessionId: string, request: SaveRequest): Promise<IpcResult<SaveValue>> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      return ipcFailure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    if (session.path === null) {
      return ipcFailure('INVALID_REQUEST', '当前项目尚未保存过，请使用另存为')
    }
    return this.enqueue(sessionId, async () => {
      const checked = this.checkSaveRequest(session, request, true)
      if (!checked.ok) {
        return checked
      }
      return this.writeSnapshot(session, session.path as string, request, session.fingerprint)
    })
  }

  /** 另存为：目标必须显式给出；覆盖已有文件必须带其当前指纹。 */
  async saveAs(sessionId: string, request: SaveAsRequest): Promise<IpcResult<SaveValue>> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      return ipcFailure('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    return this.enqueue(sessionId, async () => {
      const checked = this.checkSaveRequest(session, request, false)
      if (!checked.ok) {
        return checked
      }
      const existing = await this.store.fingerprint(request.targetPath)
      if (existing !== null && existing !== request.overwriteFingerprint) {
        return ipcFailure(
          'EXTERNAL_MODIFIED',
          '目标文件已存在，需要确认覆盖',
          `targetFingerprint=${existing}`,
        )
      }
      return this.writeSnapshot(
        session,
        request.targetPath,
        request,
        existing,
      )
    })
  }

  private checkSaveRequest(
    session: ProjectSession,
    request: SaveRequest,
    requireSessionFingerprint: boolean,
  ): IpcResult<null> {
    if (!Number.isSafeInteger(request.editSeq) || request.editSeq < 0) {
      return ipcFailure('INVALID_REQUEST', 'editSeq 必须是非负安全整数')
    }
    if (request.editSeq !== session.acceptedSeq) {
      return ipcFailure(
        'STALE_EDIT',
        '保存的编辑序号与已接受序号不一致',
        `acceptedSeq=${session.acceptedSeq}, editSeq=${request.editSeq}`,
      )
    }
    // 另存为写入的是新目标，不要求与当前会话磁盘指纹一致；覆盖确认由
    // saveAs 的目标指纹逻辑负责。
    if (requireSessionFingerprint && request.expectedFingerprint !== session.fingerprint) {
      return ipcFailure(
        'EXTERNAL_MODIFIED',
        '磁盘指纹与打开时不一致，请重新打开或另存为',
        `expected=${request.expectedFingerprint ?? 'null'}, session=${
          session.fingerprint ?? 'null'
        }`,
      )
    }
    return { ok: true, value: null }
  }

  private async writeSnapshot(
    session: ProjectSession,
    targetPath: string,
    request: SaveRequest,
    overwriteFingerprint: string | null,
  ): Promise<IpcResult<SaveValue>> {
    // 首次保存旧格式项目：显式升级并在保存成功后写回会话；失败不改变会话。
    const upgrade = upgradeSnapshotToV2(session.snapshot, {
      newRevisionId: () => `rev-${randomUUID()}`,
    })
    const encoded = await encodeProjectFile(upgrade.snapshot)
    if (!encoded.ok) {
      return ipcFailure(
        encoded.error.code,
        `无法生成合法的项目文件：${encoded.error.message}`,
        encoded.error.detail,
      )
    }

    // 迁移写盘屏障：覆盖旧 schema 原文件前先留可恢复副本；失败阻止升级。
    let backupRecord: MigrationBackupRecord | null = null
    if (upgrade.upgraded) {
      const backup = await this.ensureMigrationBackup(session, targetPath)
      if (!backup.ok) {
        return ipcFailure(backup.error.code, backup.error.message, backup.error.detail)
      }
      backupRecord = backup.value
    }
    const previousPath = session.path

    const saved = await this.store.saveAtomic({
      targetPath,
      bytes: encoded.value.bytes,
      expectedFingerprint: overwriteFingerprint,
      verify: async (bytes) => {
        const decoded = await decodeProjectFile(bytes)
        if (!decoded.ok) {
          return {
            ok: false,
            code: decoded.error.code,
            message: decoded.error.message,
            detail: decoded.error.detail,
          }
        }
        if (decoded.value.snapshot.project.id !== session.snapshot.project.id) {
          return {
            ok: false,
            code: 'INVALID_RECORD',
            message: '自校验读到的项目 ID 与当前会话不一致',
          }
        }
        if (decoded.value.manifest.formatVersion !== 2) {
          return {
            ok: false,
            code: 'INVALID_RECORD',
            message: '自校验读到的文件格式不是 2',
          }
        }
        return { ok: true }
      },
    })
    if (!saved.ok) {
      return fromSaveError(saved.error)
    }

    session.snapshot = upgrade.snapshot
    session.path = saved.value.path
    session.fingerprint = saved.value.fingerprint
    session.savedSeq = request.editSeq
    session.sourceProjectSchemaVersion = PROJECT_FILE_SCHEMA_VERSION
    if (backupRecord !== null) session.migrationBackup = backupRecord
    const warnings = [...saved.value.warnings]
    if (backupRecord !== null) {
      warnings.push(migrationBackupNotice(backupRecord))
    } else if (
      upgrade.upgraded &&
      previousPath !== null &&
      previousPath !== saved.value.path
    ) {
      const originalReadable = (await this.store.fingerprint(previousPath)) !== null
      warnings.push(
        originalReadable
          ? `另存升级：原文件 ${previousPath} 保留为恢复来源（已回读确认可读）。`
          : `另存升级：原文件 ${previousPath} 未能回读确认，请自行核对可恢复性。`,
      )
    }
    if (upgrade.upgraded && upgrade.notice !== null) {
      warnings.push(upgrade.notice)
    }
    return {
      ok: true,
      value: {
        path: saved.value.path,
        fingerprint: saved.value.fingerprint,
        savedSeq: request.editSeq,
        warnings,
      },
    }
  }

  /** 同一会话的保存串行化；排队等待不返回 BUSY。 */
  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.queues.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }
}
