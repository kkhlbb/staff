# 后端 M0 本地验证

环境为 macOS arm64、Node 26.12.1、本机 tsc 7.0.2。起始分支 `agent/gpt-agent-refactor-m0`，HEAD `61d8c435b220cea95c3b06f5435bdf81a6a8dbf9`，起始 Git 状态干净。工作树没有已安装依赖，已盘点同层工作树和本机 Node、npm、tsc。锁文件为 `package-lock.json`。一次离线安装使用隔离的临时 npm 缓存，退出时留下 npm 诊断日志。项目和锁文件未改。

| 实际命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `npm ci --offline --ignore-scripts --no-audit --no-fund --cache /private/tmp/cunlian-m0-npm-cache` | 1 | ENOTCACHED，缺少 `zod-validation-error-4.0.2.tgz`。只执行一次。 |
| `node --test desktop/tests/projectAgentM0.node.mjs` | 0 | 14 通过，0 失败。运行时校验、事件、引用、写入和提交规则。 |
| 下方独立 `tsc --ignoreConfig ...` | 0 | 共享包及主进程纯函数类型检查，使用现成本机只读 Node 类型目录和 `skipLibCheck`。早期试跑因 TS7 的命令行配置要求或全局旧 Node 类型退出，使用下方命令完成局部检查。 |
| `npm run test:desktop -- desktop/tests/draftSyncTransactions.test.ts desktop/tests/projectAgentCompatibility.test.ts` | 127 | 预步骤成功准备本工作树缓存。Vitest 缺失，0 项运行。新增兼容测试共 11 项。 |
| `npm run test:mcp` | 127 | Vitest 缺失，0 项运行。 |
| `npm test -- src/domain src/project-file` | 127 | Vitest 缺失，0 项运行。 |
| `npm run typecheck` | 1 | 找不到 `vite/client`。 |
| `npm run typecheck:desktop` | 1 | 找不到工作树 Node 类型。 |
| `npm run lint` | 127 | ESLint 缺失。 |
| `npm run build` | 1 | `tsc -b` 缺少 `vite/client` 和 Node 类型。 |
| `node --import ./mcp/register-ts.mjs --input-type=module`，直接导入旧 `runCalcChain` 与 `runCheckRequirement` | 1 | 导入链缺少 `@zip.js/zip.js`。单独导入 `closedIntervalVerdict` 也因缺少 Zod 退出。 |
| `node --import ./mcp/register-ts.mjs --input-type=module`，用 `unzip -p` 读基线项目尺寸链，调用 `parseMm` 和 `calculateChain` | 0 | 四组 q 区间断言通过。 |
| `python3 -`，用标准库 `zipfile/hashlib/json/decimal` 读六个夹具并比对兼容测试的常量 | 0 | 六份归档 CRC、SHA-256、当前修订及正式/草稿尺寸断言通过。产品解码器仍待运行。 |
| `git diff --check` | 0 | 核对工作树已跟踪差异。新增文件另行检查尾随空白。 |

```sh
tsc --ignoreConfig --noEmit --strict --skipLibCheck --noUnusedLocals --noUnusedParameters \
  --target es2023 --module esnext --moduleResolution bundler --allowImportingTsExtensions \
  --typeRoots /opt/homebrew/lib/node_modules/mcp-video-analyzer/node_modules/@types --types node \
  desktop/main/project-agent/guards.ts desktop/shared/project-agent/index.ts
```

A10 的独立内核复跑从真实 `baseline.cunlian` 的 `project/project.json` 取 `dimensionChain`，只替换 `t-s.nominalQ`。下表的闭区间和裕量预期也写入产品工具兼容测试。工具判定及编解码测试待补齐锁定依赖后执行。

| 隔套长度（mm） | 实测旧内核区间（q） | 预期旧工具判据 | 预期最窄裕量（q） |
| --- | --- | --- | ---: |
| 12.00 | [1500, 2500] | 通过 | 500 |
| 12.04 | [1100, 2100] | 通过 | 100 |
| 12.10 | [500, 1500] | 失败 | −500 |
| 12.05 | [1000, 2000] | 边界通过 | 0 |

安装包及 A01/A05 样机均未运行。测试停留在纯规则、旧内核与只读归档检查层。持久化、跨进程发布、真实双入口、包内几何和来源闭环各有独立验收门槛。
