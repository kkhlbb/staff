import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PROJECT_DB_VERSION,
  probeDatabaseVersion,
  subscribeDatabaseVersionChange,
} from './db'

/** 焦点切换可能连续触发 focus 与 visibilitychange；探测至少间隔这么久。 */
export const DATABASE_VERSION_PROBE_MIN_INTERVAL_MS = 1_000

export interface DatabaseVersionWatchOptions {
  /** 本页代码期望的数据库版本；默认 PROJECT_DB_VERSION。 */
  expectedVersion?: number
  /** 仅测试注入；默认只读探测真实数据库。 */
  probe?: () => Promise<number | null>
  /** 两次探测之间的最小间隔；默认 1 秒。 */
  minIntervalMs?: number
}

/**
 * 便宜的跨版本探测：只在窗口重新获得焦点或标签页重新可见时读取一次
 * 数据库实际版本；发现库比本页代码新，就永久标记为过期，直到刷新页面。
 *
 * 旧页面每次操作都是短连接，不会收到 versionchange；单靠该事件会静默
 * 停留在旧界面。这里只做一次只读版本比较，不打开升级事务、不写数据。
 */
export function useDatabaseVersionWatch(
  options: DatabaseVersionWatchOptions = {},
): number | null {
  const expectedVersion = options.expectedVersion ?? PROJECT_DB_VERSION
  const minIntervalMs =
    options.minIntervalMs ?? DATABASE_VERSION_PROBE_MIN_INTERVAL_MS
  const probeRef = useRef<() => Promise<number | null>>(
    options.probe ?? probeDatabaseVersion,
  )
  useEffect(() => {
    probeRef.current = options.probe ?? probeDatabaseVersion
  }, [options.probe])

  const [staleVersion, setStaleVersion] = useState<number | null>(null)
  const staleVersionRef = useRef<number | null>(null)
  const lastProbeAtRef = useRef(0)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)

  const markStale = useCallback((version: number) => {
    if (staleVersionRef.current !== null) {
      return
    }
    staleVersionRef.current = version
    if (mountedRef.current) {
      setStaleVersion(version)
    }
  }, [])

  const checkVersion = useCallback(async (): Promise<void> => {
    if (staleVersionRef.current !== null || inFlightRef.current) {
      return
    }
    const now = Date.now()
    if (now - lastProbeAtRef.current < minIntervalMs) {
      return
    }
    lastProbeAtRef.current = now
    inFlightRef.current = true
    try {
      const actualVersion = await probeRef.current()
      if (mountedRef.current && actualVersion !== null && actualVersion > expectedVersion) {
        markStale(actualVersion)
      }
    } catch {
      // 探测失败只代表“这次不知道”；下一次焦点切换再试，不误报过期。
    } finally {
      inFlightRef.current = false
    }
  }, [expectedVersion, markStale, minIntervalMs])

  useEffect(() => {
    mountedRef.current = true
    const onFocus = (): void => {
      void checkVersion()
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        void checkVersion()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    // 长连接仍可能收到 versionchange；与焦点探测共用同一个“已过期”状态。
    const unsubscribe = subscribeDatabaseVersionChange((info) => {
      if (info.newVersion !== null && info.newVersion > expectedVersion) {
        markStale(info.newVersion)
      }
    })

    return () => {
      mountedRef.current = false
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unsubscribe()
    }
  }, [checkVersion, expectedVersion, markStale])

  return staleVersion
}
