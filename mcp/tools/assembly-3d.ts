import { isAbsolute } from 'node:path'
import { open } from 'node:fs/promises'
import { z } from 'zod'
import { recoverCandidates, stepAttachmentHashes, suggestMateDrafts } from '../../src/core/solver/mateDrafts'
import { createSolverScheduler } from '../../src/core/solver/solverScheduler.mjs'
import { assemblyModelV1Schema } from '../../src/project-file/assembly3d'
import { decodeProjectFile } from '../../src/project-file/codec'
import { PROJECT_FILE_MAX_SOURCE_BYTES } from '../../src/project-file/types'
import { ToolInputError } from '../lib/args'
import { success } from '../lib/format'

const id = z.string().min(1).max(200)
const pair = z.tuple([id, id])
const parameter = { id, partId: id, featureId: id }
const tolerance = z.union([
  z.strictObject({ ...parameter, dof: z.enum(['tx', 'ty', 'tz']), sigmaQ: z.int().nonnegative(),
    lowerQ: z.int().nonpositive(), upperQ: z.int().nonnegative() }),
  z.strictObject({ ...parameter, dof: z.enum(['rx', 'ry', 'rz']), sigmaRad: z.number().nonnegative(),
    lowerRad: z.number().nonpositive(), upperRad: z.number().nonnegative() }),
])
const model = { path: z.string().min(1).max(4096).optional(), assembly: assemblyModelV1Schema.optional() }
const pose = { ...model, fixedPartIds: z.array(id).max(32).optional() }
const input = z.discriminatedUnion('operation', [
  z.strictObject({ ...pose, operation: z.literal('solve') }),
  z.strictObject({ ...pose, operation: z.literal('simulate'), samples: z.int().min(10_000).max(50_000).optional(),
    seed: z.int().min(0).max(0xffffffff).optional(), bins: z.int().min(1).max(200).optional(),
    limits: z.record(id, z.strictObject({ lower: z.number(), upper: z.number() })).optional(),
    parameters: z.array(tolerance).max(128) }),
  z.strictObject({ ...model, operation: z.literal('suggest-mates'),
    candidates: z.strictObject({ coplanar: z.array(pair).max(1000), coaxial: z.array(pair).max(1000) }).optional(),
    evidenceByFeature: z.record(id, z.array(z.record(z.string(), z.unknown())).max(20)).optional() }),
])

export const assembly3dDefinition = {
  name: 'analyze_assembly_3d',
  title: '分析 3D 装配',
  description: '只读。接收 Schema 11 的 assembly3d 或本地 .cunlian 绝对路径，名义求解、3D 公差仿真，或根据已提取拓扑生成待确认的配合草案。',
  inputSchema: { ...z.toJSONSchema(input), type: 'object',
    allOf: [{ oneOf: [{ required: ['path'] }, { required: ['assembly'] }] }] },
}

async function loadAssembly(path: string) {
  if (!isAbsolute(path)) throw new ToolInputError('INVALID_ARGUMENTS', 'path 必须是绝对路径')
  const file = await open(path, 'r').catch(() => {
    throw new ToolInputError('NOT_FOUND', '无法打开项目文件')
  })
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > PROJECT_FILE_MAX_SOURCE_BYTES) throw new ToolInputError('INVALID_ARGUMENTS', '无效项目文件')
    const bytes = Buffer.alloc(stat.size)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead !== stat.size || (await file.stat()).ctimeMs !== stat.ctimeMs) {
      throw new ToolInputError('IO_FAILED', '读取期间项目文件发生变化')
    }
    const result = await decodeProjectFile(bytes)
    if (!result.ok || !result.value.snapshot.project.assembly3d) {
      throw new ToolInputError('INVALID_ARGUMENTS', '项目文件需包含有效的 3D 装配')
    }
    return result.value.snapshot
  } finally {
    await file.close()
  }
}

export async function runAssembly3d(raw: unknown): Promise<Record<string, unknown>> {
  const parsed = input.safeParse(raw)
  if (!parsed.success) throw new ToolInputError('INVALID_ARGUMENTS', '无效的 3D 装配工具参数', parsed.error.issues[0]?.path.join('.') ?? null)
  const { path, assembly: inline, ...options } = parsed.data
  if (Boolean(path) === Boolean(inline)) throw new ToolInputError('INVALID_ARGUMENTS', '必须提供 path 或 assembly，两者择一')
  const snapshot = path ? await loadAssembly(path) : undefined
  const assembly = (inline ?? snapshot?.project.assembly3d)!
  if (options.operation === 'suggest-mates') {
    const candidates = options.candidates ?? recoverCandidates(assembly)
    const drafts = suggestMateDrafts(assembly, candidates, options.evidenceByFeature, snapshot && stepAttachmentHashes(snapshot))
    return success(assembly3dDefinition.name, { readOnly: true, ...drafts })
  }
  const solver = createSolverScheduler()
  try {
    const result = options.operation === 'solve'
      ? await solver.run({ kind: 'se3', inputs: { assembly, fixedPartIds: options.fixedPartIds } })
      : await solver.run({ kind: 'multivariate', inputs: { ...options, assembly } })
    return success(assembly3dDefinition.name, { readOnly: true, result })
  } finally {
    await solver.close()
  }
}
