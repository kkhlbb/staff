import path from 'node:path'

const CUNLIAN_EXT = '.cunlian'
const DXF_ARG_PREFIX = '--open-dxf='

function isWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

function isAbsoluteAnyPlatform(value: string): boolean {
  return value.startsWith('/') || isWindowsPath(value)
}

/**
 * 从命令行参数中提取 `.cunlian` 项目文件路径（跳过可执行文件 `argv[0]`）。
 * - 处理外层双引号、空格与中文路径
 * - 忽略 `--` / `-` 开头标志（含 `--open-dxf=...`、`--user-data-dir=...`）
 * - 仅匹配 `.cunlian` 后缀（大小写不敏感，且必须有非空文件名主干）
 * - 若传入相对路径且提供了 `workingDirectory`，则按对应平台规则解析
 */
export function extractCunlianArg(
  argv: readonly string[],
  workingDirectory?: string,
): string | null {
  for (let index = 1; index < argv.length; index += 1) {
    const raw = argv[index]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('-')) continue
    const unquoted =
      trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
        ? trimmed.slice(1, -1)
        : trimmed
    if (unquoted === '' || unquoted.startsWith('-')) continue
    if (!unquoted.toLowerCase().endsWith(CUNLIAN_EXT)) continue
    const stem = unquoted.slice(0, -CUNLIAN_EXT.length)
    if (stem === '' || stem.endsWith('/') || stem.endsWith('\\')) continue
    if (workingDirectory !== undefined && workingDirectory !== '' && !isAbsoluteAnyPlatform(unquoted)) {
      return isWindowsPath(workingDirectory)
        ? path.win32.resolve(workingDirectory, unquoted)
        : path.resolve(workingDirectory, unquoted)
    }
    return unquoted
  }
  return null
}

/** 启动参数 `--open-dxf=<绝对路径>` 只排队给 renderer 看图，不打开项目。 */
export function extractDxfArg(argv: readonly string[]): string | null {
  const found = argv.find((argument) => argument.startsWith(DXF_ARG_PREFIX))
  if (found === undefined) return null
  const value = found.slice(DXF_ARG_PREFIX.length)
  return value === '' ? null : value
}

export interface OpenFileRouter {
  enqueueColdStart(argv: readonly string[], workingDirectory?: string): string | null
  handleSecondInstance(commandLine: readonly string[], workingDirectory?: string): string | null
}

/**
 * 统一路由冷启动命令行与 `second-instance` 事件中的 `.cunlian` 路径，
 * 使 Windows 双击/命令行打开与 macOS `open-file` 走相同的项目打开队列与回调。
 */
export function createOpenFileRouter(deps: {
  queue: string[]
  onDeliver: (filePath: string) => void
}): OpenFileRouter {
  return {
    enqueueColdStart(argv, workingDirectory) {
      const target = extractCunlianArg(argv, workingDirectory)
      if (target !== null) {
        deps.queue.push(target)
      }
      return target
    },
    handleSecondInstance(commandLine, workingDirectory) {
      const target = extractCunlianArg(commandLine, workingDirectory)
      if (target !== null) {
        deps.onDeliver(target)
      }
      return target
    },
  }
}
