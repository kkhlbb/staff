import { readFileSync } from 'node:fs'
import { Duplex, PassThrough } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { getLocalAgentInstallInfo } from '../main/project-agent/m1LocalAgent'
import { isM1WindowsPipe, localM1PeerHelper, localM1WindowsPipe, M1_LAUNCH_ARGUMENT } from '../main/project-agent/m1LocalTransport'
import { LocalM1Client } from '../../mcp/localClient'

const install = 'C:\\Program Files\\寸链 (Beta) & Tools'
const exe = install + '\\寸链.exe'
const resources = install + '\\resources'
const helper = resources + '\\cunlian-agent\\m1-peer.exe'
const sid = 'S-1-5-21-42-1001'
const pipe = localM1WindowsPipe(exe, sid)

it('builds absolute Windows install information for direct executable spawning', () => {
  const info = getLocalAgentInstallInfo(exe, resources, 'win32')
  expect(info).toMatchObject({
    installPath: install, bridgeCommand: resources + '\\cunlian-agent\\cunlian-mcp.cmd', bridgeArgs: [],
  })
  expect(JSON.parse(info.mcpConfigJson).mcpServers['cunlian-local']).toEqual({
    command: exe,
    args: [resources + '\\cunlian-agent\\local-bridge.mjs', exe],
    env: { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '', ELECTRON_NO_ASAR: '' },
  })
  expect(localM1PeerHelper(resources, 'win32')).toBe(helper)
  expect(getLocalAgentInstallInfo('\\\\srv\\share\\寸链.exe', '\\\\srv\\share\\resources', 'win32').installPath)
    .toBe('\\\\srv\\share\\')
  expect(() => getLocalAgentInstallInfo('C:寸链.exe', resources, 'win32')).toThrow('LOCAL_ENDPOINT_UNAVAILABLE')
  expect(() => getLocalAgentInstallInfo('\\寸链.exe', '\\resources', 'win32')).toThrow('LOCAL_ENDPOINT_UNAVAILABLE')
  expect(() => getLocalAgentInstallInfo(exe, 'D:\\resources', 'win32')).toThrow('LOCAL_ENDPOINT_UNAVAILABLE')
})

it('derives local pipe names from the canonical installation and token SID', () => {
  expect(pipe).toMatch(/^\\\\\.\\pipe\\cunlian-m1-[0-9a-f]{64}$/)
  expect(isM1WindowsPipe(pipe)).toBe(true)
  expect(isM1WindowsPipe(pipe.replace('\\\\.', '\\\\server'))).toBe(false)
  expect(localM1WindowsPipe(exe.replaceAll('\\', '/'), sid)).toBe(pipe)
  expect(localM1WindowsPipe('\\\\?\\' + exe, sid)).toBe(pipe)
  expect(localM1WindowsPipe(exe, 'S-1-5-21-42-1002')).not.toBe(pipe)
  expect(localM1WindowsPipe(exe.replace('Beta', 'Other'), sid)).not.toBe(pipe)
  expect(() => localM1WindowsPipe(exe, 'user-name')).toThrow('LOCAL_ENDPOINT_UNAVAILABLE')
  expect(() => localM1WindowsPipe('C:relative.exe', sid)).toThrow('LOCAL_ENDPOINT_UNAVAILABLE')
})

it('cold-starts once, retries a busy pipe, and handshakes on the verified mock transport', async () => {
  const replies = new PassThrough()
  const requests = new PassThrough()
  const stream = Duplex.from({ readable: replies, writable: requests })
  const methods: string[] = []
  requests.on('data', chunk => {
    const { id, method } = JSON.parse(chunk.toString())
    methods.push(method)
    replies.write(JSON.stringify({ id, ok: true, result: method === 'hello' ? { version: 1 } : { protocol: 1 } }) + '\n')
  })
  const connectWindows = vi.fn()
    .mockRejectedValueOnce(Object.assign(Error('ENOENT'), { code: 'ENOENT' }))
    .mockRejectedValueOnce(Object.assign(Error('EBUSY'), { code: 'EBUSY' }))
    .mockResolvedValueOnce(stream)
  const launch = vi.fn(async () => {})
  const client = new LocalM1Client({ executable: exe, socketPath: pipe, peerHelper: helper, platform: 'win32',
    connectWindows, launch, startupTimeoutMs: 2_000 })
  try {
    client.initialize('Windows test client')
    await expect(client.call('capabilities', {})).resolves.toEqual({ protocol: 1 })
    expect(methods).toEqual(['hello', 'capabilities', 'capabilities'])
    expect(connectWindows).toHaveBeenCalledTimes(3)
    expect(connectWindows).toHaveBeenCalledWith(helper, pipe, expect.any(AbortSignal))
    expect(launch).toHaveBeenCalledExactlyOnceWith(exe, [M1_LAUNCH_ARGUMENT], expect.any(AbortSignal))
  } finally {
    client.close()
  }
})

it('fails closed on an untrusted pipe without launching or writing protocol data', async () => {
  const connectWindows = vi.fn().mockRejectedValue(Object.assign(Error('UNTRUSTED_PEER'), { code: 'UNTRUSTED_PEER' }))
  const launch = vi.fn()
  const client = new LocalM1Client({ executable: exe, socketPath: pipe, peerHelper: helper, platform: 'win32',
    connectWindows, launch })
  client.initialize('Windows test client')
  await expect(client.ready()).rejects.toThrow('UNTRUSTED_PEER')
  expect(launch).not.toHaveBeenCalled()
  client.close()
})

it('keeps the batch launcher ASCII and delegates Unicode executable resolution to CreateProcessW', () => {
  const command = readFileSync(new URL('../../mcp/cunlian-mcp.cmd', import.meta.url), 'ascii')
  const native = readFileSync(new URL('../main/project-agent/native/m1-peer-win.c', import.meta.url), 'utf8')
  expect(command).toContain('setlocal DisableDelayedExpansion')
  expect(command).toContain('set "ELECTRON_RUN_AS_NODE=1"')
  expect(command).toContain('"%~dp0m1-peer.exe" launch')
  expect(native).toContain('GetModuleFileNameW')
  expect(native).toContain(String.raw`\u5bf8\u94fe.exe`)
  expect(native).toContain('local-bridge.mjs')
  expect(native).toContain('CreateProcessW(executable, command')
})
