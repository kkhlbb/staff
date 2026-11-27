# M0 板件资源、worker 与候选包证据

2026-11-23，`agent/gpt-agent-refactor-m0`。本轮证据范围为开发态资源暂存和独立 worker。契约候选 2、交接快照与既有测量归档继续作为基线。

## 资源与任务隔离

- 使用仓库锁中的 Replicad 1.2.1 版本和 tarball 完整性项，以及准备器内固定的五个发行文件 SHA-256。保留原 `package.json` 的模块语义、`LICENSE`、`dist/replicad_single.cjs`、同目录 ESM 与 WASM。生成的 worker 和输入夹具也写入严格资源清单。准备回执给出清单 SHA-256，启动时从独立保管的准备回执取摘要。禁止从待验资源现算摘要回填。发行文件的固定指纹另行核验。
- 验证器只按固定文件清单读取，逐层拒绝目录及文件符号链接，文件打开时使用 `O_NOFOLLOW`，并核对目录成员。暂存目录由准备脚本新建。此流程假定暂存根及其父目录由构建者控制，验证至执行期间保持稳定。候选包需以受控构建和签名流程封闭这一边界。
- worker 以独立任务 ID、尝试号、探针协议版本和夹具 SHA-256 绑定结果。worker 重新计算本地夹具指纹，调用方只接受身份一致且正常退出的结果。取消和超时先封住接收端，再终止 worker。worker 只返回内存报告。独立测量脚本只向新建的证据子目录以排他方式写 STEP 和 JSON。生产服务、持久化与双入口接线仍待后续阶段。

## 几何来源与分发证据差距

来源为归档 `reviewed-geometry-sources-20261123.md` 中已审查的静态资料。按实际运行与分发证据分别记录。

| 项目 | 已掌握 | 待补证据 |
| --- | --- | --- |
| 几何 ABI 和构建来源 | 锁定 Replicad 1.2.1 的 single CJS、ESM、WASM 已加载并调用建模、布尔、变换、量测及 STEP 写读。发行包 gitHead 为 `5e4ad9bb5a35bb9ae0571e91c25fa1897ba0570c`。现有 WASM 字符串支持 OCCT 8.0 系列。 [npm 固定元数据](https://registry.npmjs.org/replicad-opencascadejs/1.2.1) · [固定发行包](https://registry.npmjs.org/replicad-opencascadejs/-/replicad-opencascadejs-1.2.1.tgz) | 将实际 WASM SHA-256 对应到 OCCT 源 commit、补丁号、修改和完整构建输入。V8_0_1 的版本声明仅对应该官方标签。 [OCCT V8_0_1 版本声明](https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/adm/cmake/version.cmake) |
| A01 边界及 STEP | 实体包围盒关闭网格和形状容差扩展，按既有数值允差判定；STEP 在同一 WASM 绑定的新实例读回。 [OCCT V8_0_1 包围盒](https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/ModelingAlgorithms/TKTopAlgo/BRepBndLib/BRepBndLib.hxx) | 候选包内 A01 及独立几何读回。当前 Python 环境缺 OCP。 |
| A05 与 A06 | 有符号间隙取平行基准面沿变换后局部法向的投影差，接触及重叠另有布尔证据。上游最小距离 API 提供最短距离。 [OCCT V8_0_1 最小距离](https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/ModelingAlgorithms/TKTopAlgo/BRepExtrema/BRepExtrema_DistShapeShape.hxx) | 候选包内 A05 及独立量测，补有页码的任务书 PDF 和指纹。 |
| 引用和图纸 | 上游 TNaming 静态声明涉及标签和上下文。发行包有 HLR 和网格声明。 [OCCT V8_0_1 拓扑命名](https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/ApplicationFramework/TKCAF/TNaming/TNaming_Naming.hxx) · [Replicad 1.2.1 发行包](https://registry.npmjs.org/replicad-opencascadejs/-/replicad-opencascadejs-1.2.1.tgz) | 项目仍需验证运行绑定、稳定角色重绑、投影和图纸映射。 |
| 分发 | 暂存包含上游 LICENSE，准备回执将 LGPL-2.1-only 标为上游声明，分发审查明确待完成。OCCT 标签含额外例外文本。 [Replicad 1.2.1 元数据](https://registry.npmjs.org/replicad-opencascadejs/1.2.1) · [OCCT V8_0_1 例外](https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/OCCT_LGPL_EXCEPTION.txt) | 对应源码及提供方式、补丁与构建配置、适用声明和许可文本、实际可替换或重链方案及测试、SBOM、分发审查均待闭环，当前不能发布。 |

## 候选 arm64 包待办

以下是待评审的最小配置 diff。候选构建前，由受控流程将通过验证的暂存根以 `geometry-prototype` 为目录名交给 Packager，另存独立的可信摘要。候选包中的资源位置为 `process.resourcesPath/geometry-prototype`。

```diff
--- a/forge.config.ts
+++ b/forge.config.ts
@@
 const electronZipDir = process.env.ELECTRON_ZIP_DIR
+const geometryPrototypeDir = process.env.CUNLIAN_M0_GEOMETRY_RESOURCES
@@
-    extraResource: [prepareStepAssets()],
+    extraResource: [
+      prepareStepAssets(),
+      ...(geometryPrototypeDir === undefined ? [] : [geometryPrototypeDir]),
+    ],
```

1. 保持 `step-narrow-v1` 及其供应链白名单、旧断言原样。板件单独设资源成员白名单、版本及摘要，审核实际包中外置目录与 ASAR 成员，验证随包可信摘要入口。候选专用的包后检查须验证板件存在与清单一致，现有 PDF 和隔套包后检查继续执行。
2. 先核验用户原始权限答复，再决定 Forge 正常启动路径。以真实候选 arm64 包，在干净用户目录及含空格安装路径打开旧项目和独立未提交草稿，验证重开及 A10 四组判定。
3. 用该候选包验 A01、A05，使用独立几何路径复核并分别归档。发布另需完成上表供应链及分发门槛。后续阶段另有真实双入口验收。

## 本轮执行记录

证据目录 `/private/tmp/cunlian m0 runtime.xku0U6`。下文用 `$e` 指该目录，`$staged` 和 `$digest` 取自其中独立的 `preparation.json`。原测量归档保留。

| 实际命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `node --test desktop/tests/projectAgentM0.node.mjs desktop/main/geometry-prototype/plate.test.mjs` | 0 | 32 通过，规则与契约 28、直接几何 4 |
| `node --test desktop/main/geometry-prototype/resources.test.mjs` | 0 | 9 通过，含原 4、新故障注入 5 |
| `node --test desktop/main/geometry-prototype/probe.test.mjs` | 0 | 8 通过，含身份、尝试、协议版本、夹具指纹、超时、取消和迟到结果 |
| `npm run test:desktop -- desktop/tests/{projectAgentCompatibility,draftSyncTransactions,draftSyncLegacy,projectService,projectChannels,stepKernel}.test.ts` | 0 | 6 文件，40 通过 |
| `npm run test:mcp` | 0 | 3 文件，22 通过 |
| `npm test -- src/domain src/project-file` | 0 | 16 文件，219 通过 |
| `node --test scripts/step-license.test.mjs scripts/verify-step-supply.test.mjs` | 0 | 27 通过，隔套许可和供应链测试 |
| `npm run mcp:smoke -- --log "$e/frames.ndjson" --out "$e/mcp-artifacts"` | 0 | 1 次 stdio 旧入口运行，5 个工具无错误 |
| `npm run typecheck`、`npm run typecheck:desktop`、`npm run lint` | 各 0 | 类型和 lint 通过 |
| `npm run build` | 0 | 普通构建通过，Vite 报压缩处理后有超过 500 kB 的分块 |
| `node scripts/geometry-prototype.mjs prepare "$e"` | 0 | 暂存及独立准备回执。上游许可字段和分发待审状态已区分 |
| `node scripts/geometry-prototype.mjs smoke "$staged" "$digest"` | 0 | Node 26.12.1 arm64，开发态 worker |
| `file "$electron"`、`test -x "$electron"`、`/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$plist"` | 各 0 | 只读检查现有 Electron，Mach-O arm64、可执行、45.2.3 |
| `ELECTRON_RUN_AS_NODE=1 "$electron" scripts/geometry-prototype.mjs smoke "$staged" "$digest"` | 0 | Electron 45.2.3 / Node 24.22.2 arm64，开发态 Node 模式，仅加载本隔离树脚本 |
| `node desktop/main/geometry-prototype/run.mjs "$e"` | 0 | 新证据子目录中的 STEP 和 JSON |
| `python3 -B -c 'import OCP; print(OCP.__version__)'` | 1 | 当前解释器缺 OCP，未安装 |
| `git diff --check` | 0 | 已跟踪差异检查，另查本轮新增文件尾随空白 |

测试集合合计 357 通过。其中规则、几何、资源及 worker 共 49。五工具 stdio 和运行时烟测另计。Electron 二进制位于本机既有 Electron 应用的 `Contents/MacOS/Electron`，`$plist` 为对应 `Contents/Info.plist`。未执行 Forge，既有权限阻塞仍待核验。Electron 这次只运行 Node 模式，无应用包或 UI 验收证据。

对照 `node-measurements.json` 和 `electron-node-measurements.json`，几何报告字段完全一致，比较断言见 `runtime-comparison.json`。A01 包围盒 80 × 50 × 8 mm，体积 30743.36293856409 mm³，同绑定 STEP 读回 30743.36293856405 mm³。A05 两种姿态名义间隙均为 2 mm，区间 [1.700000000000001, 2.3] mm。A06 两种姿态均复现接触和约 0.1 mm 的轴向重叠。独立模型复核和候选包 M0 门槛仍待满足。
