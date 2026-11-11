/**
 * AgentTask / AgentStep 落盘（§10 最小子集）。
 *
 * 记录放在既有应用工作区 `workspace/agent-tasks/`，不写 `.cunlian` 正式文件。
 * 写入沿用“临时文件 → 回读校验 → rename”的原子语义；单任务单文件，没有第二份索引。
 */
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { sensitiveFindings } from '../../src/agent/redact'
import type { AgentStepRecord, AgentTaskRecord } from '../../src/agent/types'
import { nodeWorkspaceOps, type WorkspaceOps } from './workspaceJson'

export interface AgentTaskFile {
  schemaVersion: 1
  task: AgentTaskRecord
  steps: AgentStepRecord[]
}

const MAX_BYTES = 2 * 1024 * 1024
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export class AgentTaskStore {
  private readonly rootDir: string
  private readonly ops: WorkspaceOps

  constructor(deps: { rootDir: string; ops?: WorkspaceOps }) {
    this.rootDir = deps.rootDir
    this.ops = deps.ops ?? nodeWorkspaceOps
  }

  directory(): string {
    return path.join(this.rootDir, 'agent-tasks')
  }

  filePath(taskId: string): string {
    return path.join(this.directory(), `${sha256(taskId)}.json`)
  }

  async save(task: AgentTaskRecord, steps: AgentStepRecord[]): Promise<void> {
    const payload: AgentTaskFile = { schemaVersion: 1, task, steps }
    const text = JSON.stringify(payload)
    const findings = sensitiveFindings(text)
    if (findings.length > 0) {
      throw new Error(`任务记录含敏感内容（${findings.join(',')}），拒绝写盘`)
    }
    const bytes = new TextEncoder().encode(text)
    if (bytes.length > MAX_BYTES) throw new Error('任务记录超过 2MiB 预算，拒绝写盘')
    const target = this.filePath(task.taskId)
    await this.ops.ensureDirectory(path.dirname(target))
    const temp = `${target}.${randomUUID()}.tmp`
    try {
      await this.ops.writeExclusive(temp, bytes)
      const back = await this.ops.readFile(temp)
      if (!Buffer.from(bytes).equals(Buffer.from(back))) throw new Error('任务记录回读不一致')
      await this.ops.rename(temp, target)
    } finally {
      try { await this.ops.remove(temp) } catch { /* 只清理本次自己的临时文件 */ }
    }
    try { await this.ops.syncDirectory(path.dirname(target)) } catch { /* rename 已提交 */ }
  }

  async load(taskId: string): Promise<AgentTaskFile | null> {
    const target = this.filePath(taskId)
    if (await this.ops.statKind(target) === 'missing') return null
    const bytes = await this.ops.readFile(target)
    if (bytes.length > MAX_BYTES) throw new Error('任务记录超过 2MiB 预算')
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as AgentTaskFile
    if (parsed.schemaVersion !== 1 || parsed.task.taskId !== taskId) throw new Error('任务记录身份不符')
    return parsed
  }
}
