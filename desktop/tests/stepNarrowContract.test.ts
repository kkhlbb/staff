import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { STEP_ASSET_HASHES, STEP_KERNEL_VERSION } from '../main/cad/stepAssetManifest'

it('ships only the reviewed narrow ABI kernel and retains geometry guards in its application source', () => {
  expect(Object.keys(STEP_ASSET_HASHES).sort()).toEqual(['spacer.cjs', 'spacer.wasm', 'step-worker.cjs'])
  expect(STEP_KERNEL_VERSION).toContain('narrow')
  const source = readFileSync('vendor/step-narrow-v1/spacer.cpp', 'utf8')
  for (const guard of ['TopAbs_SOLID', 'TopAbs_SHELL', 'TopAbs_FACE', 'IsClosed', 'GeomAbs_Cylinder', 'GeomAbs_Plane', 'VolumeProperties', 'InnerSolution', 'DistShapeShape', '1e-6', '1e-9']) expect(source).toContain(guard)
})
