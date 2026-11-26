import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { open } from 'node:fs/promises'
import type { ToolSchema } from '../../../src/agent/types'
import { decodeProjectFile } from '../../../src/project-file/codec'
import { PROJECT_FILE_MAX_SOURCE_BYTES } from '../../../src/project-file/types'
import { FEATURE_3D_ASSEMBLY_M1 } from '../../../src/transport/types'
import { gdtTools } from '../../../mcp/lib/gdt'
import { compliantTools } from '../../../mcp/lib/compliant'

export const gdtToolNames = ['stage_datum', 'stage_gdt', 'analyze_gdt_stackup'] as const
export type GdtToolName = (typeof gdtToolNames)[number]
export function isGdtTool(name: string): name is GdtToolName {
  return gdtToolNames.some(tool => tool === name)
}

export const compliantToolNames = ['stage_physics', 'import_mic_matrix', 'analyze_compliant_stackup'] as const
export type CompliantToolName = (typeof compliantToolNames)[number]
export function isCompliantTool(name: string): name is CompliantToolName {
  return compliantToolNames.some(tool => tool === name)
}

export const builtinGdtTools: ToolSchema[] = gdtTools.map(tool => ({
  name: tool.name, description: tool.description, parameters: tool.inputSchema,
}))

export const builtinCompliantTools: ToolSchema[] = compliantTools.map(tool => ({
  name: tool.name, description: tool.description, parameters: tool.inputSchema,
}))

export function desktopGdtEnabled() {
  return FEATURE_3D_ASSEMBLY_M1 || ['true', '1'].includes(process.env.FEATURE_3D_ASSEMBLY_M1 ?? '')
}

/** Resolve the existing unpacked SolverWorker in a packaged or Forge development app. */
export function desktopGdtWorkerUrl() {
  if (!process.versions.electron || typeof __dirname !== 'string') return undefined
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const directory = resourcesPath && __dirname.includes('app.asar')
    ? join(resourcesPath, 'app.asar.unpacked', '.vite', 'build') : __dirname
  const worker = join(directory, 'm2-worker', 'solverWorker.mjs')
  return existsSync(worker) ? pathToFileURL(worker) : undefined
}

/** Read only the canonical file selected and sealed by the writer authority. */
export async function readGdtSnapshot(filePath: string, fingerprint: string, projectId: string) {
  const file = await open(filePath, 'r')
  let bytes: Buffer
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size > PROJECT_FILE_MAX_SOURCE_BYTES) throw Error('REFERENCE_STALE')
    bytes = Buffer.alloc(metadata.size)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead !== bytes.length || createHash('sha256').update(bytes).digest('hex') !== fingerprint) {
      throw Error('REFERENCE_STALE')
    }
  } finally {
    await file.close()
  }
  const decoded = await decodeProjectFile(bytes)
  if (!decoded.ok || decoded.value.snapshot.project.id !== projectId) throw Error('REFERENCE_STALE')
  return decoded.value.snapshot
}
