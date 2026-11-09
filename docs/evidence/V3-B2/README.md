# V3-B2 实施证据（STL 导入、格式 2、外形资料来源）

分支：`agent/dsh-v3-A`（不新开分支/工作树）
基线 HEAD：`4b05465`（merge(V3-B1)）
最终提交：本目录随实现提交一起入库，见交付消息中的 commit hash。
日期：2026-11-09（本机 macOS 26.4，arm64）

## 1. 交付范围

- B2-01 纯解析与上限：`src/parts/stlLimits.ts`、`src/parts/stlValidation.ts`、`stlValidation.test.ts`
- B2-02 存储与版本：`src/project-file/{types,validation,codec,upgrade}.ts`、`desktop/main/{newProject,projectService}.ts`、`versioning.test.ts`、`formatUpgrade.test.ts`
- B2-03 IPC 与界面：`desktop/main/{modelChannels,modelIo}.ts`、`desktop/preload/index.ts`、`desktop/shared/contracts.ts`、`src/workspace/{useImportedModel,desktopAdapter,useDesktopSession}.ts`、`src/parts/modelScene.ts`、`src/components/{ModelViewport.tsx,ModelViewport.css}`、`src/pages/DesktopWorkspace.{tsx,css,test.tsx}`、`src/project-file/__fixtures__/{b1-project-v1.cunlian,modelProjectFile.ts}`、`desktop/tests/{modelChannels,preloadContract}.test.ts`

未改 `src/domain/**`、`src/sources/limits.ts`、three 依赖源码、V2 备份格式；无 C/D 功能。

## 2. 格式与兼容

- 写端：`formatVersion=2`、`project.schemaVersion=4`、`dimensionChain.schemaVersion=2`（未变）。
- 读端：`formatVersion=1/schema3` 走原严格规则（五个预留数组仍必须为空），在内存适配为 B2 工作形状并记 `project.sourceFormatVersion=1`；不改磁盘、不产生 dirty。
- 首次保存：main 追加一个 schema4 文件版本（parent 指向旧 currentRevisionId），旧 schema3 历史原样保留；保存结果 `warnings` 写入“已升级为项目文件格式 2 … B1 及更早程序不能打开 … 不能无损降级”，UI 通过 notice 显示。
- 恢复草稿：沿用同一编码器，草稿中的 `sourceFormatVersion=1` 保留，恢复后第一次正式保存仍会升级并提示。
- `formatVersion>2`、`schemaVersion` 不在 3/4、v1 记录出现非空预留数组、模型/关联引用断裂：明确拒绝，不 strip/default。
- 容量常量（字节，MiB 口径）：STL 10,485,760；面数 200,000；项目附件唯一 blob 104,857,600；容器 157,286,400；条目 500；路径 240。

## 3. IPC

`window.cunlian` 仍是唯一桥：原 18 个函数签名/行为不变，新增 5 个（`pickModel`/`readModel`/`commitModel`/`releaseModel`/`linkModel`），共 23 个具体函数；无通用 invoke/send。静态回归见 `desktop/tests/preloadContract.test.ts`。

新通道：`model:pick`、`model:read`、`model:commit`、`model:release`、`model:link`。候选只存 main 内存，绑定窗口+会话，5 分钟过期；commit 由 main 重新解析并与打开端同一套 `assembleSnapshot` 复核；不接受 renderer 传来的路径/blobKey/面数/包围盒。

## 4. 实测命令与结果（日志在本目录）

| 命令 | 结果 | 日志 |
|---|---|---|
| `npm install` | up to date，three/react/electron 版本正确 | 交付消息 |
| `npm run typecheck` | exit 0 | logs/typecheck.log |
| `npm run typecheck:desktop` | exit 0 | logs/typecheck-desktop.log |
| `npm run lint` | exit 0 | logs/lint.log |
| `npm test` | 66 files / 709 tests passed（基线 64/674；新增 35） | logs/test.log |
| `npm run test:desktop` | 17 files / 127 tests passed（基线 14/113；新增 14） | logs/test-desktop.log |
| `npm run build` | exit 0；modelScene/threeScene 独立 chunk | logs/build.log |
| `npm run package:desktop` | exit 0；`out/寸链-darwin-arm64/寸链.app`（arm64，255 MB） | logs/package.log |

稳定性说明：全套并发运行曾出现 1 次既有测试偶发失败（`DesktopWorkspace.test.tsx` 的 B1-A07 一次、`Workspace.test.tsx` 的保存导出一次）；对应文件单独运行 5/5 通过，最终全套运行两次通过（一次 709/709、一次 708/709 后复跑 709/709）。不把偶发失败说成稳定通过。

## 5. 老文件（B1 产物）实测

- 夹具：`src/project-file/__fixtures__/b1-project-v1.cunlian`，来自仓库既有 B1 产物 `docs/v3-a/venus/a04c/fixture.cunlian`；SHA-256 `a002ef2bf6e56693b6e7f0689b8e995857468fe6382542b96725a8e4a51054ce`。
- `src/project-file/versioning.test.ts`：真实 v1 文件可打开；q 值 522000/200000/120000/200000 不变；PDF 1126 字节与哈希不变；旧归档快照仍 `schemaVersion=3`；重新编码为 v2 后可再打开。
- `desktop/tests/formatUpgrade.test.ts`：打开不写盘（文件 SHA-256 不变、acceptedSeq=savedSeq=0）；保存后 `warnings` 含升级提示、文件变 format 2、文件版本 2 条（旧 3 / 新 4）、PDF 仍在；二次保存不再追加；另存为不覆盖原 B1 文件；`stageDraft` 伪造模型被丢弃、来源格式不会被退回 1。

## 6. 容量超限实测

- `src/project-file/versioning.test.ts`：11×10 MiB 唯一 blob → `PROJECT_ASSETS_TOO_LARGE`，detail 含 `115343360`；501 个文件版本 + 固定条目 → `TOO_MANY_ENTRIES`。
- `desktop/tests/modelChannels.test.ts`：10×10 MiB 已用额度 + 新模型 → commit 返回 `PROJECT_ASSETS_TOO_LARGE`、detail 含 `104857600`，会话 `acceptedSeq` 与模型数组不变。
- STL 边界：200000 面二进制（10,000,084 字节）通过；200001 面在数组分配前 `STL_TOO_MANY_TRIANGLES`；恰好 10 MiB 的合法 ASCII（尾部空白）通过、+1 字节 `STL_TOO_LARGE`；截断二进制给出“声明 N 面/期望 X/实际 Y”。

## 7. 回退实验（绿 → 单点退化红 → 恢复绿）

| 实验 | 退化内容 | 红 | 恢复 |
|---|---|---|---|
| MUT-01 | 解析失败分支先 `setGeometry(null)`（旧视图被清空） | `MUT-01-red.log`：找不到 `导入模型 · sleeve.stl`，exit=1 | `MUT-01-restored.log` 1 passed |
| MUT-02 | 替换后关联保持 `confirmed`、不转 pending | `MUT-02-red.log`：`expected 'confirmed' to be 'pending'`，exit=1 | `MUT-02-restored.log` 2 passed |
| MUT-04 | 读端只接受 formatVersion=2 | `MUT-04-red.log`：3 个 B1 兼容断言失败，exit=1 | `MUT-04-restored.log` 4 passed |

实验后工作区无 `MUT-` 残留（`grep -rn "MUT-0" src desktop` 无输出）。

## 8. 未完成 / 已知缺口（不记作通过）

1. **真实用户 STL 样本**：用户尚未提供，真实文件（含损坏副本）验收阻塞；当前全部为自造合法/截断夹具。
2. **Electron 实际窗口 GPU/Finder 离线验收未完成**：打包 .app 能启动（进程与 `file://…index.desktop.html` page target 存在），但窗口抓取为 0×0，未取得 3D 画面截图；不声称“真实渲染通过”。
3. **Web Worker / node worker 未接入**：解析在主线程/渲染线程同步执行，受 10 MiB 与 200k 面上限约束；任务卡 §6 要求的 worker 分线程属于未实现项。
4. **GPU 资源预提交**：导入前只做 CPU 几何/包围球准备（含 STL_GEOMETRY_RANGE），WebGL 初始化失败发生在提交之后，按全局 3D 降级处理（数据保留、可重试），不是文件错误。
5. commit 的条目/解压预算用“附件合计 + 2 MiB JSON 余量”估算，精确检查在编码保存时；两者都会拒绝，但 commit 的估算可能比实际编码更保守。
6. 删除旧版本入口按决策不做；超限只拒绝并给出当前/新增/上限字节。
7. `test:desktop:e2e` smoke 未扩展 B2 场景，也未运行 Finder 自动化；`npm run test:desktop` 已跑。
8. 关联 B2 只实例化 `kind='visual-reference'`；无参数联动，无 STL group→部件映射。
