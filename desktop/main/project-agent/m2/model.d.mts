export type Axis = [number, number, number]
export type HoleRole = 'hole.left.axis' | 'hole.right.axis'
export type Role = HoleRole | 'plate.rightFace' | 'plate.topFace' | 'cover.bottomFace'
export type FeatureId = string

export interface Variable {
  id: string
  nominalQ: number
  toleranceQ: number
}

export interface Frame {
  id: string
  originQ: Axis
  xAxis: Axis
  yAxis: Axis
  zAxis: Axis
}

interface Sketch {
  plane: 'XY'
  offsetQ: 0
}

export interface Hole {
  id: FeatureId
  role: HoleRole
  operation: 'throughCut'
  sketch: Sketch
  direction: '+Z'
  x: Variable
  y: Variable
  diameter: Variable
}

export interface MountingPlate {
  version: 1
  revision: string
  unit: 'mm'
  displayDecimals: number
  frame: Frame
  nextHoleNumber: number
  plate: {
    id: FeatureId
    operation: 'rectangleExtrusion'
    sketch: Sketch
    lengthQ: number
    widthQ: number
    thickness: Variable
  }
  holes: Hole[]
  cover: {
    id: FeatureId
    operation: 'rectangleExtrusion'
    sketch: { plane: 'XY' }
    bottom: Variable
    thicknessQ: number
  }
  constraints: {
    rightMargin: { clause: 'MP-03'; minQ: number }
    gap: { clause: 'MP-05'; minQ: number }
    angularVariationDegrees: number
  }
  bindings: Partial<Record<Role, FeatureId>>
}

export function createMountingPlate(revision?: string): MountingPlate
export function deleteHole(model: MountingPlate, featureId: FeatureId): MountingPlate
export function addHole(model: MountingPlate, definition: Omit<Hole, 'id' | 'x' | 'y' | 'diameter'> & {
  x: Omit<Variable, 'id'>
  y: Omit<Variable, 'id'>
  diameter: Omit<Variable, 'id'>
}): MountingPlate
export function rebindHole(model: MountingPlate, role: HoleRole, featureId: FeatureId): MountingPlate
