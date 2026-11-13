# 平台防腐层（B 版）：密钥换 safeStorage、脱敏补 Windows、win32 打包体检

分支 `agent/platform-seam`（基线 `main` = `20554da`）。未 merge / push / 删分支。

## 结论与边界

- 任务卡三件都做了；**OCR provider 抽象按用户决定延后**（OCR 分支还没合入，本单不抽接口）。
- 密钥：`security -i` → Electron `safeStorage` + 本地密文文件。macOS 走系统 Keychain、
  Windows 走 DPAPI，一套 `KeychainStore`（read / write / remove）接口，调用方不用改。
  旧 macOS Keychain 记录**真做了迁移**（预置 → 首次读取 → safeStorage 重存 → 删旧记录仍能读）。
- 脱敏：补盘符路径、UNC、`%APPDATA%` 等环境变量根；20 条用例（13 条必须替换、
  7 条必须原样保留），**0 误伤**。macOS 既有规则行为未变。
- win32 打包：**真实跑成功**（不是断网失败），并核对了 `app.asar` 里的 pdf worker 与
  mac 专属资源。本机没有 Windows，**exe 未在 Windows 上运行**，这一点在已知问题里写明。
- 判定规则、抽取规则、schema、OCR 代码一行未动。

## 1 密钥：`security -i` → `safeStorage`

改动：

- `desktop/main/keychain.ts`
  - 新增 `SafeStorageStore`：`safeStorage.encryptString/decryptString` + 密文文件
    `<userData>/model-key-store.json`（`version` + `account → base64 密文`，权限 `0600`，
    原子写：临时文件 + rename）。写入路径**不再起子进程**，密钥不可能出现在任何进程参数里。
  - `SafeStorageLike` 最小接口 + `createModelKeyStore()` 装配：macOS 自动挂旧
    `MacKeychainStore` 作为迁移源；其他平台没有旧记录可迁（旧实现在 Windows 上本来就不工作）。
  - 迁移：新路径没有、旧 Keychain 有时 → 读出来用 safeStorage 重存 → 打标记，之后只走新路径。
    **旧记录不自动删除**（删除是用户显式动作）。
  - 删除：`remove()` 同时清掉旧记录，否则刚删的密钥会在下次读取时被迁移逻辑带回来。
  - 加密不可用（`isEncryptionAvailable() === false`）：写入抛 `SAFE_STORAGE_UNAVAILABLE`，
    **不退化成明文落盘**；读取旧密文解密失败（换机器 / 换用户，DPAPI 与 Keychain 都是绑定用户的）
    返回 `null` 而不抛错。
  - `MacKeychainStore` 保留（迁移读取源 + 测试），仍然经 `security -i` stdin 传密钥。
- `desktop/main/index.ts`：装配点改用 `createModelKeyStore({ userDataDir, safeStorage })`。
  `modelConfig.ts` / `realModelRuntime.ts` / IPC 契约一行未改，对外 `get/set/delete` 语义不变。

密钥仍然：不出现在进程参数、不落明文、不进日志/证据/截图（证据只记布尔与计数）。

### 迁移用例（真实 Keychain + 真实 Electron safeStorage）

单测（`desktop/tests/modelKeyStore.test.ts`，旧记录走真实 `/usr/bin/security`，测试专用 service）：

    npx vitest run --config vitest.desktop.config.ts desktop/tests/modelKeyStore.test.ts
    Test Files  1 passed (1)
         Tests  12 passed (12)

真实 Electron 主进程（`scripts/platform-seam-safe-storage-evidence.mjs`，把
`desktop/main/keychain.ts` 编译成 CJS 后由 Electron `require`，后端是系统真 Keychain）：

    encryptionAvailable: true     backend: keychain
    roundTrip: true
    file: { bytes: 137, containsPlaintext: false, entries: 1, mode: "0o600" }
    migration: { preseeded: true, firstRead: true, storedInSafeStorage: true,
                 legacyDeleted: true, readAfterLegacyDelete: true, readByNewInstance: true,
                 plaintextInFile: false, deleteClearedLegacy: true, readAfterRemove: true }
    plaintextHitsInTempDirs: []   afterRemove: true   verdict: pass

即：预置旧记录 → 首次读取成功 → 密文文件里有（且无明文）→ 删旧记录仍能读 → 新实例仍能读
→ 删除同时清旧记录 → 删除后读回 null。完整输出见 `safeStorage.json`、
`logs/safeStorage-electron.log`。

## 2 脱敏补 Windows 路径

改动：`src/agent/redact.ts`

| 规则 | 覆盖 |
|---|---|
| 盘符 | `C:\Users\…`、`D:\data\…`、`C:/Users/…`（单字母盘符 + 冒号 + 分隔符，前面不能紧跟字母数字） |
| UNC | `\\server\share\…`（server 段不含空白） |
| 环境变量根 | `%APPDATA%`、`%LOCALAPPDATA%`、`%TEMP%`、`%USERPROFILE%`（大小写不敏感，可带后续路径） |

不误伤的做法：

- 目录段（以分隔符结尾）允许空格 → `C:\Program Files\Cunlian\app.exe` 整段替换；
- 末段不含空白与全角标点 → 路径后面的正文不会被吞（`已保存到 C:\Users\aston\a.txt 请查看`
  → `已保存到 <path> 请查看`）；
- 前面紧跟字母数字不算盘符 → `ABC:\x` 原样保留；
- 正文里单独出现的 `C:\`（没有后续段）原样保留——认不出位置，替换它只会误伤；
- `sensitiveFindings` 与脱敏共用同一套 Windows 规则（`redactWindowsPaths(text) !== text`），
  避免「能脱敏但最后一道防线放行」的两套口径。

用例（`src/agent/redact.test.ts` 11 条 + `redaction.json` 20 条明细）：

    npx vitest run src/agent/redact.test.ts
    Test Files  1 passed (1)
         Tests  11 passed (11)

`redaction.json` 汇总：`total 20 / redacted 13 / untouched 7 / failures 0`。

## 3 win32 打包体检

    npx electron-forge package --platform=win32 --arch=x64     # exit 0，第一次就跑通

结果（`win32-package.json`，检查只读产物）：

| 项 | 值 |
|---|---|
| 产物目录 | `out/寸链-win32-x64/` |
| 可执行 | `寸链.exe`，249 831 936 B，`PE32+ executable (GUI) x86-64, for MS Windows` |
| `resources/` | 只有 `app.asar`（无 mac 专属附加资源） |
| `app.asar` | 5 996 966 B，33 个文件，sha256 `6635fe29…f3ef` |
| mac 专属条目 | **0**（`.icns` / `.dylib` / `.app/` / `Info.plist` / `entitlements` / `PkgInfo` / `MacOS/` 全无） |
| pdf worker | **在**：`/.vite/build/pdf.worker.mjs`，1 327 591 B，与本机 `pdfjs-dist` 同版本字节一致，注册了 `globalThis.pdfjsWorker`（7 条 PASS，复用 `scripts/assert-packaged-pdf-worker.mjs`） |

网络如实说明：这一步**没有**卡在断网——win32 Electron zip 是本次现下的
（`~/Library/Caches/electron/<hash>/electron-v45.2.3-win32-x64.zip`，目录 mtime = 本次运行时间），
所以这台机器到 Electron 发布源的下载是通的（GitHub 网页/chatgpt.com 不通，但下载源通）。
没有为通过而删代码或改产品行为。

## 变异红绿

    node scripts/platform-seam-mutations.mjs
    M38: red assertion / restored green
    M40: red assertion / restored green
    MUTATIONS_ALL_RED_AND_GREEN

| 变异 | 改什么 | 结果 | 判死断言（原文在 `mutations/`） |
|---|---|---|---|
| M38 | 删掉「旧 Keychain 有、新路径没有 → 迁到 safeStorage」整段回退 | 红 | `AssertionError: expected null to be 'sk-pla...0001'`（3 条迁移用例同时红）；恢复后 12 条全绿 `EXIT_CODE=0` |
| M40 | 脱敏不再调用 `redactWindowsPaths` | 红 | `expected 'C:\\Users\\aston\\报告.pdf' to be '<path>'`、`expected '\\\\server\\share\\docs\\a.pdf' to be '<path>'`、`%APPDATA%` 同类；恢复后 11 条全绿 `EXIT_CODE=0` |

两条都是 AssertionError 判死（不是编译失败）。

## 门禁与「mac 行为零变化」

全量门禁（日志在 `logs/`，汇总 `gates.json`）：

    npm run typecheck             0
    npm run typecheck:desktop     0
    npm run lint                  0
    npm test                     126 文件 / 1430 通过
    npm run test:desktop          333 通过 / 17 跳过（46 文件通过、2 跳过）
    npm run test:mcp              3 文件 / 22 通过
    npm run build                 0（仅既有 >500kB chunk 警告）
    npm run package:desktop       0（含打包 PDF worker 断言 PASS）
    npx electron-forge package --platform=win32 --arch=x64   0

相对基线（1414 / 125 文件、桌面 321、MCP 22）：`npm test` +1 文件 +16 条
（`redact.test.ts` 11 条 + 本目录新增 5 份 JSON 触发的 5 条证据守卫用例）；
桌面 +12 条（`modelKeyStore.test.ts`）。没有删改既有用例。跳过的用例未记通过。

界面文案：原来写「密钥只存 macOS Keychain / 已存 Keychain」，在本单之后对 Windows 不成立，
改成「系统安全存储（macOS Keychain / Windows DPAPI）」（`src/components/AgentSidebar.tsx`
5 处文案，都在折叠的「模型设置」里或状态行上）。布局回归没退化：

    env -u ELECTRON_RUN_AS_NODE node desktop/tests/e2e/layout.mjs
    LAYOUT_RESULT=PASS checks=72

`docs/evidence/ui-layout/` 的截图**没有刷新**：同一份代码连跑两次，`layout-960x640.png` /
`layout-1400x800.png` 的字节每次都不同（渲染非确定性），`layout-result.json` 却完全一致。
这些是另一单的证据，本单不动（跑完已还原，`git status` 干净）。

真实语料度量（改动前后各跑一次，`logs/baseline-metrics.log` / `logs/after-metrics.log`）：

    改动前：correctness {"pendingChecked":19,"wrongPending":0,"wrongRate":0}
    改动后：correctness {"pendingChecked":19,"wrongPending":0,"wrongRate":0}
    两次都是 6 份 / 269 页 / 候选 140（pending 58｜blocked 82｜confirmed 0），
    两次都：BASELINE MATCH：与 baseline.json 完全一致

即抽取、判据、`wrongPending` 都没被本单影响。

## 未做项 / 已知问题

- **OCR provider 抽象：明确延后**（按任务卡与用户决定，OCR 分支未合入，本单不抽接口）。
- **没做 Windows 安装器**（`electron-forge make` / nsis 等），任务卡只要打包体检。
- **exe 未在 Windows 实机运行**：本机是 macOS，只证明产物结构正确、pdf worker 可被
  main.cjs 运行时加载；真实启动、DPAPI 落盘、托盘/字体等 Windows 运行期行为未验证。
- **Windows 密钥只有单元级证据**：`SafeStorageStore` 的 DPAPI 分支由注入替身覆盖
  （`createModelKeyStore({ platform: 'win32' })`），真实 DPAPI 加解密需要 Windows 机器，
  未验证。加密不可用时拒绝写入而不是明文落盘，这条已单测覆盖。
- **含空格的文件名只替换到空格前**（如 `…\my file.pdf` → `<path> file.pdf`）：目录段允许空格，
  末段不允许，是为了不吞掉路径后面的正文；宁可少替换也不误伤。
- **MacKeychainStore 对非 ASCII 密钥**：`security -w` 会把非 ASCII 值输出成十六进制
  （既有实现特性，本单未改）。真实供应商密钥是 ASCII，迁移按字节搬运，不受影响；已在
  `modelKeyStore.test.ts` 注释里写明，测试用 ASCII 密钥。
- **safeStorage 的 macOS 条目由系统按应用名管理**（"<应用> Safe Storage"）：换机器、
  换登录用户或删除该条目后，密文读不出来（`read` 返回 `null`，不抛错），需要重新填一次密钥。
  这是 safeStorage 的既定边界，不是本单的缺陷。
- `desktop/tests/e2e/smoke.mjs` 的 `window.cunlian 只暴露具体函数` 断言**过期**：
  期望表里没有 `agent*` / `intent*` / `extraction*` / `dxf*` / `sketch*` 等后来新增的通道，
  在 `main` 上就是这样（`git show main:desktop/tests/e2e/smoke.mjs | grep -c agentStart` = 0，
  而 `main` 的 preload 里是 2）。本单未碰 preload，**不顺手修**，如实记为既有失败
  （`logs/e2e-smoke.log`，其余 7 项 PASS，应用能正常启动）。
- 本单未执行任何模型调用；除 Electron 发布源下载 win32 zip 外未做其他网络访问。
