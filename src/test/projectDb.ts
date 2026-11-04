import { PROJECT_DB_NAME } from '../storage/projects'

/** 删除本测试专用的 IndexedDB，保证各测试从没有项目的初始状态开始。 */
export function deleteProjectDatabase(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(PROJECT_DB_NAME)
    request.onsuccess = () => {
      resolve()
    }
    request.onerror = () => {
      reject(request.error ?? new Error('deleteDatabase failed'))
    }
    request.onblocked = () => {
      reject(new Error('deleteDatabase blocked'))
    }
  })
}
