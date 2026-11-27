# M2-BE-01 引擎验收

2026-11-24 · `agent/gpt-agent-refactor-m1-entry-20261123-1948` · macOS 26.4 (25E246) arm64 · Node.js 26.12.1 · Replicad OpenCascade.js 1.2.1。独立读回使用 Python 3.9.6 和原生 OCP 7.7.2.0 arm64。

任务书为 `desktop/tests/fixtures/agent-refactor/mounting-plate-taskbook.pdf`，SHA-256 为 `d455a7fa1d91741ec94b14ff6b4a63036b6d09f5e75a6c506875dd8d063b9c42`。PDF 回归确认第 1 页 MP-01–03、第 2 页 MP-04–05。实现沿用 M0 的 OCCT WASM 构形、布尔、精确量测、STEP 和 worker 任务隔离。参考来自 [M0 几何验证与上游资料索引](../agent-refactor-m0/geometry-runtime-verification.md)。

## 验收结果

| 验收项 | 实测 |
| --- | --- |
| A01 实体 | 1 个有效实体。局部包围盒从 (0,0,0) 到 (80,50,8) mm。两只 Ø10 mm 孔的中心为 (20,25) 和 (60,25) mm，轴向 +Z，柱面贯穿 Z=0–8 mm。直接 BRep 体积 30,743.36293856409 mm³，等于 32,000−400π mm³。全新 WASM 实例和独立原生 OCP 的 STEP 读回体积均为 30,743.36293856405 mm³。 |
| A01 网格和图纸 | 板件 356 个三角形。拾取用 worker 执行身份标识的帧内三角形范围，范围关联特征编号和可用角色。主、俯、右侧视图分别为 80×8、80×50、50×8 mm，含解析线段、圆、隐藏线和 9 个带持久引用的实测标注。三个错误代码分别为 `projectionFailed`、`annotationConflict` 和 `missingReference`。 |
| A02 · X=60 | 名义 15 mm，区间 [14.75,15.25] mm。MP-03 通过，最差余量 +1.75 mm。 |
| A03 · X=61 | 名义 14 mm，区间 [13.75,14.25] mm。MP-03 通过，余量 +0.75 mm。左孔 X=20 mm，图纸右孔 X 标注更新到 61 mm。 |
| A04 · X=62 | 名义 13 mm，区间 [12.75,13.25] mm。MP-03 失败，欠 0.25 mm，引用 `hole-2/hole.right.axis` 和 `plate-1/plate.rightFace`。恢复 X=61 后重算通过。 |
| A05 间隙 | 世界 X 轴旋转 0° 与 90° 时，沿局部 +Z 名义均为 2 mm，区间 [1.7,2.3] mm，MP-05 均通过，最差余量 +0.2 mm。独立原生间隙读数均为 2、1.700000000000001、2.3 mm。角度变化 1° 时 MP-05 返回 `uncovered`。 |
| A06 固定姿态 | 固定板厚 8 mm、盖板沿局部 +Z 厚 1 mm，0° 与 90° 均得到同样分类。底 Z=8 为 `contact`，共体积 0 mm³。Z=7.9 为 `interference`，轴向重叠 0.1 mm，原生共体积 384.2920367320492 mm³。Z=10 为 `clearance`，间隙 2 mm，共体积 0 mm³。 |
| A12 引用失效与重绑 | 删除 `hole-2` 后以及同径同位新建 `hole-3` 后，旧引用均失效。MP-02、MP-03 进入 `needsClarification`，右孔直径、X、Y 三条标注报告缺引用。显式重绑到 `hole-3` 后，检查和标注重算，MP-03 恢复 [14.75,15.25] mm 并通过。 |

A02–A04 保留原来的 X、Y、直径变量 ID。最小值用 X 上界和孔径上界，最大值用二者下界。Y 独立变化于 [24.8,25.2] mm，在两种极值组合中均取整个区间。A05 背向变化来自板厚和盖板底面变量。建模容差使用 OCCT 的 10⁻⁷ mm，显示精度为 2 位小数，公差输入保存为 0.0001 mm 的整数 q。

## 独立测量路径

1. 通过 `createMountingPlate` 和 `runMountingPlate` 重放模型，分别导出基准板、两端板厚 7.8/8.2 mm 及右孔 X=61/62 mm 时的局部 STEP。A01 回归先用同绑定的全新 WASM 实例完成 `readA01`。
2. 本地临时环境中的原生 OCP 用 `STEPControl_Reader` 传输根，`BRepBndLib.AddOptimal_s` 关闭网格与形状容差扩边，`BRepGProp.VolumeProperties_s` 计算实体体积，`BRepAdaptor_Surface` 遍历几何面得到柱面轴向、孔径及 XY 中心。A02–A04 从读回的右端 X 和右孔中心及半径用 Decimal 独立计算名义与极值。三份 STEP 的左孔 X 均为 20 mm。
3. OCP 用 80×50×1 mm 原生盒体构造盖板，使用 `gp_Trsf` 将它和读回板件一同转 0° 或 90°。分别用原生平面位置向局部法向的投影差和 `BRepAlgoAPI_Common` 共体积，验证 A05 名义和两端组合及 A06 接触和干涉。位置和体积比较容差为 10⁻⁷（对应 mm 与 mm³）。A12 另由序列化定义和带引用报告的回归断言检查，STEP 本身用于几何交换。

本次独立原生量测临时 STEP 的 SHA-256。验收后临时环境和 STEP 已清理。

| 板件输入 | SHA-256 |
| --- | --- |
| 板厚 7.8 mm | `1f3c7be6776a73819951a0f8cf8953907da2f09e8dc438118f227497aec077a9` |
| 基准 | `d1158fe9d4e5636b765ffef67033f2a4091748f3ee0a61897039e28af6f361b7` |
| 板厚 8.2 mm | `df48ac16ad264ea13765cf859c381522394423cfa3e23afac94f0b72831ed455` |
| 右孔 X=61 mm | `26e2fe88fd6321210bf742cbb7783618e2fa920889b556a486ef040194a573f0` |
| 右孔 X=62 mm | `b04614df702320baa7db8d2fbb8760e9a7b77ec41fd01e9109f30b07884b5e82` |

## 命令及结果

| 命令 | 退出码 | 计数 |
| --- | ---: | --- |
| `npm run test:desktop -- desktop/tests/projectAgentM2Engine.test.ts` | 0 | 1 文件，12 通过 |
| `npm run typecheck` | 0 | app、node、mcp 三个 TS 项目 |
| `npm run typecheck:desktop` | 0 | desktop TS 项目 |
| `npm run lint` | 0 | 无诊断 |
| `npm run test:mcp` | 0 | 3 文件，23 通过 |
| `npm run test:desktop -- desktop/tests/projectAgentM1*.test.ts desktop/tests/projectAgentCompatibility.test.ts desktop/tests/preloadContract.test.ts desktop/tests/mountingPlateTaskbook.test.ts` | 0 | 19 文件，154 通过 |
| `node --test desktop/tests/projectAgentM0.node.mjs` | 0 | 28 通过 |
| `node --test desktop/main/geometry-prototype/{plate,probe}.test.mjs` | 0 | 12 通过 |
| `git diff --check` | 0 | 已跟踪工作树差异 |
| 逐文件检查尾随空白、文件末尾空行与冲突标记 | 0 | 本次交付全部文件 |
| 原生 OCP 独立 STEP 读回及量测 | 0 | A01 一份基准，A02–A04 三组，A05/A06 两姿态各五组 |

## 交付文件

- `desktop/main/geometry-prototype/plate.mjs` · 复用 M0 构形、读回和量测。
- `desktop/main/geometry-prototype/plate.d.mts` · 测试所用内核和 STEP 读回声明。
- `desktop/main/geometry-prototype/probe.mjs` · worker 传入重放载荷。
- `desktop/main/project-agent/m2/model.mjs` · 板件定义、孔编号分配和明确重绑。
- `desktop/main/project-agent/m2/model.d.mts` · 重放模型声明。
- `desktop/main/project-agent/m2/engine.mjs` · 引擎入口和执行身份。
- `desktop/main/project-agent/m2/engine.d.mts` · 结果、图纸、检查和执行选项声明。
- `desktop/main/project-agent/m2/worker.mjs` · 隔离执行入口。
- `desktop/main/project-agent/m2/solid.mjs` · 几何回放、角色复核、网格和装配量测。
- `desktop/main/project-agent/m2/drawing.mjs` · 局部正投影和图纸标注。
- `desktop/main/project-agent/m2/evaluate.mjs` · 解析公差、固定姿态、依赖失效和报告。
- `desktop/tests/projectAgentM2Engine.test.ts` · 引擎验收。
- `docs/agent-refactor-m2/m2-be-01-verification.md` · 本报告。

## 适用边界

这次验证覆盖 macOS arm64 开发态 Node worker 和规定的夹具。正投影面向矩形板及垂直圆形贯穿孔，使用局部坐标约定；装配分析使用覆盖整个板件 XY 投影的平行参考盖板和共同刚体放置。任意实体通用投影、旋转公差求解和拓扑分裂超出本引擎的夹具范围。版本字符串由调用方随编辑提供，调用方按 worker 执行身份消费当前网格。安装包运行、非 arm64 或其他 OS、内核分发及许可闭环均待验证。BE-02 的 `buildAndCheck`、`locateM2Evidence`、IPC、正式版提交和双入口联调留待后续。
