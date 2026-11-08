import type { ReactNode } from 'react'
import { DatabaseStaleContext } from './databaseStale'
import { PROJECT_DB_VERSION } from './db'
import {
  useDatabaseVersionWatch,
  type DatabaseVersionWatchOptions,
} from './versionWatch'

export interface DatabaseVersionGuardProps {
  children: ReactNode
  /** 仅测试/特殊构建注入；默认 PROJECT_DB_VERSION。 */
  expectedVersion?: number
  /** 仅测试注入。 */
  probe?: DatabaseVersionWatchOptions['probe']
  /** 仅测试注入。 */
  minIntervalMs?: number
}

/**
 * 全局跨版本守卫：库已经升到比本页代码更新的版本时，在界面顶部常驻提示，
 * 并通过 context 锁住编辑入口。页面其余部分仍可阅读、滚动、导出备份；
 * 已经输入但未保存的草稿留在当前页面内存里，刷新前不会因为锁定而清空。
 */
export function DatabaseVersionGuard({
  children,
  expectedVersion = PROJECT_DB_VERSION,
  probe,
  minIntervalMs,
}: DatabaseVersionGuardProps) {
  const staleVersion = useDatabaseVersionWatch({
    expectedVersion,
    probe,
    minIntervalMs,
  })

  return (
    <DatabaseStaleContext.Provider value={staleVersion}>
      {staleVersion === null ? null : (
        <div
          className="database-stale-banner"
          role="alert"
          data-testid="database-stale-banner"
          data-expected-version={expectedVersion}
          data-actual-version={staleVersion}
        >
          <div className="database-stale-banner__body">
            <h2 className="database-stale-banner__title">
              数据库已升级到新版本，请刷新页面后再继续操作
            </h2>
            <p>
              本页运行的是旧程序（预期 v{expectedVersion}），本地数据库已经是
              v{staleVersion}。为避免把旧格式写进新库，编辑入口已锁定；当前页面中
              已输入的内容仍保留在内存里。刷新会加载新程序，但未导出的修改会丢失，
              可先导出 JSON 备份（不含来源附件）或复制需要保留的内容。
            </p>
          </div>
          <button
            type="button"
            className="database-stale-banner__reload"
            onClick={() => window.location.reload()}
          >
            刷新页面
          </button>
        </div>
      )}
      {children}
    </DatabaseStaleContext.Provider>
  )
}
