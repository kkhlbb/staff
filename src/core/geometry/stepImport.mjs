import { createHash } from 'node:crypto'
import { uniqueSubshapes } from './topology.mjs'

export function verifiedStep(attachment) {
  const { bytes, sha256 } = attachment
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error('Expected STEP attachment bytes')
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== sha256) throw new Error('STEP attachment SHA-256 mismatch')
  return digest
}

// The supplied scope owns each returned solid, including any partial results on failure.
export function readStepSolids(oc, bytes, scope) {
  const path = '/cunlian-import.step'
  const solids = []
  try {
    oc.FS.writeFile(path, bytes)
    using reader = new oc.STEPControl_Reader()
    using progress = new oc.Message_ProgressRange()
    if (reader.ReadFile(path) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('STEP read failed')
    const transferred = reader.TransferRoots(progress)
    if (!transferred || transferred !== reader.NbRootsForTransfer()) throw new Error('STEP root transfer failed')
    using shape = reader.OneShape()
    if (shape.IsNull()) throw new Error('STEP transfer returned a null shape')
    uniqueSubshapes(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, child => solids.push(scope.use(oc.TopoDS.Solid(child))))
    if (!solids.length) throw new Error('STEP contains no solids')
    return solids
  } finally {
    if (oc.FS.readdir('/').includes(path.slice(1))) oc.FS.unlink(path)
  }
}
