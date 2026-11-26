import type { AssemblyModelV1, MicMatrixPayloadV1 } from '../project-file/assembly3d'
import type { GdtContributionItem, GdtValidationWarning } from '../transport/types'
import type { ReportConclusion } from './types'

export function gdtConclusions(
  assembly: AssemblyModelV1 | undefined, seed: number, samples: number, mic?: MicMatrixPayloadV1,
): { conclusions: ReportConclusion[]; contributions: GdtContributionItem[]; warnings: GdtValidationWarning[] }
