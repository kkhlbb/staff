/** Acceptance-only preload: use installed official Electron checksums without network access. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../forge.config.ts'
import { registerForgeConfigForDirectory } from '../node_modules/@electron-forge/core/dist/util/forge-config.js'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checksums = JSON.parse(readFileSync(path.join(root, 'node_modules/electron/checksums.json'), 'utf8'))
config.packagerConfig.download = { ...config.packagerConfig.download, checksums }
registerForgeConfigForDirectory(root, config)
