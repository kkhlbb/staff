# 手绘草图入口：图片读数 + 图上框选

分支 `agent/sketch-input`（基线 `main` = `a5d0d39`）。未 merge / push / 删分支。

## 结论与边界

**这不是 OCR 单，本单一个字都没做图像识别。** 用户拍/扫一张草图 → 在图上框选 →
**自己输入**符号、基本尺寸、上下偏差、单位 → 走既有 `ingest_readings` 领域函数
（`ingestReadings`）与同一份 `ExtractionDraft`，`source.kind = 'image'`。

- 图片字节作为附件存进 `.cunlian`（`attachments/` + `sources/blobs.json`），与 PDF 同一套 blob。
- 框选坐标一律**原图像素**；界面上的缩放/平移/EXIF 旋转都在换算里消掉。
- 读数只进 `pending` 候选：`requiresVerification: true`、`batchConfirmable: false`、
  `evidence: []`（绝不声称图片里有这段文字）。
- **夹具是合成夹具，不是真实手绘照片**：现有产品导出图纸 PDF（`docs/evidence/V3-C/spacer-a4-1to1.pdf`）
  经 `sips` 转 PNG，再转 JPEG 并注入 EXIF 方向（`scripts/sketch-fixtures.mjs`），
  文件名全部带 `synthetic`。

## 改动清单

领域层（`src/sketch/`，纯函数，可单测）：

- `imageFormat.ts`：按文件头认 PNG/JPEG/HEIC；单张上限 20 MiB；HEIC 拒绝并给
  `sips -s format jpeg` 转换命令；界面固定文案「图上不测量，尺寸由你输入；框选只用来记住位置」。
- `orientation.ts`：读取 JPEG EXIF Orientation（1/3/6/8 支持；2/4/5/7 镜像方向明确报不支持，
  不猜近似方向）；旋转 90/270 时显示尺寸互换。
- `selection.ts`：屏幕（CSS px，含 zoom/pan）→ 显示方向像素 → 原图像素的双向换算；
  四向逆变换公式写在文件头；矩形取 min/max、四舍五入、夹紧、一条边为 0 时返回 null。
- `readings.ts`：提交载荷校验。**只接受**符号/基本尺寸/上下偏差/单位 + 原图像素 rect；
  多一个键（`mmPerPixel`/`scale`/`ratio`…）整批拒绝；不框选允许，但说明固定写「未框选，无位置」。
- `imageSize.ts`：只读 PNG IHDR / JPEG SOFn 的像素宽高，用于 main 校验 rect 在界内。

主进程：

- `desktop/main/sketchChannels.ts`：新增 `sketch:image-import` 与 `sketch:ingest-readings`。
  路径只来自系统对话框；lstat 常规文件；空/超限先拒；HEIC 明确提示；main 自算 SHA-256
  与像素尺寸；成功后写 document/revision/blob/attachment/event 并校验项目容器。
- `desktop/main/ingestReadings.ts`：新增 `sketchIngestIntoSnapshot`（图片哈希与尺寸校验、
  构造逐条 statement 与 region），复用同一个 `ingestReadings`。模型工具入口对 image
  仍返回 `UNSUPPORTED_SCOPE`——模型没有看图能力，也不该替用户框选。
- 出处结构：`AgentReadEvidence.source`（image）新增可选 `region: { index, rect|null }`；
  项目文件 schema 纯加法接受该字段；显示层标签变成
  「读数来源：图片，第 N 个框选」/「图片，未框选，无位置」。
- 计划应用（`planApplication`）补 `images` 列表：agent-read 图片出处按 imageId + sha256
  核验同一份字节，不因换版被误判失效。

界面：

- 新增「草图读数」页签（第 7 个）：图片列表、缩放/平移/适应窗口、真实拖框、
  已提交框选的只读回显、读数表单、提交与未核对结果。
- 已保存框选按原图 rect 换算回屏幕位置重画，不存显示坐标。
- 布局沿用 `ScrollArea`/局部滚动，不新增固定像素宽度。

## 实际执行结果

完整输出见 `logs/01..08`（退出码均为 0）：

    npm run typecheck             0
    npm run typecheck:desktop     0
    npm run lint                  0
    npm test                     122 文件 / 1387 通过
    npm run test:desktop         321 通过 / 17 跳过（45 文件通过、2 跳过）
    npm run test:mcp             3 文件 / 22 通过
    npm run build                0（仅既有 >500kB chunk 警告）
    npm run package:desktop      0（含打包 PDF worker 断言 PASS）

本机网络不可用（GitHub 不通），打包走本地 Electron 缓存 zip：
`ELECTRON_ZIP_DIR=<缓存目录> npm run package:desktop`（`forge.config.ts` 仅在该环境变量存在时
透传 `electronZipDir`，不设置时行为不变）。这是打包通路，不改应用内容。

新增测试：领域 `sketchGeometry` 25 条、`readings` 6 条、界面 `SketchPanel` 5 条、
桌面通道 `sketchChannels` 14 条，证据脚本 1 条；本目录新增 9 份 JSON 触发 9 条证据守卫用例，
故全量 1342 → 1387。跳过的用例未记通过。

## A：端到端（真实服务 + 真实提交）

`scripts/sketch-input-evidence.ts`（`npx vitest run --config vitest.sketchevidence.config.ts`）：

1. 导入 `fixtures/sketch-synthetic-base.png`（2400×1696）→ 断言附件字节 SHA-256 与 main 自算一致；
2. 三处框选 → 原图像素 rect `[120,300,240,130]`、`[700,480,280,120]`、`[1500,1200,250,140]`；
3. 三条读数，**L2 故意错 10 倍**（真值 0.5 mm，提交 5 mm）→ 候选原样保留 5.000 mm，不自动纠正；
4. 批量确认整批拒绝（`EXTRACTION_BATCH_REJECTED`、零写入）；未确认不能进计划（`NOT_CONFIRMED`）；
5. 真实逐条确认 → 应用 → 预览 → 授权 → 提交；磁盘项目解码后 `L2 = 5.000 mm` 仍在；
6. 真实导出 SVG，标题栏与技术要求的「依据」行出现
   「读数来源：图片，第 3 个框选，验收绘图员 提供；…」。

产物：`pending.cunlian`、`committed.cunlian`、`submit-response.json`、`drawing-source.json`、
`project-fragment.json`、`service-result.json`、`隔套-图纸-1_1.svg`。

`service-result.json` 里 `three-unverified-readings.candidates = 5` 是整份草稿的候选数
（3 条图片读数 + user-intent 装配式与隔套参数共 2 条），不是 5 条图片读数。

打包 UI：`node desktop/tests/e2e/sketchInput.mjs` → `ui-result.json` verdict=pass。

- `screenshots/01-sketch-selection.png`：图片 + 三个已提交框选（绿色，标「第 N 个框选 · L1/L2/L3」）
  + 红线文案「图上不测量…」。
- `screenshots/02-drag-box-pixel-rect.png`：真实鼠标拖框后，画布上方直接显示
  「已选出原图像素框 [668, 1077, 469, 185]（469×185 像素）」与红色虚线框。
- `screenshots/03-unverified-readings.png`：三条候选各自显示
  「读数未核对（来源：图片，第 N 个框选，验收绘图员 提供）」与「确认这条」单条按钮，无批量确认。
- `screenshots/04-drawing-tab.png`：应用内工程图页（该视口下画布被上方表单压扁，属既有布局）。
- `screenshots/05-committed-selection.png`：正式提交文件里的草图页，框选位置读回一致。
- `screenshots/06-exported-svg-title-block.png`：同一份真实导出 SVG 渲染，标题栏「依据」行
  可读「读数来源：图片，第 3 个框选，验收绘图员 提供；…」。

早期 e2e 曾因页签名精确匹配失败一次；那张失败诊断截图不作为通过证据，未入库。

## B：四向坐标对照（合成夹具，EXIF 1/3/6/8）

屏幕框固定 `[100, 60, 240, 140]`（CSS px，zoom=1、pan=0），原图 2400×1696：

| EXIF 方向 | 显示尺寸 | 原图像素 rect | 说明 |
|---|---|---|---|
| 1（0°） | 2400×1696 | [100, 60, 240, 140] | 不旋转 |
| 3（180°） | 2400×1696 | [2060, 1496, 240, 140] | 两轴翻转，取包围盒 |
| 6（顺时针 90°） | 1696×2400 | [60, 1356, 140, 240] | 宽高互换 |
| 8（顺时针 270°） | 1696×2400 | [2200, 100, 140, 240] | 宽高互换 |

对照表在证据脚本里是**手算常量**，与实现无关；实现输出与它逐项相等，且每条 rect 都提交进
候选出处 `source.region`（见 `four-orientation.json`）。桌面通道用例对同样四组做断言。

## C：出处可追（脱敏 JSON）

`project-fragment.json` 从**真实提交文件**解码后节选，含：
`kind: "agent-read"`、`source.kind: "image"`、`imageId`、`sha256`、`region: { index, rect }`、
`statement`（如「手绘草图读数：符号 L2，第 2 个框选（用户输入，非图像识别）」）、
候选/数值 `evidence: []`。断言不含 `image-ocr`、不含伪装成 `pdf-text` 的出处。

## D：边界（真实文件、真实拒绝）

`boundaries.json`：

- 21 MiB 图片：`TOO_LARGE`，提示「图片超过单张上限 20.0 MiB」；会话快照零变化。
- HEIC：`UNSUPPORTED_IMAGE_FORMAT`，消息含 `sips -s format jpeg "IMG_0001.HEIC" --out "IMG_0001.jpg"`。
  （夹具 `fixtures/sketch-synthetic-heic.heic` 是 20 字节文件头，仅用于验证明确拒绝。）
- 不框选直接填：允许，候选写着 `未框选，无位置`，`region = { index: 1, rect: null }`。
- 框选超出原图：`第 1 个框选超出图片范围（原图 1200×800 像素）`，不落库。
- 扩展名 `.png` 但字节不是 PNG/JPEG：按文件头拒绝。

## E：变异红绿

    node scripts/sketch-input-mutations.mjs

- **M52**（显示坐标直接当原图坐标存）：`selectionToSourceRect` 不做缩放/方向换算 →
  四向领域用例与桌面通道用例**均以 AssertionError 判死**；恢复 39 条全绿。
- **M53**（允许从像素推算尺寸）：`checkSketchReading` 接受 `mmPerPixel` 等系数 →
  「拒绝任何像素→毫米标定字段」与通道「夹带标定字段整批拒绝」**红**；恢复全绿。
- **M54**（把图片 base64 写进日志）：导入通道把 base64 追加到证据日志 →
  泄漏守卫 `base64-run` **红**；恢复绿。含 base64 的探针日志在记录守卫判定后删除，**未入库**。

变异补丁与红/绿原始输出在 `mutations/`。泄漏守卫：`node scripts/sketch-leak-guard.mjs`。

## 未做项 / 已知问题

- **未做 OCR / 手写识别 / 图形识别**，一个字都没做；Vision 在中文标注上不可用的结论沿用。
- **未做比例标定**：本版连标定入口都没有，尺寸全部由用户输入；没有像素→毫米路径。
- **HEIC 不支持**：只给转换命令，不静默失败，不转码。
- 夹具为**合成夹具**（产品导出图纸渲染 + 注入 EXIF），不是真实手绘照片；不代表真实拍照/扫描质量。
- 应用内工程图画布在 1440×1000 且任务侧栏展开时被上方表单压扁，标题栏看不清；
  本单用同一份真实导出 SVG 渲染补证（`06-exported-svg-title-block.png`），未改该既有布局。
- 镜像 EXIF 方向（2/4/5/7）不实现显示，明确提示先转正。
- 未验证真实手机照片的 EXIF 变体（如 HEIC 内 EXIF）；本机无真实样本。
- 未执行真实网络/模型调用：本机 GitHub 不通，全部本地完成；打包走本地 Electron 缓存。
