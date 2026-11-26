import { spawn } from 'node:child_process'
import type { CommandRunOptions, CommandRunResult } from './types'

/**
 * Safe, no-shell (`shell: false`) process runner with hard timeout, output byte
 * cap, and AbortSignal cancellation. Never throws on missing binaries (ENOENT);
 * instead reports `errorCode` in the structured result.
 */
export function runExternalCommand(
  command: string,
  args: readonly string[],
  options: CommandRunOptions,
): Promise<CommandRunResult> {
  return new Promise(resolve => {
    if (options.signal?.aborted) {
      resolve({
        exitCode: null,
        stdout: '',
        stderr: '',
        cancelled: true,
      })
      return
    }

    let settled = false
    let timedOut = false
    let outputExceeded = false
    let cancelled = false
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0

    const finish = (result: CommandRunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort)
      }
      resolve(result)
    }

    let child
    try {
      child = spawn(command, [...args], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      finish({
        exitCode: null,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        errorCode: code,
      })
      return
    }

    const terminateChild = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Ignore kill failures if process already exited.
      }
    }

    const onAbort = () => {
      cancelled = true
      terminateChild()
    }

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true })
    }

    const timer = setTimeout(() => {
      timedOut = true
      terminateChild()
    }, options.timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      if (outputExceeded) return
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > options.maxOutputBytes) {
        outputExceeded = true
        terminateChild()
        return
      }
      stdoutChunks.push(chunk)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes > options.maxOutputBytes) return
      stderrBytes += chunk.byteLength
      stderrChunks.push(chunk)
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({
        exitCode: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8') || error.message,
        errorCode: error.code,
        timedOut,
        outputExceeded,
        cancelled,
      })
    })

    child.on('close', exitCode => {
      finish({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        outputExceeded,
        cancelled,
      })
    })

    child.stdin.on('error', () => {
      // Ignore EPIPE when child exits before reading stdin.
    })

    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin, 'utf8')
    } else {
      child.stdin.end()
    }
  })
}
