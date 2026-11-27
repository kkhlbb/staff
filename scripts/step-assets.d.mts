export const root: string
export const assetDirectory: string
export const hashes: Record<string, string>
export function buildPackagedSha256Sums(): Buffer
export function verifyAssets(directory: string): void
export function prepareStepAssets(): string
