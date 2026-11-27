import { createHash } from 'node:crypto'
import { uniqueSubshapes } from './topology.mjs'

const identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
const syntheticStepName = /^(?:Open CASCADE STEP translator\b|COMPOUND$|SOLID$|SHELL$|\d+$)/i

export function verifiedStep(attachment) {
  const { bytes, sha256 } = attachment
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error('Expected STEP attachment bytes')
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== sha256) throw new Error('STEP attachment SHA-256 mismatch')
  return digest
}

function cleanName(raw) {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed || syntheticStepName.test(trimmed)) return ''
  return trimmed.slice(0, 200)
}

function locationToMatrix(location) {
  using trsf = location.Transformation()
  const row = r => [1, 2, 3, 4].map(c => {
    const value = trsf.Value(r, c)
    return Object.is(value, -0) ? 0 : value
  })
  return [row(1), row(2), row(3), [0, 0, 0, 1]]
}

function isIdentityMatrix(matrix) {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (Math.abs(matrix[r][c] - (r === c ? 1 : 0)) > 1e-9) return false
    }
  }
  return true
}

function rgbToHex(rgb) {
  if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(v => typeof v === 'number' && Number.isFinite(v))) {
    return undefined
  }
  return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('')
}

function readLabelColor(oc, label) {
  const colorTool = oc.XCAFDoc_ColorTool
  const colorTypes = [
    oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf,
    oc.XCAFDoc_ColorType.XCAFDoc_ColorGen,
    oc.XCAFDoc_ColorType.XCAFDoc_ColorCurv,
  ]
  for (const type of colorTypes) {
    const rgb = colorTool.GetColor(label, type)
    const hex = rgbToHex(rgb)
    if (hex) return hex
  }
  return undefined
}

function tryReadStepXcaf(oc, path, scope) {
  if (!oc.STEPCAFControl_Reader || !oc.XCAFApp_Application || !oc.XCAFDoc_DocumentTool) return null
  using app = oc.XCAFApp_Application.GetApplication()
  if (!app) return null
  using document = app.NewDocument()
  if (!document) return null
  try {
    using reader = new oc.STEPCAFControl_Reader()
    reader.SetNameMode(true)
    reader.SetColorMode(true)
    using progress = new oc.Message_ProgressRange()
    if (reader.ReadFile(path) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) return null
    if (!reader.Transfer(document, progress)) return null

    using main = document.Main()
    using shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(main)
    if (!shapeTool) return null
    const ShapeTool = oc.XCAFDoc_ShapeTool
    const NameTool = oc.TDataStd_Name

    const groups = []
    const items = []
    let hasXcafMetadata = false
    using localScope = new DisposableStack()

    function traverse(label, parentLocation, parentGroupId, pathKey, inheritedColor) {
      using referred = ShapeTool.GetReferredShape(label)
      const isRef = !referred.IsNull()
      const definition = isRef ? referred : label
      using localLocation = ShapeTool.GetLocation(label)
      using worldLocation = parentLocation.Multiplied(localLocation)
      const instName = cleanName(NameTool.Get(label))
      const defName = isRef ? cleanName(NameTool.Get(definition)) : instName
      const color = readLabelColor(oc, label) ?? (isRef ? readLabelColor(oc, definition) : undefined) ?? inheritedColor

      if (ShapeTool.IsAssembly(definition)) {
        const groupName = (isRef ? (instName || defName) : defName) || 'Assembly'
        const groupId = 'group:' + createHash('sha256').update(pathKey + ':' + groupName).digest('hex').slice(0, 16)
        groups.push({ id: groupId, name: groupName, ...(parentGroupId ? { parentGroupId } : {}) })
        if (instName || defName) hasXcafMetadata = true
        using components = ShapeTool.GetComponents(definition)
        for (let i = 1; i <= components.Length(); i++) {
          using child = components.Value(i)
          traverse(child, worldLocation, groupId, `${pathKey}/${i}`, color)
        }
        return
      }

      using shape = ShapeTool.GetShape(definition)
      if (shape.IsNull()) return
      const solids = []
      uniqueSubshapes(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, child => solids.push(localScope.use(oc.TopoDS.Solid(child))))
      if (!solids.length) return

      const nominalTransform = locationToMatrix(worldLocation)
      const baseName = defName || instName
      if (baseName || color || !isIdentityMatrix(nominalTransform)) {
        hasXcafMetadata = true
      }
      solids.forEach((solid, index) => {
        const displayName = baseName
          ? (solids.length === 1 ? baseName : `${baseName} ${index + 1}`).slice(0, 200)
          : undefined
        items.push({
          solid,
          ...(displayName ? { displayName } : {}),
          ...(color ? { color } : {}),
          ...(parentGroupId ? { groupId: parentGroupId } : {}),
          nominalTransform,
        })
      })
    }

    using roots = shapeTool.GetFreeShapes()
    using rootIdentity = new oc.TopLoc_Location()
    for (let i = 1; i <= roots.Length(); i++) {
      using root = roots.Value(i)
      traverse(root, rootIdentity, undefined, `root:${i}`, undefined)
    }

    if (!items.length || !hasXcafMetadata) return null
    scope.adopt(localScope.move(), stack => stack.dispose())
    return { usedXcaf: true, groups, items }
  } finally {
    app.Close(document)
  }
}

function readStepPlain(oc, path, scope) {
  const items = []
  using reader = new oc.STEPControl_Reader()
  using progress = new oc.Message_ProgressRange()
  if (reader.ReadFile(path) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('STEP read failed')
  const transferred = reader.TransferRoots(progress)
  if (!transferred) throw new Error('STEP root transfer failed')
  using shape = reader.OneShape()
  if (shape.IsNull()) throw new Error('STEP transfer returned a null shape')
  uniqueSubshapes(oc, shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, child => {
    items.push({ solid: scope.use(oc.TopoDS.Solid(child)), nominalTransform: identity })
  })
  if (!items.length) throw new Error('STEP contains no solids')
  return { usedXcaf: false, groups: [], items }
}

// The supplied scope owns each returned solid, including any partial results on failure.
export function readStepAssembly(oc, bytes, scope) {
  const path = '/cunlian-import.step'
  try {
    oc.FS.writeFile(path, bytes)
    const xcaf = tryReadStepXcaf(oc, path, scope)
    if (xcaf) return xcaf
    return readStepPlain(oc, path, scope)
  } finally {
    if (oc.FS.readdir('/').includes(path.slice(1))) oc.FS.unlink(path)
  }
}

export function readStepSolids(oc, bytes, scope) {
  return readStepAssembly(oc, bytes, scope).items.map(item => item.solid)
}
