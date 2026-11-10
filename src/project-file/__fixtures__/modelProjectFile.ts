/**
 * B2 测试夹具：在 A-02 示例上增加一个导入模型版本与一条可视关联。
 * 合成数据，只用于单测；STL 是一个非退化三角面。
 */
import { sha256Hex } from '../../sources/hash'
import type { ProjectFileModelRevision, ProjectFileSnapshot } from '../types'
import { createSampleSnapshot } from './sampleProjectFile'

export const MODEL_PART_ID = 'part-sleeve'
export const MODEL_REVISION_ID = 'model-1'
export const MODEL_BLOB_KEY = 'blob-model-1'

export function sampleStlTriangle(scale = 1): Uint8Array {
  const bytes = new Uint8Array(84 + 50)
  const view = new DataView(bytes.buffer)
  view.setUint32(80, 1, true)
  const base = 84
  const write = (offset: number, x: number, y: number, z: number): void => {
    view.setFloat32(offset, x, true)
    view.setFloat32(offset + 4, y, true)
    view.setFloat32(offset + 8, z, true)
  }
  write(base, 0, 0, 1)
  write(base + 12, 0, 0, 0)
  write(base + 24, scale, 0, 0)
  write(base + 36, 0, scale, 0)
  return bytes
}

export interface ModelSnapshotResult {
  snapshot: ProjectFileSnapshot
  stlBytes: Uint8Array
}

export async function createModelSnapshot(): Promise<ModelSnapshotResult> {
  const base = await createSampleSnapshot()
  const stlBytes = sampleStlTriangle()
  const sha256 = await sha256Hex(stlBytes)
  const createdAt = '2026-11-09T09:00:00.000Z'
  const model: ProjectFileModelRevision = {
    modelRevisionId: MODEL_REVISION_ID,
    partId: MODEL_PART_ID,
    kind: 'stl',
    parentModelRevisionId: null,
    createdAt,
    reason: '导入模型',
    fileName: 'sleeve.stl',
    blobKey: MODEL_BLOB_KEY,
    attachmentSha256: sha256,
    byteSize: stlBytes.byteLength,
    encoding: 'binary',
    triangleCount: 1,
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    unitNote: '未注明（STL 无标准单位）',
  }

  return {
    stlBytes,
    snapshot: {
      ...base,
      project: {
        ...base.project,
        parts: [
          {
            partId: MODEL_PART_ID,
            kind: 'imported-mesh',
            name: '隔套外形',
            currentModelRevisionId: MODEL_REVISION_ID,
            origin: 'stl-import',
          },
        ],
        modelRevisions: [model],
        dimensionLinks: [
          {
            kind: 'visual-reference',
            linkId: 'link-1',
            termId: 't-s',
            target: {
              granularity: 'model',
              partId: MODEL_PART_ID,
              modelRevisionId: MODEL_REVISION_ID,
            },
            reviewStatus: 'confirmed',
            reviewedModelRevisionId: MODEL_REVISION_ID,
            reviewedAt: createdAt,
            reason: '',
          },
        ],
      },
      blobs: [
        ...base.blobs,
        {
          blobKey: MODEL_BLOB_KEY,
          projectId: base.project.id,
          sha256,
          byteSize: stlBytes.byteLength,
        },
      ],
      attachments: [...base.attachments, { blobKey: MODEL_BLOB_KEY, bytes: stlBytes }],
    },
  }
}
