import fs from 'node:fs'
import path from 'node:path'

export interface StartupLogPathOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  userDataDir?: string
}

/**
 * Resolve the startup diagnostic log path.
 * On Windows, prefers %LOCALAPPDATA%\Cunlian\startup-error.log so startup
 * failures before userData initialization remain discoverable.
 */
export function resolveStartupErrorLogPath(options: StartupLogPathOptions = {}): string {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA?.trim() || options.userDataDir || '.'
    return path.win32.join(base, 'Cunlian', 'startup-error.log')
  }
  const base = options.userDataDir || env.TMPDIR?.trim() || '/tmp'
  return path.join(base, 'startup-error.log')
}

export function formatStartupError(stage: string, error: unknown, now: Date = new Date()): string {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error && error.stack ? error.stack : message
  return `[${now.toISOString()}] [${stage}] ${message}\n${stack}\n\n`
}

export interface RecordStartupErrorOptions extends StartupLogPathOptions {
  logPath?: string
  showDialog?: (title: string, content: string) => void
  now?: Date
}

/**
 * Best-effort startup error persistence and error box reporting.
 * Never throws, so it is safe inside uncaughtException / whenReady catch handlers.
 */
export function recordStartupError(
  stage: string,
  error: unknown,
  options: RecordStartupErrorOptions = {},
): string {
  const logPath = options.logPath ?? resolveStartupErrorLogPath(options)
  const entry = formatStartupError(stage, error, options.now)
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, entry, 'utf8')
  } catch {
    // Ignore filesystem errors during crash logging.
  }
  const message = error instanceof Error ? error.message : String(error)
  if (options.showDialog) {
    try {
      options.showDialog(
        '寸链启动失败',
        `阶段：${stage}\n错误：${message}\n\n诊断日志已写入：\n${logPath}`,
      )
    } catch {
      // Ignore dialog errors when Electron is not ready.
    }
  }
  return logPath
}
