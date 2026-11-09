/**
 * V2 迁移的主进程服务（A-03）。
 *
 * 职责：
 * - `migration:inspect`：只读读取输入 → 纯校验 → 生成 10 分钟有效的 importToken；
 *   token 绑定窗口、原始字节与 SHA-256、候选项目清单，不写当前会话/磁盘。
 * - `migration:commit`：校验 token 与项目 → dirty gate → 另存目标（必须新
 *   `.cunlian`、不得覆盖输入）→ 纯转换 → 编码自校验 → 原子落盘回读成功后才
 *   建立会话。任何提交前失败：当前会话、编辑序号、dirty、附件与磁盘都不变，
 *   不留下半成品文件。
 *
 * 不负责（A-04）：dirty 三选对话框、活动会话切换、最近项目索引。这里通过
 * 注入的 `dirtyGate` 与 `ProjectService` 暴露真实边界，测试可注入故障。
 */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { decodeProjectFile, encodeProjectFile } from '../../src/project-file/codec'
import {
  inspectV2Bundle,
  inspectV2Json,
  migrateV2Bundle,
  migrateV2Json,
  type V2Inspection,
} from '../../src/project-file/migrateV2'
import type { ProjectFileError } from '../../src/project-file/types'
import type { OpenResult, ProjectService } from './projectService'
import { FileStore, type SaveError } from './fileStore'
import { IpcFailure } from './ipc'

export const MIGRATION_TOKEN_TTL_MS = 10 * 60 * 1000
export const MIGRATION_BUNDLE_MAX_BYTES = 150 * 1024 * 1024
export const MIGRATION_JSON_MAX_BYTES = 1024 * 1024

export type MigrationKind = 'bundle' | 'json'

export interface MigrationInput {
  /** 真实读取的源路径；只用于拒绝“另存覆盖输入”，不随项目文件携带。 */
  path: string
  bytes: Uint8Array
}

export interface MigrationInspectRequest {
  kind: MigrationKind
}

export interface MigrationPreviewProject {
  id: string
  name: string
  attachmentCount: number
  missingItems: number
}

export interface MigrationInspectValue {
  importToken: string
  projects: MigrationPreviewProject[]
  warnings: string[]
}

export interface MigrationCommitRequest {
  importToken: string
  projectId: string
}

export interface MigrationCommitValue extends OpenResult {
  warnings: string[]
}

export interface MigrationDeps {
  projectService: ProjectService
  /** 对话框授权只读输入；取消返回 null。生产实现见 desktop/main/index.ts。 */
  pickInput: (kind: MigrationKind) => Promise<MigrationInput | null>
  /** 另存对话框；取消返回 null。 */
  pickTarget: (suggestedName: string) => Promise<string | null>
  /** dirty gate：proceed 才允许迁移；生产实现由 A-04 补“保存/不保存/取消”。 */
  dirtyGate?: () => Promise<'proceed' | 'cancel'>
  store?: FileStore
  now?: () => number
  newToken?: () => string
  appVersion?: string
  electronVersion?: string
}

interface ImportTokenRecord {
  windowId: number
  kind: MigrationKind
  sourcePath: string
  sourceSha256: string
  bytes: Uint8Array
  inspection: V2Inspection
  expiresAt: number
}

function fromProjectFileError(error: ProjectFileError): IpcFailure {
  return new IpcFailure(error.code, error.message, error.detail)
}

function fromSaveError(error: SaveError): IpcFailure {
  return new IpcFailure(error.code, error.message, error.detail)
}

export class MigrationService {
  private readonly deps: MigrationDeps
  private readonly store: FileStore
  private readonly now: () => number
  private readonly newToken: () => string
  private readonly tokens = new Map<string, ImportTokenRecord>()

  constructor(deps: MigrationDeps) {
    this.deps = deps
    this.store = deps.store ?? new FileStore()
    this.now = deps.now ?? (() => Date.now())
    this.newToken = deps.newToken ?? (() => randomUUID())
  }

  /** 只读预检：不写当前会话、不落盘；token 绑定窗口与原始字节。 */
  async inspect(
    windowId: number,
    request: MigrationInspectRequest,
  ): Promise<MigrationInspectValue> {
    const input = await this.deps.pickInput(request.kind)
    if (input === null) {
      throw new IpcFailure('CANCELLED', '已取消选择迁移输入')
    }
    const maxBytes =
      request.kind === 'bundle' ? MIGRATION_BUNDLE_MAX_BYTES : MIGRATION_JSON_MAX_BYTES
    if (input.bytes.byteLength === 0) {
      throw new IpcFailure('READ_FAILED', '迁移输入为空文件')
    }
    if (input.bytes.byteLength > maxBytes) {
      throw new IpcFailure(
        'TOO_LARGE',
        request.kind === 'bundle'
          ? '完整备份不得超过 150 MiB'
          : '项目 JSON 不得超过 1 MiB',
        `${input.bytes.byteLength} 字节`,
      )
    }

    const inspected =
      request.kind === 'bundle'
        ? await inspectV2Bundle(input.bytes)
        : await inspectV2Json(input.bytes)
    if (!inspected.ok) {
      throw fromProjectFileError(inspected.error)
    }

    const token = this.newToken()
    this.tokens.set(token, {
      windowId,
      kind: request.kind,
      sourcePath: input.path,
      sourceSha256: inspected.value.sourceSha256,
      // 冻结字节：提交时不再读源文件，避免校验后被替换。
      bytes: input.bytes,
      inspection: inspected.value,
      expiresAt: this.now() + MIGRATION_TOKEN_TTL_MS,
    })
    this.pruneExpired()

    return {
      importToken: token,
      projects: inspected.value.projects.map((project) => ({
        id: project.id,
        name: project.name,
        attachmentCount: project.attachmentCount,
        missingItems: project.missingItems,
      })),
      warnings: inspected.value.warnings,
    }
  }

  /** 预检 → dirty gate → 另存 → 原子提交并回读成功后才建立会话。 */
  async commit(
    windowId: number,
    request: MigrationCommitRequest,
  ): Promise<MigrationCommitValue> {
    const token = this.tokens.get(request.importToken)
    if (token === undefined || token.windowId !== windowId) {
      throw new IpcFailure('STALE_IMPORT', '迁移预检已失效，请重新选择输入')
    }
    if (this.now() > token.expiresAt) {
      this.tokens.delete(request.importToken)
      throw new IpcFailure('STALE_IMPORT', '迁移预检已超过 10 分钟，请重新选择输入')
    }
    const candidate = token.inspection.projects.find(
      (project) => project.id === request.projectId,
    )
    if (candidate === undefined) {
      throw new IpcFailure('INVALID_REQUEST', '所选项目不在本次预检结果中')
    }

    if (this.deps.dirtyGate !== undefined) {
      const verdict = await this.deps.dirtyGate()
      if (verdict !== 'proceed') {
        throw new IpcFailure('CANCELLED', '当前项目有未保存编辑，迁移已取消')
      }
    }

    const suggested = `${sanitizeFileName(candidate.name)}.cunlian`
    const targetPath = await this.deps.pickTarget(suggested)
    if (targetPath === null) {
      throw new IpcFailure('CANCELLED', '已取消选择另存位置')
    }
    this.checkTarget(targetPath, token.sourcePath)
    if ((await this.store.fingerprint(targetPath)) !== null) {
      throw new IpcFailure('INVALID_REQUEST', '另存目标必须是不存在的新文件，不能覆盖已有文件')
    }

    const migrated =
      token.kind === 'bundle'
        ? await migrateV2Bundle(
            { bytes: token.bytes, projectId: request.projectId },
            {
              appVersion: this.deps.appVersion,
              electronVersion: this.deps.electronVersion,
            },
          )
        : await migrateV2Json(token.bytes, {
            appVersion: this.deps.appVersion,
            electronVersion: this.deps.electronVersion,
          })
    if (!migrated.ok) {
      throw fromProjectFileError(migrated.error)
    }
    if (migrated.value.snapshot.project.id !== request.projectId) {
      throw new IpcFailure('INVALID_REQUEST', '迁移结果的项目与所选项目不一致')
    }

    const encoded = await encodeProjectFile(migrated.value.snapshot)
    if (!encoded.ok) {
      throw fromProjectFileError(encoded.error)
    }

    const expectedProjectId = migrated.value.snapshot.project.id
    const saved = await this.store.saveAtomic({
      targetPath,
      bytes: encoded.value.bytes,
      // 目标必须是新文件；已存在一律拒绝，绝不覆盖用户文件。
      expectedFingerprint: null,
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
        if (decoded.value.snapshot.project.id !== expectedProjectId) {
          return {
            ok: false,
            code: 'INVALID_RECORD',
            message: '自校验读到的项目 ID 与迁移结果不一致',
          }
        }
        return { ok: true }
      },
    })
    if (!saved.ok) {
      throw fromSaveError(saved.error)
    }

    // 落盘并回读成功后才建立会话；失败时不产生任何会话或路径切换。
    const opened = await this.deps.projectService.openBytes(
      encoded.value.bytes,
      saved.value.path,
      saved.value.fingerprint,
    )
    if (!opened.ok) {
      throw new IpcFailure(
        opened.error.code,
        '迁移文件已保存，但建立会话失败',
        opened.error.detail,
      )
    }
    this.tokens.delete(request.importToken)
    return { ...opened.value, warnings: migrated.value.warnings }
  }

  private checkTarget(targetPath: string, sourcePath: string): void {
    if (path.extname(targetPath).toLowerCase() !== '.cunlian') {
      throw new IpcFailure('INVALID_REQUEST', '另存目标必须以 .cunlian 结尾')
    }
    if (path.resolve(targetPath) === path.resolve(sourcePath)) {
      throw new IpcFailure('INVALID_REQUEST', '另存目标不得覆盖迁移输入文件')
    }
  }

  private pruneExpired(): void {
    const now = this.now()
    for (const [token, record] of this.tokens) {
      if (now > record.expiresAt) {
        this.tokens.delete(token)
      }
    }
  }

  /** 测试与诊断：当前未过期 token 数量。 */
  activeTokenCount(): number {
    this.pruneExpired()
    return this.tokens.size
  }
}

function sanitizeFileName(name: string): string {
  const cleaned = [...name]
    .map((character) =>
      character.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(character) ? '_' : character,
    )
    .join('')
    .trim()
  return cleaned === '' ? '迁移项目' : cleaned.slice(0, 120)
}
