# 风险收尾接续：依赖实际修复，未作发布放行

## 起点与范围

在现有 `agent/risk-closeout` 分支接续；起点 `770bba2`、工作区干净。先读取 ../risk-closeout-evidence/ 原有 commands.jsonl、run.py、audit-before.log 与安装记录，不重做来源研究。旧进程未重启。

依赖修复提交 `f5abab80afb7e819a0666c2ff63ce045100c4126`：仅 package.json/package-lock.json。兼容与包边界自测提交 `f83f7317e78ef04ca994a4dd4cf11175fa5a793b`。未修改应用业务、计算精度、既有断言、审计阈值或 main；没有 force/降级到 npm 建议的 typescript-eslint 8.36.0。新增两个小型自测/取证脚本用于证明定向 override 兼容性及实际成包边界，不是产品功能。

原始新证据根：`/Users/aston/DSH/tmp/cunlian-v4/risk-closeout-evidence/resume-01/`。本目录归档原始命令及关键 stdout/stderr；机器路径留在 .log 原文，不伪造为可复现 JSON。完整产物、应用运行日志、原生读回及脚本留在外部证据根。

## audit 结果与最小修复路径

必须区分：继承的成功 audit JSON 确认 11 moderate；本次首次 audit 失败是 TLS 网络断开（exit1），不是第二份有效的“当前11”结果。首错原文在 logs/audit-before.log；继承基线在 logs/inherited-audit-before.log。失败没有卡住任务，继续分析既有 JSON 与 lock。

1. `npm audit fix --ignore-scripts --json` exit1：普通兼容修复把 11 降到 7。@electron/asar 4.3.1→4.3.2、ESLint 10.14.0→10.15.0、config-array 0.23.5→0.23.6；其声明带来 glob 14.0.6/minimatch 11.0.8/path-scurry 3.0.0。typescript-eslint 同主版补丁 8.72.1→8.72.2，仍固定 minimatch ^10.2.2。
2. `npm view` 实测上游 latest 为 8.72.2，estree 依赖仍为 ^10.2.2；不装不兼容旧版，也不把审计传播节点错称11个独立漏洞。11个受影响包实际根 advisory 两个：GHSA-g3hv-75wg-m249、GHSA-3g3m-2fjr-6pw4。
3. 仅对 `@typescript-eslint/typescript-estree` 加 `minimatch: 11.0.8` override。npm install/npm update 在已有锁状态下 exit0 却仍保留嵌套10.2.6，npm ls 明确 ELSPROBLEMS、audit仍7：这些尝试不算修复成功，日志全部保留。
4. 将该嵌套锁节点替换为 npm 已下载、父链已采用的11.0.8完整锁记录（含官方 resolved/integrity/license/dependencies），没有伪造 integrity。随后真正 `npm ci` exit0，`npm audit --json` exit0（info/low/moderate/high/critical/total 全0），`npm ls ... --all` exit0，无 invalid。不是只修改审计报告。

逐项11行风险前后表见 risk-table.md。所有受影响节点为 dev 依赖；不因此豁免修复。直接运行依赖及 Electron 45.2.3、WASM hash 不变。

兼容依据是当前上游成熟源码真实调用：`node_modules/@typescript-eslint/typescript-estree/dist/useProgramFromProjectService.js` 的 `minimatch(filePath, pattern, {dot:true})`，及新版 asar/ESLint 已采用11的声明。新增 `scripts/security-dependency-compat.test.mjs` 实跑9组匹配/不匹配、dot/brace/extglob行为，并真实走 parser projectService allowDefaultProject：命中获得 number 类型信息，未命中抛错；两项 node:test 均通过。这是本项目兼容证据，不宣称所有潜在外部使用均兼容；上游解除旧依赖约束后应复查能否移除 override。

## 全套实际执行

以下均来自 commands.log 与对应 logs/，每个子命令单独记录退出码，未用组合 shell 最后一个状态冒充全部成功。

| 命令 | exit | 实际结果 |
|---|---:|---|
| npm ci | 0 | 固定新锁安装成功 |
| npm audit --json | 0 | 0 vulnerabilities，11→0 |
| npm ls minimatch glob eslint typescript-eslint @electron/asar --all | 0 | 依赖树无 invalid |
| npm run typecheck | 0 | app/node/mcp 均通过 |
| npm run typecheck:desktop | 0 | 通过 |
| npm run lint | 0 | 通过；新增脚本后再跑也通过 |
| npm test | 0 | 128 files / 1462 tests passed |
| npm run test:desktop | 0 | 53 files passed / 2 skipped；376 passed / 17 skipped |
| npm run test:mcp | 0 | 3 files / 22 tests passed |
| npm run test:real-docs | 0 | 5 files / 19 tests passed |
| npm run build | 0 | 成功；保留 chunk >500kB 警告，未调阈值 |
| npm run test:step-license | 0 | 18 passed，0 skipped |
| node --test scripts/verify-step-supply.test.mjs | 0 | 8 passed，0 skipped |
| node --test scripts/security-dependency-compat.test.mjs | 0 | 2 passed，0 skipped |
| npm run package:desktop -- --arch=arm64 | 0 | 新包生成，PDF worker 与 STEP 成包断言均通过 |
| node scripts/risk-closeout-package-audit.mjs <新报告路径> | 0 | 实际 asar 不含所列受影响dev包路径；新包/STEP资源hash已记录 |
| node scripts/step-evidence/packaged.mjs <新app执行文件> <旧完整product-expanded-v2夹具> <新证据目录> | 0 | 真实Electron main/preload/IPC/worker/磁盘导出；不是重用旧包结果 |
| native-readback.py 新packaged.step / odd-packaged.step / restored.step | 各0 | 三份均 ACCEPTED，原生OCP读回 |
| npm run check:release:step -- <新包Resources> | 1 | packageVerification=VERIFIED，INCOMPLETE，三个blocker保留 |
| git diff --check（依赖变更范围） | 0 | 通过 |

checks.py 明确移除模型开关/密钥并按默认门控执行普通套件；没有付费模型请求。17跳过不计通过。兼容自测、license/supply与目标读回不重复累加成普通suite总数。

新包：`/Users/aston/DSH/tmp/cunlian-v4/risk-closeout/out/寸链-darwin-arm64/寸链.app`。

打包运行复验覆盖普通/奇数q、历史99mm与所选12mm隔离、stale-session、保存框取消、stepCancel IPC、微小长度/薄壁退化拒绝、3资源缺失/损坏共6项拒绝与finally恢复、有效但hash不符WASM替换拒绝。原生保存/打开对话框由debugger桩化，不是原生GUI UX验证。app退出记录在外部 `packaged-step/process-exit.json`，完整运行输出保留；不声称另一平台或异厂商CAD通过。

原生reader保持既有线性1e-6 mm、体积max(1e-6, |V|*1e-9)门槛，验证AP214IS/mm、1 solid/1 shell/4解析面、孔/材料点分类和布尔探针。奇数q内径20.0001 mm、半径10.00005 mm；未放宽精度。OCP同OCCT家族，默认transfer可能内修复，不能声称无修复或异厂商互操作。

## 17项缺测

完整逐条正文/行号、原因与本次依赖更新相关性在 skipped-review.md，共17个it（3+14，×3循环不扩增it计数）。其中 A40-09、A40-07c-2 正文无模型调用，只因整套 beforeAll连接探测与开关而跳过，已明确记为机械覆盖缺口；本轮没有为消除skipped改门控/改测试，也不把已有普通机械测试当真模型结果。

其他15项含真实模型选择/流式回包；没有新增付费授权，未调用，不记通过。审查指出正文的条件分支/soft checker/标题与断言范围差异，未顺手放宽或修复既有测试。

## 许可：仅机械核查，不放行

新包 STEP 的15份告知与源字节一致，3个运行资产hash保持；18条许可测试及8条供给核验器负例通过。实际 asar 中未见此次修复的dev依赖目录，新包边界/hashes在 logs/package-boundary.log；不是仅凭 package.json dev分类推断。

FORMAL_SOURCE_DELIVERY、TRANSITIVE_NOTICE_REVIEW、LGPL_LEGAL_REVIEW 全保留。上一轮已准备的对应源交付绑定指向旧 app.asar；本次新包hash已另存，不能把旧交付回执当作新包正式供给完成。本轮没有重绑整套源交付、没有法律签字、没有签名公证或发布。

## 失败、警告及未验证

- 首次网络TLS断开exit1；普通audit fix残7 exit1；override初次安装仍旧嵌套锁、audit/ls失败：原文保留，最终ci/audit/ls成功后才计清零。
- 汇总脚本初次误将带网络错误前缀的首错日志当纯JSON，JSONDecodeError；改读继承的有效基线。没有删掉或“修好”失败输出。本页上述首次audit口径为准，不将首错称为当前11结果。
- 构建保留大chunk警告，普通测试保留 jsdom 的 `Not implemented: navigation to another Document` 输出；退出码均0，不消音。
- 新证据归档暂存后的 `git diff --cached --check` 实际exit2：原始npm/Vite/test日志含尾空格和EOF空行。完整诊断在外部 staged-diff-check.txt；没有为变绿裁剪原始输出。仅依赖实现范围的diff检查exit0，不扩张为整次证据范围通过。
- 发布gate exit1是实际阻塞结果，不计通过。
- 17测试正文未执行、原生对话框UX、第二厂商/另一平台、全库重编源供给/新app正式交付绑定、法律审查均未验证/未完成。
- 未push/merge/delete/release/付费/改权限/全局安装；没有操作main或共享staff工作树。
