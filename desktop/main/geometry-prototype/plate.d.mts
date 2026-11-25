interface PlateMeasurement {
  valid: boolean
  solids: number
  bounds: { min: number[]; max: number[] }
  volumeMm3: number
  cylinders: { origin: number[]; direction: number[]; radius: number; bounds: { min: number[]; max: number[] } }[]
}

export function loadKernel(options?: { print?: (message: string) => void }): Promise<unknown>
export function readA01(kernel: unknown, step: Uint8Array): PlateMeasurement
