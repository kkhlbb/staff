# A-02 文件协议（纯部分）· 实现与实测记录

分支：`agent/dsh-v3-A`（工作树 `/Users/aston/DSH/wt/dsh-v3-A`）
日期：2026-11-09
前置：A-01 提交 `0def7e8`

## 交付范围（只做任务卡第 6 节 A-02）

| 要求 | 实现文件 |
|---|---|
| 容器类型、版本、常量、布局 | `src/project-file/types.ts` |
| 结构/引用/容器校验 | `src/project-file/validation.ts` |
| 编解码（ZIP 容器往返、自校验） | `src/project-file/codec.ts` |
| 原子保存、故障映射 | `desktop/main/fileStore.ts` |
| 文件会话（open/stage/save/saveAs，串行） | `desktop/main/projectService.ts` |
| 类型与测试夹具 | `src/project-file/__fixtures__/sampleProjectFile.ts` |
| 测试 | `src/project-file/codec.test.ts`、`desktop/tests/fileStore.test.ts`、`desktop/tests/projectService.test.ts` |

## 容器契约（与任务卡 §4.1 对齐）

- 后缀 `.cunlian`，format=`cunlian-project`，formatVersion=1；
- 外层 projectSchemaVersion=3，内嵌 dimensionChain.schemaVersion 仍为 2；
- 既有 `PROJECT_SCHEMA_VERSION=2`、`PROJECT_DB_VERSION=7`、q 精度与公式均未改动；
- 根 `manifest.json` + `project/project.json` + `workspace/draft.json` +
  `sources/{documents,revisions,bindings,blobs}.json` + `attachments/<encoded>.bin` +
  `history/{events,analysisSnapshots,importSnapshots,migrationBackups}.json`
  （`legacyArchive.json` 仅在非空时写入）+ `revisions/<encoded>.json`；
- manifest 字段：format/formatVersion/createdAt/writer、project、
  entries[{path,role,byteSize,sha256}]（按 path 升序、不含 manifest 自身）、
  payloadBytes、counts（12 项）、attachments、missingAttachments、
  snapshotReferences、migration、excludes.mappingTemplates.included=false；
- 复用 V2 `backup/zip.ts` 的路径/条目数/解压上限/重名防护，未修改 V2 规则；
- schema/路径白名单、版本、条目集合、大小与哈希、计数、同项目引用、文件版本
  父链（无环且父存在）全部通过后才接受；
- 未知非空条目按路径白名单拒绝（`UNSAFE_PATH`），更高 formatVersion /
  projectSchemaVersion 返回 `UNSUPPORTED_VERSION`。

## 负向用例（均为真实断言）

`src/project-file/codec.test.ts`（17 例）覆盖：

- 往返保留 project/draft/documents/revisions/bindings/blobs/events/
  analysisSnapshots/fileRevisions/附件字节；manifest counts、payloadBytes、
  entryPaths 升序、excludes 固定；
- 两次编码解出的内容一致（不依赖 ZIP 时间戳）；
- `formatVersion=2` → `UNSUPPORTED_VERSION`；`format=cunlian-backup` →
  `INVALID_MANIFEST`；`projectSchemaVersion=4` → `UNSUPPORTED_VERSION`；
- 条目被篡改但清单未改 → `HASH_MISMATCH`；
- 删除附件条目 → `MISSING_REFERENCE`；新增未授权条目 → `UNSAFE_PATH`；
- counts 伪造 → `INVALID_MANIFEST`；
- 附件字节被替换且清单同步重算 → 仍按附件哈希 `HASH_MISMATCH`；
- `currentRevisionId` 不存在 → `MISSING_REFERENCE`；绑定页码越界 →
  `INVALID_RECORD`；绑定引用不存在的组成环 → `MISSING_REFERENCE`；
- 版本/Blob 元数据哈希不一致 → `HASH_MISMATCH`；
- 编码端拒绝“缺字节且未声明缺失”“既提供字节又声明缺失”；
- 空字节 → `EMPTY_BACKUP`；非 ZIP → `INVALID_ZIP`。

## 原子保存序列（fileStore.saveAtomic）

1. 后缀必须 `.cunlian`；父目录必须是目录；目标必须是常规文件，拒绝符号链接/目录；
2. 目标已存在时按 `expectedFingerprint`（磁盘 SHA-256）比对，不一致
   `EXTERNAL_MODIFIED`，不写入；
3. 同目录 `<目标>.<uuid>.tmp` 用 `wx` 独占创建、`0600`、循环写满并 `fsync`；
4. 从临时文件回读，先比字节哈希，再执行完整 `decodeProjectFile` 自校验；
5. rename 前再次核对目标指纹未变；
6. 同目录 `rename` 提交；随后尽力 `fsync` 父目录、回读目标确认哈希；
7. rename 后确认失败时明确回报“文件已替换，但持久化/校验未确认”，不回滚、
   不谎称原文件未变；rename 前任何失败只清理本次临时文件。

## 保存故障矩阵（`desktop/tests/fileStore.test.ts`，14 例）

| 注入故障 | 断言错误码 | 原文件断言 |
|---|---|---|
| EACCES（写临时文件） | `PERMISSION_DENIED`（detail 含 EACCES） | P0 SHA-256 不变、无 `.tmp` 残留 |
| ENOSPC | `NO_SPACE` | P0 不变 |
| 短写（ShortWriteError） | `WRITE_FAILED`（detail 含“短写”） | P0 不变 |
| 保存前自校验失败 | `VERIFY_FAILED`（“原文件保持不变”） | P0 不变、临时文件清理 |
| 临时文件回读内容不一致 | `VERIFY_FAILED` | P0 不变 |
| rename EACCES | `RENAME_FAILED` | 原内容仍为 P0、临时文件清理 |
| 期望指纹不一致 | `EXTERNAL_MODIFIED` | 未发生任何写入 |
| rename 后回读不一致 | `VERIFY_FAILED`，消息含“已替换” | 如实报告，不声称原文件未变 |
| 目录 fsync 失败 | 保存成功 + warning“持久化未确认” | 文件已写入 |
| 非 `.cunlian` / 符号链接 / 父目录缺失 | `SAVE_FAILED` | 链接指向的真实文件未被改写 |

## 会话与串行保存（`desktop/tests/projectService.test.ts`，9 例）

- saveAs 落盘后重新打开得到相同聚合；返回给 renderer 的 DTO 不含 attachments；
- 已有路径 save 使用会话指纹，成功后 `savedSeq` 前进且重新打开可见新名称；
- 未保存过的新会话直接 save → `INVALID_REQUEST`（必须另存为）；
- stage 序号必须严格递增；负数/小数/跨项目聚合被拒绝；
- save 的 editSeq 与 acceptedSeq 不一致 → `STALE_EDIT`；
- 外部改写磁盘文件后 save → `EXTERNAL_MODIFIED`，外部内容保留；
- saveAs 覆盖已有文件必须给出该目标当前指纹，否则 `EXTERNAL_MODIFIED`；
- 并发保存经队列串行化：注入计数的写层实测 `maxActive === 1`，两个目标都写出且可重新打开；
- 损坏文件打开失败时不建立会话（`INVALID_ZIP`）。

## 真实命令与输出

```
$ npm run test:desktop        # Test Files 6 passed (6) / Tests 49 passed (49)
$ npm test                    # Test Files 55 passed (55) / Tests 574 passed (574)
$ npm run typecheck           # exit 0
$ npm run typecheck:desktop   # exit 0
$ npm run lint                # exit 0
$ npm run build               # exit 0
$ npm run package:desktop -- --arch=arm64   # exit 0（第二次重跑）
$ du -sh out/寸链-darwin-arm64/寸链.app      # 253M
$ npm run test:desktop:e2e    # E2E_RESULT=PASS（9 项）
```

主进程打包形态附加探针（临时文件已删除，不进提交）：用 Vite 把
`projectService.ts` / codec 以 CJS lib 形式打包后由 Node 运行，结果：

```
CJS_ROUNDTRIP_OK bytes=6227 entries=12 attachments=1 project=project-a
```

说明 zip.js 在 CJS 输出下（`import.meta` 被替换为空对象、worker 关闭）可完成
编码/解码往返。

## 偏离与未实现

1. 任务卡要求“PDF 坐标检查复用 validateBindingRegion”。实际实现没有从
   `src/sources/bindings.ts` 导入，因为该模块顶部导入 `storage/db`（IndexedDB），
   会破坏 `src/project-file` 不依赖 IndexedDB 的约束；改为在
   `validation.ts` 用同样的两个纯函数 `normalizePdfPageBox` + `validatePdfRect`
   组合（与 bindings.ts 逻辑逐行等价，8 行），并在测试中覆盖页码/区域拒绝。
2. **未写 `migrateV2`**（A-03）。
3. **未注册任何项目 IPC**（`project:open/save/...` 属 A-04 会话与工作台）；
   `ProjectService` 已按 IPC 返回包络设计，A-04 接线时直接复用。
4. **未实现恢复草稿、最近项目、dirty 三选**（A-04）。
5. `legacyArchive` 只有容器位置与只读结构，归属规则/生成由 A-03 实现。
6. 未做 500 条目 / 150 MiB 上限的实跑压力用例；该限制复用 V2 zip 常量与既有
   V2 测试，A-02 没有额外构造超大样本。

## 已知风险

- 打包时 `@electron/get` 仍会访问 Electron 缓存/发布源：本次一次 `fetch failed`
  在 `Copying files` 阶段失败，重跑从 `~/Library/Caches/electron` 成功；纯离线
  打包未验证。
- `projectService` 尚未被主进程入口引用，因此还没在 Electron 运行时里被加载；
  已用 CJS 打包 + Node 运行证明可打包、可往返，但 Electron main 内运行需在
  A-04 接线时再确认（尤其 zip.js 与 `crypto.subtle`）。
- 保存后目录 fsync 在部分文件系统可能失败，目前按 warning 处理，不代表断电耐久。
- 未对网络盘/云同步目录做实测；跨卷 rename 不被允许（同目录临时文件已保证）。
