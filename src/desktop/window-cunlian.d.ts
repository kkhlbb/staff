import type { CunlianApi } from '../../desktop/shared/contracts'

declare global {
  interface Window {
    /** preload 通过 contextBridge 暴露的具体函数集合，不存在通用 invoke/send。 */
    cunlian: CunlianApi
  }
}

export {}
