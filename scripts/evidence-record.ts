/**
 * 显式刷新 V3-D 证据（人工运行，不随测试变化）：
 *
 *   npm run evidence:record
 *
 * 会重写 docs/evidence/V3-D/ 下的 before/after .cunlian、summary.json、
 * drawing-compare.html 与 commit/compare-diff.json。ZIP 条目含写入时间，
 * 每次运行的字节哈希会变，这是证据文件的正常属性。
 *
 * 本文件不在 `npm test`（include 只有 src/**）与 `npm run test:desktop`
 * （include 只有 desktop/tests/**）范围内，只有显式命令才会执行。
 */
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { recordEvidence } from '../desktop/tests/helpers/evidenceRecord'

it('刷新 docs/evidence/V3-D 证据文件', async () => {
  // 默认写仓库证据目录；CUNLIAN_EVIDENCE_DIR 可指向临时目录，用于验证脚本本身。
  const outDir =
    process.env.CUNLIAN_EVIDENCE_DIR ?? fileURLToPath(new URL('../docs/evidence/V3-D/', import.meta.url))
  const result = await recordEvidence(outDir)
  console.log(
    `证据已写入 ${outDir}\n` +
      result.files.map((file) => `  - ${file}`).join('\n') +
      `\nbefore ${result.beforeSha256} (${result.beforeBytes} 字节)` +
      `\nafter  ${result.afterSha256} (${result.afterBytes} 字节)`,
  )
}, 120_000)
