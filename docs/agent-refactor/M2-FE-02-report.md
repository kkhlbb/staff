# 任务卡 M2-FE-02 完成报告：中央画布真 3D 网格渲染与真 2D SVG 矢量图纸交互渲染（关闭 F05）

- **工作目录**：`/Users/aston/DSH/wt/dsh-agent-refactor-m0`
- **分支**：`agent/dsh-agent-refactor-m0`
- **任务目标**：扩展 `M2PreviewSnapshot` / `M2PreviewEvent` 与状态机支持真 3D 网格与真 2D 矢量图纸渲染、拾取、平移/缩放与按修订隔离，补齐自动化单测并通过全量前端校验。

---

## 1. 修改与新增文件清单（共 8 个文件：新增 4 个，修改 4 个）

### 新增文件（4 个）
1. `src/workspace/project-agent/M2ThreeMeshViewport.tsx`
   - 复用 `three` 渲染真实 3D 实体网格（`WebGLRenderer`、`PerspectiveCamera`、`BufferGeometry`、`EdgesGeometry`、`Raycaster`），支持鼠标拖拽旋转（orbit）、滚轮缩放（zoom）、点击网格命中 `faceIndex` 并经 `resolveMeshTrianglePick` 映射至 `objectId` 触发特征选中与高亮覆盖层渲染；完整释放几何/材质/渲染器与事件监听；在无 WebGL / jsdom 环境优雅降级为可交互 3D 投影 `<svg>`（支持旋转、缩放、点击三角面拾取），绝不抛未实现异常。
2. `src/workspace/project-agent/M2VectorDrawingViewport.tsx`
   - 使用真实 `<svg>` 渲染 `front`（主视图）/ `top`（俯视图）/ `side`（侧视图）多视图工程图，含实线轮廓（`<line data-primitive="line">`）、圆（`<circle data-primitive="circle">`）、隐藏虚线（`<line data-primitive="hidden-line" stroke-dasharray="3 2">`）、视图标题、单位、修订号、旧图回退标识与特征绑定尺寸标注（`<g role="button" data-svg-annotation-id="...">`）；支持鼠标拖拽平移、滚轮/按钮缩放（实时更新 `viewBox`）、适合窗口复位及点击 SVG 标注双向高亮 3D 特征。
3. `src/workspace/project-agent/M2CanvasGeometryRendering.test.tsx`
   - 新增 8 条自动化单元测试，覆盖 3D 三角形拾取映射、后端 `M2-BE-01` 网格/图纸规范化、按修订隔离 `drawingVector`、2D SVG 矢量 DOM 渲染与双向高亮、平移/缩放/复位及连续刷新状态保留、旧图回退不混入新修订标注、无 WebGL 与无几何数据优雅降级及零手动参数入口断言。
4. `docs/agent-refactor/M2-FE-02-report.md`
   - 本任务完成报告。

### 修改文件（4 个）
1. `src/workspace/project-agent/m2WorkbenchBridge.ts`
   - 扩展 `M2PreviewSnapshot`、`M2PreviewEvent`、`M2RetryDrawingResult`、`M2CanvasState` 增加可选 `modelMesh`、`drawingVector` 与按修订缓存 `drawingVectorByRevision`。
   - 导出纯函数 `resolveMeshTrianglePick(triangleIndex, triangleRanges)`、`normalizeM2ModelMesh(input)`、`normalizeM2DrawingVector(input)`。
   - 在 `createInitialM2CanvasState`、`reduceM2PreviewEvent`、`applyM2DrawingRetryResult` 中严格落实 `drawingVector` 按修订隔离（遵守 F06 / E2 / S5 守卫）。
2. `src/workspace/project-agent/M2CenterCanvas.tsx`
   - 接收可选 `modelMesh` 与 `drawingVector` props；有 `modelMesh` 时挂载 `M2ThreeMeshViewport` 并将拾取命中范围联动到 `onSelectFeature`；有 `drawingVector` 时挂载 `M2VectorDrawingViewport`，缺失时自动降级到既有结构化特征与标注视图。
3. `src/workspace/project-agent/ProjectAgentM1Workbench.tsx`
   - 向 `M2CenterCanvas` 透传 `modelMesh={canvasState.modelMesh}` 与 `drawingVector={canvasState.drawingVector}`。
4. `src/workspace/project-agent/ProjectAgentPanel.css`
   - 新增 3D 视口舞台、降级投影三角面高亮态与 2D SVG 矢量图纸/标注高亮态样式（无任何滑块或数字输入控件）。

---

## 2. 与后端 `M2-BE-01/02` 网格与图纸字段逐项对齐说明

### 2.1 3D 网格字段对齐（对照 `engine.d.mts`：`GeometryReport['mesh']` 与 `Mesh`）

| 后端 `M2-BE-01` 字段 | 前端规范化目标 `M2ModelMesh` | 适配与兼容策略（`normalizeM2ModelMesh`） |
| --- | --- | --- |
| `mesh: { plate: Mesh; cover: Mesh }` | 合并为单一 `M2ModelMesh`（保留 `frameId` 与 `partName`） | 顺序拼接 `plate` 与可选 `cover` 顶点，自动累加 `vertexOffset` 与 `triangleOffset`，保证全局 `triangleIndex` 连续无冲突 |
| `Mesh.positions: Axis[]`（`[x, y, z][]`） | `positions: readonly number[] \| Float32Array` | 自动展平为 `[x0, y0, z0, ...]`；若前端已传入扁平数组或 `Float32Array` 则直接保留 |
| `Mesh.triangles: [number, number, number][]` | `indices: readonly number[] \| Uint32Array \| Uint16Array` | 自动展平并应用顶点偏移；若已传入扁平 `indices` 则直接保留 |
| `normals?`（可选） | `normals?: readonly number[] \| Float32Array` | 传入时直接使用，缺失时由 `BufferGeometry.computeVertexNormals()` 自动计算 |
| `Mesh.objects: { featureId, role?, firstTriangle, triangleCount }[]` | `triangleRanges: { startTriangle, endTriangle, objectId, featureRef?, role?, partName? }[]` | 转换为左闭右开 `[triangleOffset + firstTriangle, triangleOffset + firstTriangle + triangleCount)`，`objectId = featureId`、`featureRef = role ?? featureId` |
| `measured.bounds: { min: Axis; max: Axis }` | `bounds: { min: M2Point3D; max: M2Point3D }` | 优先使用显式有效 `bounds`，缺失时由 `positions` 自动计算精确包围盒 |

### 2.2 2D 矢量图纸字段对齐（对照 `engine.d.mts` 与 `drawing.mjs`：`Drawing`）

| 后端 `M2-BE-01` 字段 | 前端规范化目标 `M2DrawingVector` | 适配与兼容策略（`normalizeM2DrawingVector`） |
| --- | --- | --- |
| `unit: 'mm'`、`revision: string`、`displayDecimals`、`convention` | 同名保留于 `M2DrawingVector` | 缺省 `unit` 兜底 `'mm'`，`displayDecimals` 夹紧至 `[0, 4]` 缺省 `1` |
| `views: { id: 'front'\|'top'\|'side', size: Point, u, v, geometry }[]` | `views: { id, title, size, u, v, lines, circles, hiddenLines }[]` | 同时兼容后端 `geometry[]` 与前端规范 `lines/circles/hiddenLines` 两种输入 |
| `DrawingGeometry { kind: 'polyline', closed: true, points }` | `lines: M2DrawingVectorLine[]` | 展开为首尾闭合线段数组，渲染为真实 `<line data-primitive="line">` |
| `DrawingGeometry { kind: 'circle', center, radius }` | `circles: M2DrawingVectorCircle[]` | 映射为 `{ cx, cy, r }`，渲染为真实 `<circle data-primitive="circle">` |
| `DrawingGeometry { kind: 'line', style: 'hidden', points }` | `hiddenLines: M2DrawingVectorLine[]` | 映射为隐藏线数组，渲染为真实 `<line data-primitive="hidden-line" stroke-dasharray="3 2">` |
| `annotations: { id, view, side, lane, valueMm, witnesses, reference: { role, featureId } }[]` | `annotations: M2DrawingVectorAnnotationAnchor[]` | 映射 `annotationId = id`、`linkedFeatureIds = [reference.featureId]`、格式化 `valueText`（孔径自动加 `Ø`），并与修订隔离的 `M2CanvasState.annotations` 协同渲染 |

### 2.3 向后兼容与按修订隔离守卫（F06 / E2 / S5）
- **完全向后兼容**：`modelMesh` 与 `drawingVector` 均为可选字段；缺失或为 `null` 时，3D 视图保留既有特征拾取区、2D 视图自动降级为既有结构化标注按钮区，不破坏任何既有工作流与单测。
- **F06 旧图保护**：当画布保留草稿 7 旧图时收到草稿 8 `model_ready` 或 `drawing_failed`，绝不覆盖或清空草稿 7 的 `drawingVector` 与 `annotations`；SVG 标题区明确标注 `旧图回退：保留 草稿 7 矢量与标注`，且绝不混入新修订标注。
- **E2 禁跨修订回退**：当收到新修订（如草稿 8）`drawing_ready` 且省略 `drawingVector`、同时 `drawingVectorByRevision['draft-8']` 无缓存时，置为 `null`，严禁回退展示草稿 7 旧矢量。
- **S5 重试图纸水位隔离**：`applyM2DrawingRetryResult` 同步更新对应修订的 `drawingVector` 与 `drawingVectorByRevision`，且严禁推进 `revisionSequences` 或 `lastEventSequence`。

---

## 3. 新增单元测试清单与通过结果

测试文件：`src/workspace/project-agent/M2CanvasGeometryRendering.test.tsx`（8/8 通过）

1. `resolveMeshTrianglePick 正确处理多段边界、越界、空范围与无效索引` — PASS
2. `normalizeM2ModelMesh 精确兼容后端 M2-BE-01 复合网格 { plate, cover } 与 objects 映射` — PASS
3. `normalizeM2DrawingVector 精确兼容后端 M2-BE-01 Drawing（polyline/circle/hidden line/annotations）` — PASS
4. `按修订隔离 drawingVector（F06 / E2 / S5）：草稿 8 模型不覆盖草稿 7 旧矢量，省略新矢量不回退旧矢量` — PASS
5. `渲染真实 2D SVG 矢量图元（实线/圆/隐藏虚线/特征标注/标题/单位/修订号）并支持 3D 拾取 ↔ SVG 标注双向高亮` — PASS
6. `支持鼠标拖拽平移、滚轮/按钮缩放、适合窗口复位，并在连续修订刷新后保留 3D 视角与 2D 平移/缩放状态` — PASS
7. `旧图回退（草稿 8 模型 + 草稿 7 旧图）明确标明旧图版本且不混入新修订标注` — PASS
8. `无几何数据（未提供 modelMesh / drawingVector）时优雅降级到既有结构化特征与标注视图且零手动参数入口` — PASS

---

## 4. 全部验收命令执行结果与冻结边界核查

在 `/Users/aston/DSH/wt/dsh-agent-refactor-m0` 依次执行以下全部验收项，均以退出码 `0` 通过：

| 验收命令 | 结果 | 详情 |
| --- | --- | --- |
| `npm run lint` | PASS（0 errors, 0 warnings） | ESLint 全量检查通过 |
| `npm run typecheck` | PASS | `tsconfig.app.json` + `tsconfig.node.json` + `tsconfig.mcp.json` 零错误 |
| `npm run typecheck:desktop` | PASS | `tsconfig.desktop.json` 零错误 |
| `npm test` | PASS | **150 个测试文件全部通过，共 1560 条用例全部通过**（含既有 1552 条 + 本次新增 8 条） |
| `npm run build` | PASS | `tsc -b && vite build` 产物构建成功（360 modules transformed） |
| `git diff --stat -- desktop/shared/contracts.ts desktop/preload desktop/main` | PASS（输出为空） | 冻结边界 **0 改动** |

---

## 5. 遗留问题与风险说明

- **无阻塞性遗留问题**。
- **说明**：在 jsdom 测试环境中浏览器原生 WebGL2/WebGL 上下文不可用，因此自动化单测在降级 3D 投影模式下验证了 3D 拾取与相机交互，WebGL 渲染路径（`WebGLRenderer` + `Raycaster` + GPU 资源 `dispose`）已通过 TypeScript 严格类型校验与静态构建验证；后续在 Electron 桌面真机集成联调阶段可配合真实 `M2-BE-01` 输出的 `GeometryReport` 做端到端 WebGL2 视觉抽检。
