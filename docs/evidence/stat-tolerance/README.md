# 统计公差（RSS + 蒙特卡洛）与图能从任一版本重出

分支 `agent/stat-tolerance`（基线 `main` = `9c8ab6b`）。未 merge / push / 删分支。

## 结论与边界

- **判定没有换依据**：条款判定仍只由 `calculateChain` 的极值法给出，`status` 的
  计算路径没有一行属于统计法。RSS 与蒙特卡洛是**并列参考**，界面固定文案写明
  三者假设差异，并明确「统计区间较窄来自概率假设，不代表装配更容易合格」。
- **统计法不能替代判定**：有专门的用例构造「统计区间完全落在允许区间内、极值区间
  超出」的输入，断言 `status` 仍是 `outside`（见 `judgementInvariant`）。
- **蒙特卡洛可复现**：mulberry32（整数运算）+ Box-Muller；同种子、同输入三次运行
  的均值/σ/P0.135/P99.865 与样本指纹逐位相同（哈希相同，见下）。
- **交叉验证不凑数**：正态分布下 MC 的 ±3σ 与 RSS 的 ±3σ_C 相对偏差 **0.61%**
  （容差 2%）；均匀分布是另一种假设，偏差 **50.91%**，如实显示「超出容差，不调参凑数」。
- **重出只用冻结输入与模板版本**：版本创建时冻结 SVG/DXF 2000 字节摘要；重出从
  落盘 revision JSON 经生产解析器重建，逐字节对照；缺冻结输入或模板版本不受支持
  时明确报「不能重建」，不拿当前模板/当前参数凑图。
- 本单**不改**极值法公式、输入精度、判定口径与任何已有版本的图纸字节。
- 口径说明：`AGENTS.md` 早期写着「不加统计法」，本单按任务卡新增统计**参考**（不参与
  判定），是用户明确要求的范围；判定口径与数值结果未变。

## 改动清单

领域层（纯函数，可单测）：

- `src/domain/statistics.ts`：`rssOf`（σᵢ=Tᵢ/6、σ_C=√Σσᵢ²、C₀±3σ_C）、
  `monteCarloOf`（正态/均匀抽样、必传种子、样本量、均值/σ/P0.135/P99.865/样本指纹）、
  `crossCheck`（±3σ 半径相对偏差，容差 2%）、`statisticalSummaryOf`（三法汇总 +
  固定假设文案）。不产出任何判定字段。
- `src/revisions/frozenExport.ts`：`computeDrawingExportDigest`（版本创建时冻结
  SVG/DXF 2000 摘要）、`revisionRebuildability`（只检查版本记录本身：有没有图纸
  输入、模板 ID/版本是否受支持、参数是否完整）、`redrawRevision`（重建 → 导出 →
  与冻结摘要逐字节对照；只读，不改版本记录）。
- `src/revisions/types.ts` / `src/revisions/rebuild.ts`：冻结输入的参数出处
  （`provenance`）现在随重建一起透传。此前 rebuild 丢弃 provenance，会让带读数来源
  的版本重建指纹不符（假失败）；这属于 B 的必要修复，不改数值。
- `src/revisions/commit.ts`：提交时把 `drawingExports` 摘要写进
  `revision.evidence`（`ProjectFileDrawingExportDigest`）。
- `src/project-file/types.ts` / `validation.ts`：`evidence.drawingExports` 为
  可选纯加法字段（旧版本缺省），zod 严格校验 sha256/byteSize/模板版本。

界面：

- `src/components/StatisticalReference.tsx`：极值法（标「判定依据」）在前，RSS 与
  蒙特卡洛并列，交叉验证给出具体百分比，固定假设文案；分布可切正态/均匀。
- 接入两处结果区：web 结果卡（`ResultPanel`）与桌面「尺寸链」页（`DesktopChainView`）。
  极值结果本身不隐藏、不改写。
- `src/pages/Workspace.css`：统计参考样式（沿用现有 panel 变量，不新增固定像素宽度）。

工具与证据：

- `scripts/stat-tolerance-evidence.ts`：三法表、交叉验证、同种子三次一致、判定不变。
- `scripts/drawing-redraw-evidence.ts`：两个历史版本重出 SVG/DXF 2000 + SHA 对照 +
  两个「不能重建」反例。
- `scripts/stat-tolerance-mutations.mjs`：M55/M56/M57/M58 变异红绿。
- `desktop/tests/e2e/statTolerance.mjs`：打包应用真实键入 + 截图。
- `vitest.statevidence.config.ts`：证据脚本专用配置（不进入常规测试套件）。

## A 统计公差：三法结果表（S=12.05，C = H − B1 − S − B2）

链：H 52.2 ±0.02、B1 20 ±0.01、S 12.05 ±0.01、B2 20 ±0.01（q=0.0001mm）；
允许区间 0.1000 ~ 0.3000 mm。完整数据见 `statistics.json`。

| 方法 | 区间 (mm) | 关键量 | 假设 |
|---|---|---|---|
| 极值法（判定依据） | 0.1000 ~ 0.2000 | Tc = 0.1000 mm；判定 within（下限边界相等） | 所有环同时取极限，无分布假设 |
| RSS | 0.123542 ~ 0.176458 | σ_C = 0.0088192 mm；3σ_C = 0.0264575 mm | 各环独立、正态、σᵢ=Tᵢ/6 |
| 蒙特卡洛（正态，种子 20261113，200 000 样本） | 0.123371 ~ 0.176521（P0.135/P99.865） | 均值 0.1499905 mm；σ = 0.0088306 mm | 与 RSS 同假设，数值解 |

**交叉验证**（MC ±3σ 半径 vs RSS ±3σ_C 半径）：

- 正态：RSS 264.575q；MC 下侧 266.198q、上侧 265.306q → 相对偏差 **0.6134%** ≤ 2%（在容差内）。
- 均匀：MC σ = 0.0153062 mm，区间 0.110118 ~ 0.189734，相对偏差 **50.91%** ——
  这是分布假设不同（均匀 σ = T/√12 ≈ T/3.464，不是 T/6），**如实显示，未调参**。

**同种子 3 次逐位一致**（各次 `sampleDigest` 的 SHA-256）：

    第 1 次 abdbd35621c636379ae417e1a52ffec04d92c77a7ce17281ef71a0d655987c52
    第 2 次 abdbd35621c636379ae417e1a52ffec04d92c77a7ce17281ef71a0d655987c52
    第 3 次 abdbd35621c636379ae417e1a52ffec04d92c77a7ce17281ef71a0d655987c52

换种子（20261114）样本指纹不同，证明种子真的参与抽样。

**判定不变**（`judgementInvariant`）：S=12.10、允许区间 0.0700 ~ 0.3000 mm 时，
极值区间 0.0500 ~ 0.1500（outside），RSS 区间 0.073542 ~ 0.126458 完全落在允许区间内；
`status` 仍为 `outside`，汇总里的极值行仍带 `judgementBasis: true`。

## B 图能从任一版本重出（字节一致）

版本创建时由 `buildCommitCandidate` 用生产导出函数冻结摘要；重出把 revision JSON
落盘 → 生产解析器 `parseRevisionFile` → `redrawRevision`，然后写回字节再读回算 SHA-256。
完整数据见 `redraw.json`，真实文件在 `redraw/`。

| 版本 | 冻结输入 | SVG SHA-256（冻结 = 重出 = 磁盘） | DXF 2000 SHA-256 |
|---|---|---|---|
| rev-1（S=12.00） | 模板 v1、1:1、q=120000 | `1242bdcb10e7a7d6ee99dad190e5ee03be58d41eeb10a86ded1cd1ebbac15183`（8694 B） | `672b955cab636f7c6d73fea4f6e03d2656b5a9528d4106c4434c14bc8d1b5e9c`（21103 B） |
| rev-2（S=12.05） | 模板 v1、1:1、q=120500 | `e595c83bed4759adb29150018d3d519acd9e86d71ded452b6ecadb685218132c`（8770 B） | `13f2e9bda52cdcad764ee8f87ce790d3dc6670244453e85871f1e1325467a416`（21210 B） |

- 两版字节不同（不是同一张图复制两遍）；rev-1 的 SVG 含 `12.000`、rev-2 含 `12.050`，
  证明重出用的是各自版本的冻结参数，不是当前参数。
- 独立读回：用第三方 MIT 解析器 `dxf-parser` 读磁盘上的重出 DXF，两版都是
  `$ACADVER = AC1015`（DXF 2000），尺寸文字分别为 `12.000` / `12.050`（`dxfReadback`）——
  字节不是自证，能被外部解析器按 DXF 2000 读出来。
- 重出是只读：重出后版本记录的 `dataFingerprint` 与 `evidence.drawingExports` 均未变。

**不能重建（如实结果）**：

| 构造的版本 | 结果 | 原因 |
|---|---|---|
| schema3 老版本（`drawings` 为空） | `ok: false` | 该版本没有冻结图纸输入（drawings 为空），不能重建 |
| 模板版本 v999（当前构建只支持 v1） | `ok: false` | 该版本模板版本 v999 不在当前构建支持范围（v1），不能重建；不拿当前模板冒充旧图 |
| 冻结摘要被篡改成别的 SHA | `ok: false` | 重出字节与冻结导出摘要不一致，不能冒充旧图（`detail` 指出 svg） |

## 截图（打包应用，真实键入）

`ui-result.json` verdict=pass；断言含：极值行标「判定依据」且在 RSS 之前、
种子与 100,000 样本、交叉验证百分比、假设文案两句关键措辞、极值结果未隐藏。

- `screenshots/01-three-methods.png`：同屏可见「计算结果 · 极值范围 0.110 至 0.190 mm」
  与「统计参考」三法并列。
- `screenshots/02-stat-reference.png`：统计参考整块 —— 极值法（判定依据）
  0.1100 ~ 0.1900 / Tc 0.0800；RSS 0.1255 ~ 0.1745 / σ_C 0.0082；
  蒙特卡洛均值 0.1500 / σ 0.0082 / P0.135~P99.865 = 0.1254 ~ 0.1744；
  交叉验证相对偏差 0.57%（容差 2.00%，在容差内）；下方为完整假设文案。

说明：桌面版「增删环未接入」，界面用正式链的三环变体（L3/L1/L2）演示；A 节数值表
用的四环链（H/B1/S/B2）由证据脚本证明。截图数值由真实键入产生，无 DOM 注入。

## 变异红绿

    node scripts/stat-tolerance-mutations.mjs

| 变异 | 改什么 | 结果 | 判死断言（原始输出在 `mutations/`） |
|---|---|---|---|
| M55 | RSS 半径改成 ΣT（直接相加） | 红 | `expected 1000 to be close to 88.19…`（σ_C）、交叉验证 `0.9116 > 0.02` |
| M56 | 蒙特卡洛忽略种子（每次不同） | 红 | 同种子三次一致 `expected 3 to be 1` |
| M57 | 判定改用统计区间 | 红 | 案例 A `expected 'within' to be 'outside'`、案例 C 反向、`status` 不读凭据用例 |
| M58 | 重出忽略冻结模板版本 | 红 | 模板 v999 用例 `expected true to be false`（本应报不能重建却重建成功） |

四条均为 AssertionError 判死（非编译失败），恢复后各自用例全绿（`*-green.log`）。

## 门禁（实际执行，日志在 `logs/`）

    npm run typecheck             0
    npm run typecheck:desktop     0
    npm run lint                  0
    npm test                     125 文件 / 1414 通过
    npm run test:desktop         321 通过 / 17 跳过（45 文件通过、2 跳过）
    npm run test:mcp             3 文件 / 22 通过
    npm run build                0（仅既有 >500kB chunk 警告）
    npm run package:desktop      0（含打包 PDF worker 断言 PASS）

新增测试 22 条：`statistics` 8、`frozenExport` 9、`StatisticalReference` 5；
本目录新增 5 份 JSON 触发 5 条证据守卫用例，故全量 1387 → 1414。跳过的用例未记通过。

打包使用本机 Electron 缓存 zip（`ELECTRON_ZIP_DIR=~/Library/Caches/electron/<hash>/`），
不访问网络。

布局回归：`node desktop/tests/e2e/layout.mjs` → `LAYOUT_RESULT=PASS checks=72`。
桌面「尺寸链」页新增统计参考后，`docs/evidence/ui-layout/` 的截图与 `layout-result.json`
按新界面刷新（布局契约仍全部通过）；这是本改动的可见结果，不隐藏。

## 未做项 / 已知问题

- **不做多链**：只做单条线性尺寸链；多链/并联链未实现。
- **不做非正态分布族**：只有正态与均匀两种抽样；不提供三角分布、截尾正态、工艺分布族。
- **不做工艺链**：不建模工序公差传递、加工能力指数 Cp/Cpk。
- **B 未接产品导出入口**：本单交付的是领域能力（`redrawRevision` + 冻结摘要）与字节
  一致性证明；桌面导出通道仍只导出当前版本，历史版本重出的按钮/主进程 IPC 未接。
- 桌面版每次渲染都会重算 100 000 样本蒙特卡洛（约 150 ms），切换页签/编辑时可能有轻微延迟；
  统计值不影响判定，也不写回模型。
- MC 抽样用 `Math.cos/sin`（Box-Muller）：同引擎同种子逐位一致；跨 JS 引擎/版本的理论
  末位差异未做跨引擎验证。
- 均匀分布与 RSS 偏差 50.91% 属假设差异，不作为缺陷，也不调参缩小。
- 未执行任何网络访问或模型调用：全部本地完成。
