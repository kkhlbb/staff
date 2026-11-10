# V3-D 交付证据（D 批：参数联动 / 原子确认 / 旧版恢复 / 双图对比）

状态：**实现与本地自测完成；未推送、未合并、未删除任何分支。**
最终提交：见 `git log -1 --oneline`（本文件与实现同属该提交）。

## 1. 基线与范围

- 工作树：`/Users/aston/DSH/wt/dsh-v3-A`
- 分支：`agent/dsh-v3-A`（按用户指示，**未新建分支/工作树**）
- 基线 HEAD：`7d734386792eace28568d7dc226c4b276a91e62b`（短号 `7d73438`）
- 任务卡：`/Users/aston/DSH/tmp/cunlian-v3/任务卡_V3-D.md`（339 行）
- 未改：`src/domain/*` 计算公式与 q 精度（1q=0.0001mm）、A/B1/B2/C 既有用例。

## 2. 命令与真实结果

| 命令 | 退出码 | 结果 | 原始日志 |
|---|---|---|---|
| `npm run typecheck` | 0 | app + node 两套 tsc 通过 | `typecheck.log` |
| `npm run typecheck:desktop` | 0 | desktop tsc 通过 | `typecheck-desktop.log` |
| `npm run lint` | 0 | eslint 无告警 | `lint.log` |
| `npm test` | 0 | **75 个文件 / 766 个用例全过** | `test.log` |
| `npm run test:desktop` | 0 | **21 个文件 / 154 个用例全过** | `test-desktop.log` |
| `npm run build` | 0 | vite build 成功（chunk 体积警告为既有） | `build.log` |
| `npm run package:desktop` | 0 | `out/寸链-darwin-arm64/寸链.app` | `package-desktop.log` |
| `npm run test:desktop:e2e` | **2（阻塞）** | 打包应用 20s 内未暴露 page target；提示已有“寸链”实例占用单实例锁 | `e2e-smoke.log` |

e2e 阻塞说明：本机存在由用户/先前流程启动的实例 PID 57204（`--remote-debugging-port=9337`）。
我没有权限也没有替用户结束进程，因此**未杀掉**；关闭该实例后可重跑本命令。e2e 未通过，不记作通过。

`.app` 产物：`out/寸链-darwin-arm64/寸链.app`
（arm64 / macOS 26.4；Electron 45.2.3；未做真实 Finder 双击与全流程录屏 → 未完成项）

## 3. 数值核对（bc 独立核算 + 内核实测）

`numeric-bc.txt`（系统 `bc` 输出）：

```
-18000
-18500
-17500
-19500
-20500
-1.8500
-1.7500
```

与 `calculateChain` 实测一致（`src/revisions/compute.test.ts`、`changeChannels.test.ts`）：

- nominal `-18000q`、min `-18500q`、max `-17500q`
- mm：`[-1.8500, -1.7500]`；判定 `outside`
- 下限缺口 `-19500q`（1.9500 mm），上限裕量 `20500q`
- 仅 S.nominal 变 120000→140000q；偏差/方向/target/其它环逐字段不变

## 4. 保存前后 `.cunlian` 指纹（真实提交）

证据靠 `npm run evidence:record` 显式生成，不随测试变化：该命令执行
`scripts/evidence-record.ts` → `desktop/tests/helpers/evidenceRecord.ts`，
真实跑完 stage→preview→apply 后把文件写入本目录。`desktop/tests/evidence.record.test.ts`
只在 `os.tmpdir()` 里校验生成出来的字节，跑单测不会重写这里的任何文件。

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `commit/before.cunlian` | 7628 | `4f866c9389ac0133bf31d7a5aebd4c670b9d93e9a2c60c3368944dc1fd5557b0` |
| `commit/after.cunlian` | 11564 | `b6088f33ed2b93e1d6afe40b45ae7dc3cc9a870d668555e876f48e62317ac88c` |

（ZIP 条目含写入时间，重跑证据脚本时文件哈希可能变化；`summary.json` 的参数/版本/事件 ID 断言稳定。）

`commit/summary.json` 记录：新版本 `rev-d-evidence-2`、父版本 `rev-a1`、
`currentRevisionId=rev-d-evidence-2`、长度参数 `140000q / parameterRevision=2`、
环 `termRevision=2`、图纸指纹、模板版本 1、分析快照 ID 与 3 条事件 ID。

## 5. 双图并排

- `drawing-compare.png`：真实双图截图（左 `rev-a1` 12.00，右 `rev-d-evidence-2` 14.00，
  各自比例/指纹，下方为字段级 diff 表）
- `drawing-compare.html`：同一证据的可复现页面，SVG 由项目内 `renderDrawingSvg`
  对**两版权威 DrawingData** 渲染
- `commit/compare-diff.json`：稳定 ID 字段级差异（parameter/annotation/version 等）

说明：这是由同一 SVG 序列化器渲染的真实数据，不是 Electron 窗口截图；
Electron 窗口的整体截图/录屏属未完成项（见 §9）。

## 6. 三条变异（红 → 恢复绿）

| 变异 | 破坏点 | 红色证据（退出码） | 恢复证据（退出码） | patch |
|---|---|---|---|---|
| MUT-D1 | 确认直接复用 `preview.computation`，跳过当前草稿重算 | `mut-D1-red.log`（1）：`expected 0 to be greater than 0`（提交期 calculateChain 调用次数为 0） | `mut-D1-green.log`（0） | `mut-D1.patch` |
| MUT-D2 | 去掉 baseToken 校验 + 关掉 rename 前 CAS 第二层 | `mut-D2-red.log`（1）：3 个用例变红——外部编辑后旧确认**成功提交**，改来源/目标同样通过，错误 baseToken 仅被 previewToken 挡下（错误码也不对） | `mut-D2-green.log`（0） | `mut-D2.patch` |
| MUT-D3 | 提交前先把参数/事件写进会话，再让文件写入失败 | `mut-D3-red.log`（1）：失败后会话里出现 140000q 参数与事件，而磁盘不变（部分数据） | `mut-D3-green.log`（0） | `mut-D3.patch` |

恢复后相关全套回归：`npm test` / `npm run test:desktop` 均 0，见 §2。
变异只在本地临时修改并已全部还原（`git diff` 无残留：见 §8）。

## 7. 专项验收覆盖

- LINK-01：`compute.test.ts`（整数/毫米极值、只改 nominal、annotationId 与 diff）、
  `changeChannels.test.ts`（预览→确认→磁盘重开一致）、UI 测试（12→14 预览/确认接线）。
- LINK-02 / D-STALE：改草稿、改后改回、外部编辑 A→B→A、错误 token 全部拒绝且零写入，
  草稿保留；确认期重算抛错零提交；rename 前 CAS 二次拒绝。
- D-ATOMIC：写失败（ENOSPC 注入）后内存聚合 JSON、acceptedSeq、磁盘哈希全部不变，
  草稿仍可预览；同一 `requestId` 重复确认只产生一个版本/一组事件/一个快照。
- D-RESTORE：B、C 两次提交后从 A 恢复，得到新草稿；确认清零、绑定记录继承、
  parameterRevision 只前进到 4、正式指针与旧版本数量不变。
- D-COMPARE：旧/新参数与标注文字差异可见；无图纸旧版返回 `left=null` +
  “没有图纸记录”，不伪造对比。
- D-MODEL / D-ROUNDTRIP：schema6 往返保留 parameterRevision/绑定/版本证据；
  读 schema5 文件补 `parameterRevision=1`、无第二套确认、历史版本原样；
  manifest 与 project.json schema 不一致直接拒绝；悬空/同环第二绑定拒绝。
- D-3D：`spacerGeometry.test.ts`（12→14 网格长度变化、其他部件位置/包围盒不变、
  装配/爆炸语义保留）；UI 把草稿参数传入 ThreeViewport。

## 8. 派生状态与单一真源

见 `derived-status.md`：逐项列出派生状态、读取的存储字段、禁止来源、变化后果与测试。
`status.test.ts` 逐字段证明：只改 `parameterRevision`、`termRevision`、
`drawingFingerprint`、`sourceBasis`（sourceNote 变化）或删除确认事件，任一变化都会把
“同步有效”变为“待核”，且原因具体。

## 9. 未完成 / 已知问题（不计通过）

1. **真实 Electron e2e 未通过**：被现有“寸链”实例的单实例锁阻塞（§2）；
   真实 Finder 双击/全流程录屏未做。
2. **1440×900 / 960×640 双尺寸 UI 走查未录屏**；仅 jsdom 组件测试。
3. **3D 仅隔套网格随参数变化**：左右轴承/挡圈位置不随隔套长度移动（保持 B1 固定
   装配语义），因此 14mm 时示意装配会出现轴向重叠；这是示意几何的已知限制，
   未伪装成完整装配联动。
4. **恢复只支持含隔套参数的版本**（schema5/6）；schema3/4 版本恢复返回明确
   拒绝（“没有隔套参数，不能恢复参数草稿”），未提供“只恢复尺寸链”路径。
5. **来源/PDF 换版在桌面端仍无导入通道**（B2/C 既有边界）；D-STALE 用
   `project:stage` 的外部编辑（acceptedSeq 前进）验证基准失效，未用真实 PDF 换版
   UI 操作验证。STL 替换会推进 acceptedSeq，但未单列专项用例。
6. **参数删除/改名未实现**（三参数固定，符合拍板第 1 条）；未做级联删除。
7. 预览/确认的 IPC 请求/返回未做 fuzz；zod strict + sender 白名单 + 既有契约测试覆盖。
8. `npm run build` 的 chunk >500kB 警告为既有，不是本批引入。

## 10. 文件索引

- `src/revisions/`：`canonical/digest/types/compute/commit/rebuild/status/compare` + 测试
- `desktop/main/changeService.ts`、`desktop/main/changeChannels.ts`
- `desktop/main/projectService.ts#commitCandidate`（guard/CAS + 原子保存）
- `src/components/ChangeWorkbench.tsx`（草稿/预览/五类分组/双图）
- `src/parts/shaftDemoGeometry.ts`、`threeScene.ts`、`ThreeViewport.tsx`（3D 隔套参数化）
- `src/project-file/{types,validation,codec,upgrade}.ts`（schema6）
