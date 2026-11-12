/**
 * 让 `node scripts/...mjs` 直接加载仓库内的 TypeScript 源码。
 *
 * node 的类型剥离（type stripping）能跑 .ts，但不做“无扩展名相对导入”的解析；
 * 仓库的 TS 源码统一写成 `from './parse'`，所以这里注册一个同步 resolve 钩子：
 * 先按原样解析，失败再依次尝试 `.ts` / `/index.ts` / `.tsx`。只补后缀，不改内容，
 * 也不做路径重写，因此加载到的仍是产品源码本体，不是另一份拷贝。
 *
 * 需要 node >= 24（module.registerHooks）。低于该版本时给出明确错误，不退回猜测。
 */
import { registerHooks } from 'node:module'

const SUFFIXES = ['.ts', '/index.ts', '.tsx']
let registered = false

function register() {
  if (registered) return
  if (typeof registerHooks !== 'function') {
    throw new Error(
      `当前 node ${process.version} 不支持 module.registerHooks；` +
        '真实文档度量需要 node >= 24（仓库 devDependencies 声明的 @types/node 也是 24）。',
    )
  }
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context)
      } catch (error) {
        if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw error
        for (const suffix of SUFFIXES) {
          try {
            return nextResolve(specifier + suffix, context)
          } catch {
            /* 试下一个后缀；全部失败时报原始错误 */
          }
        }
        throw error
      }
    },
  })
  registered = true
}

/** src/document-extraction 公共入口（buildExtractionDraft / buildPdfTextLayer / 阈值常量）。 */
export async function loadExtraction() {
  register()
  return await import('../../src/document-extraction/index.ts')
}

/** main 侧 PDF 文本层读取（与产品同一条 pdfjs legacy 路径）。 */
export async function loadPdfTextExtract() {
  register()
  return await import('../../desktop/main/pdfTextExtract.ts')
}

/** 证据 JSON 序列化（metrics.json / baseline.json 统一走它）。 */
export async function loadEvidenceJson() {
  register()
  return await import('../evidence-json.ts')
}
