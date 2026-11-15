# ADR-004：隔套 STEP 固定低层 OCCT WASM（本地实现，发布仍阻塞）

状态：用户批准的有限实现；不代表已批准二进制再分发。替代 ADR-003 中仅针对
本隔套出口的“不引 B-rep 内核/不引 OCCT”限定，不扩展为通用 CAD 平台。

## 依据与选择

可靠样本：批准的 `step-spike/wasm-experiment-01/export.cjs`、`readback.cjs`、
`最终实验报告.md`，以及 `native-readback-01/最终验证报告.md`。
它们真实验证固定 1.2.1 低层绑定、AP214IS/mm 写出和原生 OCCT 8.0.1 读回；
原生与 WASM 仍属 OCCT 家族，不等于异厂商互通；无修复导入未获证明。

- 只安装 `replicad-opencascadejs@1.2.1`；不引高层 replicad、不手写 STEP、
  不使用高层默认 AP242 导出。固定发布 d.ts、上述实际脚本为 API 参考。
- 在 Node `worker_threads` 中实例化单线程低层内核，一次请求一个新 heap，
  不在 renderer 中载入。外圆柱减内圆柱得到真解析 B-rep，非网格。
- 直径、长度都是已有 domain 的整数 q：mm=q/10000；半径=q/20000，
  不先取整。沿 X 从 -L/2 至 L/2；无需修改 domain 公式/精度。
- 核验圆柱完成、布尔完成、有效 B-rep、单 solid/单闭 shell、4解析面、
  两圆柱半径、两平面、有限正体积及解析参考体积。
  孔轴三点不在材料且距离等于内半径；壁中点在材料且距离零。
  点验证使用真实 `BRepExtrema_DistShapeShape.InnerSolution/Value`，
  不冒充未绑定的 BRepClass3d。并非完整连续孔形证明。
- 用低层 `Interface_Static.SetCVal` 设置 `AP214IS`、两个单位 `MM` 并回读；
  schema整数为4。writer Transfer/Write 返回值直接比较字符串枚举（无 `.value`）。

## API 与错误

`desktop/main/cad/stepKernel.ts`：

```ts
generateStep(
  input: { innerDiameter: number; outerDiameter: number; length: number },
  options?: { signal?: AbortSignal },
): Promise<{
  bytes: Uint8Array; kernelVersion: string;
  wasmSha256: string; generatorVersion: string;
}>
```

`generatorVersion` 包含 `spacer-ap214is-v1` 与 worker 源字节 SHA-256；
`kernelVersion` 为 `replicad-opencascadejs@1.2.1 / OCCT 8.0`，不猜补丁号；
WASM SHA 固定 `a9335919fa64bfeaee3e241d3139ad134022682429c6688e20d8ca12093d33d9`。
STEP 头包含时间；不承诺重复导出字节确定性，不把 DXF 字节确定性门槛套到 STEP。

非法字段/额外字段、非正安全整数、超过 domain q 上界、逆/等径：
`STEP_INVALID_INPUT`。下面适配层限制：`STEP_UNSUPPORTED_GEOMETRY`。
并发仅一个 job；重叠请求 `STEP_BUSY`，无无界队列。运行期30秒超时
`STEP_TIMEOUT`；AbortSignal取消 `STEP_CANCELLED`。两者实际调用且等待
`worker.terminate()` 完成后才拒绝与释放 busy，成功也 terminate 回收 heap。
worker异常/退出/错误消息明确拒绝，不产生替代 STEP。

## 本出口支持范围（不修改 domain 接受范围）

所有直径及长度必须为 100..100000000 q（0.01..10000 mm）；径差
至少200 q（壁厚至少0.01 mm）；
`max(外径,长度)/min(内半径,壁厚,长度) <= 10000`。
不支持范围中的模型不能仅因 domain 输入有效就宣称可导出；明确拒绝且不静默
修正/钳制。该范围是保守数值守卫，不是整个参数空间鲁棒性认证。未加入圆角、
螺纹、偏心、倒角、通用体、导入 STEP、几何编辑或平台重构。

## 外置资源与复现

`npm ci` 后 `npm run step:assets` 从本 worktree 固定 npm 包及 worker 源准备
`node_modules/.cache/step-kernel/`；检查源与已审核 manifest 哈希，不自动更新。
Forge config 调用相同准备器，以 `extraResource` 拷入 `step-kernel`，外置 ASAR。
运行时生产态只认 `process.resourcesPath/step-kernel`；开发态从当前模块对应
worktree 的局部 asset（源码/Forge `.vite/build` 两种位置）解析。
绝不从共享树、spike、全局 npm 或网络 fallback。
缺失 `STEP_ASSET_MISSING`，不匹配 `STEP_ASSET_HASH`；主适配器及 worker
再次核验 JS、CJS桥、WASM、worker 固定字节。

`npm run test:step-kernel` 实际执行 WASM；`npm run test:desktop` 前自动准备资源。
`npm run check:package:step -- <实际 Resources/resources 目录>` 检查 app.asar、
外置资源哈希、完整许可文本；此脚本只验证资源，不声称成包运行通过。
普通测试不写 docs/evidence，也不通过环境变量兼做采集器。独立采集入口为
`vitest.step-evidence.config.ts`（必须显式设置新的 STEP_EVIDENCE_DIR），原生读回与
成包走查见 `scripts/step-evidence/`；普通 test include 不包含这些脚本。

本轮 red/green、安装和 typecheck 日志及20/32/12与奇数内径q=200001两件
位于用户指定仓库外 `step-product-evidence/kernel/`；首次缺模块 RED 与随后
开发路径解析失败均保留。成包与IPC/UI/全量验收由父任务另行完成。
超时测试加速计时器，但仍创建并实际 terminate 真正 Node worker，不假造终止。

## 许可与发布门禁

复制批准 spike 保存的完整 LGPL 2.1 与 OCCT exception 至 cad/licenses，准备器
随外置资源拷贝；显著使用告知与未闭合项见 `THIRD-PARTY-NOTICES.md`。
精确编译 provenance、完整对应源码及供给方案、静态组合组件 SBOM/许可、
适用 LGPL 第6节替换/重链接/调试修改库权利仍未闭合。固定哈希检查不是合法
替换机制的证明。不得把这些本地成功测试当成分发批准；不打包 Python/OCP。
平台、异厂商、无修复导入、干净离线环境及完整参数空间验证均不在本 ADR
已经通过的声明中。
