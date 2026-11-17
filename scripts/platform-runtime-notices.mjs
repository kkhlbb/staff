import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Copy the actual target Electron distribution originals, never host notices.
// Existing step-narrow-v1 notices are historical mac-derived supplements only.
export function copyPlatformRuntimeNotices(output, platform, arch) {
  const resources = platform === 'darwin'
    ? path.join(output, '寸链.app/Contents/Resources')
    : path.join(output, 'resources')
  const target = path.join(resources, 'platform-runtime-notices')
  mkdirSync(target, { recursive: true })
  for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
    const source = path.join(output, name)
    if (!readFileSync(source).length) throw new Error('EMPTY_PLATFORM_NOTICE')
    copyFileSync(source, path.join(target, name))
  }
  writeFileSync(path.join(target, 'README.txt'), `Target Electron runtime notices: ${platform}-${arch}.\nLICENSE and LICENSES.chromium.html are exact originals from this target distribution.\nstep-narrow-v1/ELECTRON-* are inherited mac-derived supplemental records, not Windows runtime attribution.\nThis copy does not certify source completeness or legal approval.\n`)
}
