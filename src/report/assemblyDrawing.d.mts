import type { AssemblyModelV1 } from '../project-file/assembly3d'
import type { ProjectFileSnapshot } from '../project-file/types'

export function assemblyDrawing(snapshot: ProjectFileSnapshot, assembly: AssemblyModelV1 | undefined, revision: string,
  options?: { workerUrl?: URL; signal?: AbortSignal; timeoutMs?: number }): Promise<string | undefined>
