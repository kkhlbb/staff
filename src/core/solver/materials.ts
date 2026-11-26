type MechanicalProperties = {
  youngsModulusMpa: number
  poissonRatio: number
  thermalExpansionPerK: number
  yieldStrengthMpa?: number
}

function preset(name: string, youngsModulusMpa: number, poissonRatio: number, alphaMicroPerK: number,
  yieldStrengthMpa?: number): Readonly<MechanicalProperties & { name: string }> {
  return Object.freeze({
    name, youngsModulusMpa, poissonRatio, thermalExpansionPerK: alphaMicroPerK * 1e-6,
    ...(yieldStrengthMpa !== undefined && { yieldStrengthMpa }),
  })
}

/** Representative room-temperature inputs. Use grade-, process- and temperature-specific data for design. */
export const materialPresets = Object.freeze({
  'steel-45': preset('45# steel', 206_000, 0.30, 11.7, 355),
  sus304: preset('SUS304 stainless steel', 193_000, 0.29, 17.3, 205),
  'al-6061': preset('6061-T6 aluminum', 69_000, 0.33, 23.6, 276),
  'al-5052': preset('5052-H32 aluminum', 70_300, 0.33, 23.8, 193),
  'brass-h62': preset('H62 brass', 105_000, 0.34, 20.5, 150),
  abs: preset('ABS', 2_200, 0.35, 90, 40),
  pc: preset('Polycarbonate', 2_350, 0.37, 65, 62),
  pa66: preset('PA66 + 30% glass fiber', 9_000, 0.35, 30, 150),
  // Elastomers lack a meaningful linear elastic yield point. Specify an effective stiffness for the joint.
  'silicone-epdm': preset('Silicone/EPDM gasket (effective)', 5, 0.49, 200),
})

export type MaterialPresetId = keyof typeof materialPresets
type MaterialOverrides = Partial<MechanicalProperties> & {
  presetId?: string
  name?: string
  deltaTemperatureK?: number
}

export function resolveMaterial(partId: string, overrides: MaterialOverrides) {
  const presetId = overrides.presetId as MaterialPresetId | undefined
  const defaults = presetId && Object.hasOwn(materialPresets, presetId) ? materialPresets[presetId] : undefined
  const material = {
    ...overrides,
    partId,
    name: overrides.name ?? defaults?.name ?? partId,
    youngsModulusMpa: overrides.youngsModulusMpa ?? defaults?.youngsModulusMpa,
    poissonRatio: overrides.poissonRatio ?? defaults?.poissonRatio,
    thermalExpansionPerK: overrides.thermalExpansionPerK ?? defaults?.thermalExpansionPerK,
    yieldStrengthMpa: overrides.yieldStrengthMpa ?? defaults?.yieldStrengthMpa,
    deltaTemperatureK: overrides.deltaTemperatureK ?? 0,
  }
  const { youngsModulusMpa, poissonRatio, thermalExpansionPerK, yieldStrengthMpa, deltaTemperatureK } = material
  if (youngsModulusMpa === undefined || !Number.isFinite(youngsModulusMpa) || youngsModulusMpa <= 0 ||
      poissonRatio === undefined || !(poissonRatio > -1 && poissonRatio < 0.5) ||
      thermalExpansionPerK === undefined || !Number.isFinite(thermalExpansionPerK) || !Number.isFinite(deltaTemperatureK) ||
      yieldStrengthMpa !== undefined && (!Number.isFinite(yieldStrengthMpa) || yieldStrengthMpa <= 0)) {
    throw Error('Invalid or incomplete material properties: ' + partId)
  }
  const { yieldStrengthMpa: reference, ...rest } = material
  return {
    ...rest, youngsModulusMpa, poissonRatio, thermalExpansionPerK,
    ...(reference !== undefined && { yieldStrengthMpa: reference }),
  }
}
