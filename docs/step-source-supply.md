# STEP 窄核对应源码与告知供给索引（未获发布放行）

## 0.4.2-beta 渠道与材料更新

用户已批准以 GitHub Pre-release 同页提供 macOS arm64 / Windows x64 应用及对应源码材料；授权不等于已经上传，也不是许可充分性签字。
当前正式提供状态为 PENDING_PUBLICATION_AND_DOWNLOAD_VERIFICATION，主控执行发布和远端下载核验后才能记为完成。
TRANSITIVE_NOTICE_REVIEW 与 LGPL_LEGAL_REVIEW 保留阻塞，不作 APPROVED。

本版同页资产应包括 cunlian-v0.4.2-beta-macOS-arm64.zip、cunlian-v0.4.2-beta-windows-x64.zip、cunlian-v0.4.2-beta-source.tar.gz、cunlian-v0.4.2-beta-corresponding-materials.tar、SHA256SUMS、RELEASE-NOTES.zh-CN.md。
供给包内 README.zh-CN.md、MANIFEST.json、BINDING-macos-arm64.json、BINDING-windows-x64.json 是当前精确源码/两平台 Resources 绑定入口；不得用下述历史 0.4.1 绑定替代。
供给包含固定 OCCT 源/补丁/wrapper/重链接对象/工具与许可证，另含 Electron 45.2.3 对应 FFmpeg 固定完整源、四补丁和目标配置。Windows 仅实验跨平台构建，未在 Windows 运行或重建工具链。
本应用不禁止用户自用修改 LGPL 库、重链接及为调试修改而逆向工程。工具/链接成功不代替法律充分性判断。

以下保留既有 0.4.1 本地供给与重建的历史说明；其中“渠道尚未批准”描述的是历史状态，不能解释为本轮授权尚未取得。

本产品使用 Open CASCADE Technology 8.0.1，固定源 b8f597c677811d1f9f4d8a97f5ae2825c0353a42。
适用原文为 LICENSE_LGPL_21.txt 和 OCCT_LGPL_EXCEPTION.txt。OCCT header exception 不等于静态库豁免。
应用的 MIT 许可不替代第三方条款。允许用户为自用修改 LGPL 库、重新链接，以及为调试这些修改而逆向工程；本说明不添加禁止这些行为的产品限制。

当前状态：本地技术材料可交付，FORMAL_SOURCE_DELIVERY、TRANSITIVE_NOTICE_REVIEW、LGPL_LEGAL_REVIEW 仍阻塞。
未提供公开上传地址，未作三年书面供给要约，未签署法律认证。此处不承诺尚未批准的正式交付渠道。
公开上传/发布必须另经用户批准；审查员需确定适用 LGPL §4/§6 路径和实际每位接收方的访问方式。

## 实际包内位置（相对 Contents/Resources/step-narrow-v1）

- NOTICE：显著使用 OCCT 告知；完整 LGPL2.1 与 OCCT exception 分别保留。
- STEP-NARROW-RUNTIME-NOTICES.txt：Emscripten、musl、LLVM 各子库、dlmalloc/Strtod 等原始许可。
- STEP-TRANSITIVE-NOTICES.txt：实际 OCCT 对象编译依赖的原文头部及 317 个系统对象来源的原始通知；生成 JS 的 123 源文件为保守超集，不称全部嵌入。
- APP-RUNTIME-NOTICES.txt：React/React DOM/scheduler/three/zod/zip.js/PDF.js、core-js 等固定 npm 许可；保守补充 Vite/papaparse、PDF 子组件及 Electron 两个 framework 原文。存在原文不等于每一版本/静态组件已法律批准。
- ELECTRON-LICENSE.txt、ELECTRON-CHROMIUM-LICENSES.html：Electron 45.2.3 原始随发行文本。新包特意保留在 .app 内，防止只移动 .app 时遗漏旁置告知。后者含 498 个告知条目，不代表 498 个已独立链接验证的库。
- THIRD-PARTY-NOTICES.md 的历史段落仅作旧材料；新供给位置以本说明为准。

## 独立本地材料（不塞入应用）

交付根目录 distribution/ 与 app/ 并列于 step-distribution-closeout/：

- app/寸链.app：本次新增告知资源的本地包；app.asar 与此前已验运行包相同，不冒称再次构建应用或内核。
- distribution/README.zh-CN.md：本地离线交付入口及人工审查行动。
- distribution/PRODUCT-BINDING.json：版本、app/Resources 全文件清单、源码/工具归档与 hash 绑定。
- distribution/MANIFEST.json：所有交付文件逐项 hash；实际旁置 app 树由 PRODUCT-BINDING 另行覆盖。
- distribution/source/core-supply-product.tar.gz：原始完整 OCCT 归档、26 文件 patch、必要头文件、23 静态库、spacer.cpp/spacer.o、重建脚本与原始许可。
- distribution/source/tool-materials/：固定 SDK、完整工具源码及明确复用的系统缓存（不是干净全库重编）。
- distribution/source/final-build-evidence.tar.gz：最终默认/源修改核的 link map、why-extract、reproduce 及对象 hash；实际默认提取 2728 个 OCCT、317 个系统成员。与供应的 4193 OCCT 成员区分，且不是 wasm-opt 后函数存活证明。
- distribution/source/product-integration-source-final.tar.gz：前阶段运行集成/门禁源；distribution/closeout-source.tar.gz 是本次告知与供给索引修改源补充。两者不能互相冒充。
- distribution/review/：逐对象/头文件/JS/应用许可矩阵、固定官方材料摘要、法律问题清单。
- distribution/review/source-notice-overlay.patch：26 文件显著通知的独立注释补丁，注释添加日期 2026-11-14，不倒推上游实际修改日期/作者。原始编译输入不改写；人工仍需审阅原修改日期义务及注释补丁是否足够。Controller 行为修改另列，不假装已给历史源补日期。

索引中的 step-source-build 等前缀仅表示原始取证出处，不是离线重建执行路径。归档内旧绝对路径属于保留的历史命令/map；离线执行使用下面的相对参数。

## 离线重建与用户替换

在 distribution/source 中：

    tar -xzf core-supply-product.tar.gz
    python3 core-supply-product/rebuild.py --tools tool-materials --work 'rebuild with spaces'

主机前提 macOS arm64、Python >=3.10、Node 在 PATH、系统 patch。固定 SDK/缓存由本地 tool-materials 提供，不在线安装，不要求旧开发绝对路径。
先重构 35413 个固定输入，重编应用 wrapper 见证与同对象链接；再真实改 Controller 源、重编该对象/更新 archive/链接。
这不是全库从零编译或工具链二进制可重现认证。既有含空格路径重建/产品使用实证保留；本次只复验材料完整性和新告知，不为补文字再编内核。

自定义修改：先 --phase prepare，在新 work/source 改库源，再 --phase recompile --source <源内相对路径> --toolkit <对应TK库> --variant <新输出名>。保持 C ABI、内存/表限制，不覆盖固定默认资源。

主进程启动前显式设置 CUNLIAN_STEP_LOCAL_OPT_IN=1、CUNLIAN_STEP_LOCAL_WASM=<本机修改核绝对路径>、CUNLIAN_STEP_LOCAL_SHA256=<该文件实际摘要>；详见 step-kernel-replacement.md。
固定 JS/worker 不接受用户路径；不允许 renderer/模型选择执行路径。新代码若改变 ABI 需适配而非取消校验。没有默认核回退，不是恶意代码 OS sandbox。

版本/摘要以 PRODUCT-BINDING.json 实物为准。正式分发前必须审查最后真实交付包和供给集合，不得用开发目录的绿灯代替实际 Resources 门禁。
