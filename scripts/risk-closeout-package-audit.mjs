import { listPackage } from '@electron/asar'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import assert from 'node:assert/strict'
const root = process.cwd()
const out = process.argv[2]
const resources = path.join(root, 'out/寸链-darwin-arm64/寸链.app/Contents/Resources')
const asar = path.join(resources, 'app.asar')
const members = listPackage(asar, {})
const forbidden = ['@electron/asar', '@eslint/config-array', '@typescript-eslint', 'typescript-eslint', 'eslint', 'glob', 'minimatch', '@isaacs/nonrecursive-glob-match', 'path-scurry']
const leaked = members.filter(m => forbidden.some(n => m.includes(`/node_modules/${n}/`) || m.endsWith(`/node_modules/${n}`)))
assert.deepEqual(leaked, [])
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex')
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const nodes = Object.entries(lock.packages).filter(([k]) => forbidden.some(n => k.endsWith(`/node_modules/${n}`) || k === `node_modules/${n}`))
assert.ok(nodes.length > 0)
assert.ok(nodes.every(([, v]) => v.dev === true))
const files = readdirSync(path.join(resources, 'step-narrow-v1')).map(name => ({ name, sha256: hash(path.join(resources, 'step-narrow-v1', name)) }))
const report = { scope: 'Mechanical package boundary/hash receipt, not legal approval or renewed source-delivery binding', appAsarSha256: hash(asar), memberCount: members.length, devPackagePathsAbsent: forbidden, leaked, dependencyNodes: nodes.map(([name, v]) => ({ name, version: v.version, dev: v.dev, license: v.license, integrity: v.integrity })), stepResources: files, sourceDelivery: 'Prior delivery binding covers prior app.asar only; this receipt does not rebind or approve formal distribution' }
writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify(report, null, 2))
