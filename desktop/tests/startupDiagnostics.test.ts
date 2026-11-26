import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatStartupError,
  recordStartupError,
  resolveStartupErrorLogPath,
} from '../main/startupDiagnostics'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('startupDiagnostics', () => {
  it('resolves %LOCALAPPDATA%\\Cunlian\\startup-error.log on Windows', () => {
    expect(
      resolveStartupErrorLogPath({
        platform: 'win32',
        env: { LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local' },
        userDataDir: 'C:\\Users\\Alice\\AppData\\Roaming\\寸链',
      }),
    ).toBe('C:\\Users\\Alice\\AppData\\Local\\Cunlian\\startup-error.log')

    expect(
      resolveStartupErrorLogPath({
        platform: 'win32',
        env: {},
        userDataDir: 'C:\\Users\\Alice\\AppData\\Roaming\\寸链',
      }),
    ).toBe('C:\\Users\\Alice\\AppData\\Roaming\\寸链\\Cunlian\\startup-error.log')
  })

  it('writes startup error log and invokes showDialog without throwing', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cunlian-startup-diag-'))
    tempDirs.push(dir)
    const logPath = path.join(dir, 'nested', 'startup-error.log')
    const dialogs: Array<{ title: string; content: string }> = []

    const written = recordStartupError('app.whenReady', new Error('boom-win32'), {
      logPath,
      now: new Date('2026-11-26T00:00:00.000Z'),
      showDialog: (title, content) => dialogs.push({ title, content }),
    })

    expect(written).toBe(logPath)
    const content = readFileSync(logPath, 'utf8')
    expect(content).toContain('[2026-11-26T00:00:00.000Z] [app.whenReady] boom-win32')
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0].title).toBe('寸链启动失败')
    expect(dialogs[0].content).toContain(logPath)
  })

  it('formats non-Error values safely', () => {
    const text = formatStartupError('window.loadFile', 'ENOENT', new Date('2026-11-26T00:00:00.000Z'))
    expect(text).toContain('[window.loadFile] ENOENT')
  })
})
