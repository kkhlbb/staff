import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { configure } from './mcp-config.mjs'

const executable = 'D:\\工程 目录\\寸链.exe'
const server = {
  command: executable,
  args: ['D:\\工程 目录\\resources\\cunlian-agent\\local-bridge.mjs', executable],
  env: { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '', ELECTRON_NO_ASAR: '' },
}

function fixture(t) {
  const profile = mkdtempSync(path.join(tmpdir(), 'cunlian-test-'))
  t.after(() => rmSync(profile, { recursive: true, force: true }))
  const agent = path.join(profile, 'agent')
  const userDir = path.join(profile, '.cunlian')
  mkdirSync(agent)
  mkdirSync(userDir)
  const config = path.join(userDir, 'mcp-config.json')
  return {
    run: mode => configure(mode, executable, agent, profile),
    user: () => JSON.parse(readFileSync(config, 'utf8')),
    builtIn: () => JSON.parse(readFileSync(path.join(agent, 'mcp-config.json'), 'utf8')),
    setUser: value => writeFileSync(config, value),
    rawUser: () => readFileSync(config, 'utf8'),
  }
}

test('UTF-8 path, whitespace, production arguments and opt-out', t => {
  const f = fixture(t)
  f.run('local')
  assert.deepEqual(f.builtIn(), { mcpServers: { 'cunlian-local': server } })
  assert.throws(f.rawUser, { code: 'ENOENT' })
})

test('sync and reinstall preserve other entries, uninstall removes the owned entry', t => {
  const f = fixture(t)
  const original = { mcpServers: { other: { command: 'another.exe' } }, metadata: 1 }
  f.setUser('\uFEFF' + JSON.stringify(original))
  f.run('sync')
  assert.deepEqual(f.user(), { ...original, mcpServers: { ...original.mcpServers, 'cunlian-local': server } })
  const synchronized = f.rawUser()
  f.run('sync')
  assert.equal(f.rawUser(), synchronized)
  f.run('remove')
  assert.deepEqual(f.user(), original)
})

test('pre-existing same-name entry, even an exact match, stays user-owned', t => {
  const f = fixture(t)
  const original = JSON.stringify({ mcpServers: { 'cunlian-local': server } })
  f.setUser(original)
  f.run('sync')
  f.run('remove')
  assert.equal(f.rawUser(), original)
})

test('user edits and deletions survive upgrade and uninstall', t => {
  const f = fixture(t)
  f.run('sync')
  const modified = JSON.stringify({ mcpServers: { 'cunlian-local': { ...server, args: ['custom'] } } })
  f.setUser(modified)
  f.run('sync')
  assert.equal(f.rawUser(), modified)
  const deleted = '{"mcpServers":{}}'
  f.setUser(deleted)
  f.run('sync')
  f.run('remove')
  assert.equal(f.rawUser(), deleted)
})

test('invalid or incompatible user config stays byte-identical', t => {
  const f = fixture(t)
  for (const original of ['{broken', 'null', '{"mcpServers":[]}']) {
    f.setUser(original)
    assert.throws(() => f.run('sync'))
    assert.equal(f.rawUser(), original)
    assert.deepEqual(f.builtIn(), { mcpServers: { 'cunlian-local': server } })
  }
})

test('uninstall leaves a user-edited invalid config byte-identical', t => {
  const f = fixture(t)
  f.run('sync')
  f.setUser('{user edit')
  f.run('remove')
  assert.equal(f.rawUser(), '{user edit')
})
