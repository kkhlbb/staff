import { createContext, useContext } from 'react'

/**
 * 当前数据库是否比本页程序新。由 DatabaseVersionGuard 提供；单独放在这里
 * 是为了让守卫组件文件只导出组件（React Fast Refresh 约束）。
 */
export const DatabaseStaleContext = createContext<number | null>(null)

/** 当前页面是否已经落后于本地数据库；null 表示正常。 */
export function useDatabaseStaleVersion(): number | null {
  return useContext(DatabaseStaleContext)
}
