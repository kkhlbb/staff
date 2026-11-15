# STEP 分发收尾：本地材料已交付，正式发布仍阻塞

分支 agent/step-spacer；实核接续 HEAD 44ddfd237d3b37c04b599704d63b7b0fe0ad70c7、开工工作区干净。
实现提交 72857be33e0e7f469228fd2808f302f5e1066aac：补告知与供给索引、打包必备告知、独立本地供给/hash/相对路径核验器及负例。
本页为报告收尾，不改变运行资产或 SBOM 人工门禁。

## 实际完成的机械工作

- 对最终提取 2728 个 OCCT archive 成员逐个核对原 .o 与链接对象 sha；取得 2728 份真实编译 .d，索引源/头/forwarder/系统头共 10383 个文件。
- 317 个实际提取系统对象从 DWARF 编译单元全部定位到源码，并保留逐对象原文/hash/原始 DWARF；不是凭 basename 猜测，也不是 SDK 二进制可重现认证。
- 汇总源/头与 123 个生成 JS 候选源共 10823 个文件：8087 在固定官方归档找到同字节，2727 为 forwarding headers、8 为 patched OCCT、1 为 SDK 生成头 `step-source-build/cache/a/sysroot/include/emscripten/version.h`。293 文件无 leading notice，逐文件保留，未编造许可。
- default/modified 两支各 34 个输入 archive 共 68 行矩阵，供应成员与实际提取分开；两支提取集合一致，仅 Controller 对象有真实源码变更。没有拿旧实验 2739 数冒充最终 2728。
- STEP 新增 1388 段去重原文通知；完整 LGPL2.1、OCCT exception、Emscripten、musl、LLVM、Lucent/Strtod 等原文分别保留，不统一标 MIT。
- 实查原 .app 缺内置 Electron/Chromium 告知（旧包只在发行目录旁置）；新增原文入 .app。React/React DOM/scheduler/three/zod/zip.js/PDF.js/core-js 及 PDF 子项、两个原生 framework 原文补入显式组件合集。
- 固定 npm 版本 tarball 实际 SRI 校验；Mantle/ReactiveObjC 按 Electron 45.2.3 DEPS 固定 commit 原文、PDF.js 按 npm gitHead 固定源码归档。精确 bundle/原生静态生存范围仍标歧义。
- 26 修改源显著通知 overlay 在新隔离副本应用 exit0、26 hash 核对；Controller 行为修改另有注释副本。注释添加日期为 2026-11-14，不倒填上游实际修改日期/作者，未改写原始编译输入。

## 新本地可交付材料

证据根（绝对路径）：/Users/aston/DSH/tmp/cunlian-v4/step-distribution-closeout/

- app/寸链.app：原已验应用副本，仅新增/更新告知资源，不冒称本轮重打包应用或重编内核。
- distribution/README.zh-CN.md：独立离线交付入口、相对命令、工具前提与精确人工动作。
- distribution/source/：完整固定源/对象/23 archive、工具实物/完整工具源码/缓存、最终链接证据、前阶段源与本次源补充、注释审查副本。
- distribution/PRODUCT-BINDING.json：产品 0.4.1-beta、实现提交 72857be、运行集成 e776212、22 份资源全 hash。
- distribution/APP-TREE.json：292 个 .app 文件/符号链接条目，实际核对一致。
- distribution/MANIFEST.json：37 份交付文件共 1,036,175,075 字节（不含 manifest 自身，也不含旁置 app）。MANIFEST SHA256 6bf3c311e3566026f6c249d1ea4aac34ba9e07767e86ccb9a51e4a17053fedf8。
- delivery-receipt.json：6151 份 core 内部文件核对、禁网离线命令与真实退出码、35413 文件源码重构回执。
- LEGAL-REVIEW-FACTS.zh-CN.md、distribution/review/：按条款/组件/文件定位的已覆盖、缺失与歧义。大索引在 review/audit-evidence.tar.gz 内，官方实物另包。

app.asar 保持 f60450dbb75c92de102ec592cd686bd72561314206c19cfec58532d89982a944；默认 WASM 保持 c309d6a202aab5b2b2a498bdd1515b8b03f470ea238dfb99ba5ccb00b8a80108。JS/worker 与此前已验产品相同，绑定中可逐项查。

## 本轮真实自测（不重跑无关全量）

完整 argv/cwd/stdout/stderr/退出码：证据根 commands.jsonl 与 logs/。

    npm run test:step-license
      exit0；18 pass、0 fail、0 skipped；每项新增告知均测缺失/篡改拒绝并恢复。
    node --test scripts/verify-step-supply.test.mjs
      exit0；8 pass、0 fail；含逃逸/绝对/反斜杠、父符号链接、hash 不符、遗漏目标、未索引文件、不同产品绑定负例。
    eslint scripts/step-assets.mjs scripts/verify-step-supply.mjs scripts/verify-step-supply.test.mjs
      exit0。
    npm run check:package:step -- '<证据根>/app/寸链.app/Contents/Resources'
      exit0，PACKAGED_STEP_ASSETS_VERIFIED；全部15项告知与当前源字节一致、无旧核资源。
    npm run check:release:step -- '<证据根>/app/寸链.app/Contents/Resources'
      exit1，packageVerification=VERIFIED，INCOMPLETE，三个 blocker 全保留；不是 RESOURCE_TARGET_REQUIRED。
    sandbox-exec -f offline-deny-network.sb node verify-step-supply.mjs . '<新包Resources>'
      exit0，LOCAL_MATERIALS_VERIFIED，37供给/22资源，releaseApproval=BLOCKED。
    sandbox-exec -f offline-deny-network.sb python3.14 core-supply-product/rebuild.py --tools ../distribution/source/tool-materials --work 'reconstructed source with spaces' --phase prepare
      exit0；真实在新解包/含空格路径，应用输入 patch，35413文件逐字节相等。未编内核，系统缓存仍明确复用。
    node scripts/step-evidence/packaged.mjs '<新包可执行文件>' '<既有product-expanded-v2>' '<新证据目录>'
      exit0，PASS；真实成包 main/preload IPC、worker、STEP落盘，应用 process code0/signal=null。普通/奇数q、历史分离、取消/stale/退化与资源缺坏拒绝/恢复均由现有 harness 实跑；原生对话框仅桩化。

失败保留：首次 smoke 错用不完整旧 product 夹具，缺 degenerate-length-request.json，harness exit1、应用 code0/signal=null；改用现有完整 product-expanded-v2 在新目录重跑 exit0。初次 ReactiveObjC v3.1.0 URL、PDF brotli_decoder.js URL 均404，后改固定 DEPS commit/固定官方源归档取到原文；未伪造输出或削弱产品断言。

实现提交范围 `git diff --check 44ddfd2 72857be` 实际 exit2，原始许可/上游头部文本含尾空格等，日志为 logs/source-range-whitespace.stdout.txt；没有为得绿灯修剪第三方原文，此项不记通过。系统 Python3 首次执行进度追加脚本报源码解码错误；随后独立逐字节验证 UTF-8 合法，换既有 Python3.14 原脚本执行成功、旧日志原文 hash 未变，不将首次组合 shell 的最终 exit0 当 Python 成功。

## 门禁逐项状态与确切人工动作

FORMAL_SOURCE_DELIVERY：本地备料/绑定/完整性/离线重构已验；正式提供给每一接收方的渠道尚未批准/执行，仍 BLOCKED。负责人选择同介质或合适渠道、明确维护责任；若公开上传/发布，先取得用户本人授权，本轮只准备不上传。

TRANSITIVE_NOTICE_REVIEW：可执行告知/源路径提取与原文补齐已做；仍 BLOCKED。人工审查 293 无 leading notice 的许可继承、生成配置头/JS emitted subset、原生 Electron/FFmpeg 配置及字体 name 元数据等精确边界；详见逐文件矩阵，不笼统退回“全部重审”。

LGPL_LEGAL_REVIEW：仍 BLOCKED。审查员确认 §2(b) 历史日期与新通知 overlay 充分性、§4/§6(a) 对应源/应用对象/工具例外/实际渠道、§6 用户自用修改及逆向调试与最终 EULA 是否冲突，以及 header exception 的适用范围。实现者不冒充律师、不自行签法律放行。

未测/限制：本轮不重复旧整套测试/全库编译，不新称异厂商、无修复、原生框UX、另一干净主机/跨平台、工具二进制复现或签名公证通过。字体内部 name 表未独立解析；生成JS保守源超集不是逐函数来源证明。既有报告/证据未覆盖；进度与团队日志在新 evidence-notes 副本承接全文后追加。未 merge/push/delete/发布/付费/改权限/全局安装，未动共享 staff/gt-expand。
