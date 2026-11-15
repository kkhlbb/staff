# 当前窄核接入增补

当前资产、供给、ABI和限制以 [step-narrow-runtime.md](step-narrow-runtime.md) 为准。
新SBOM为STEP-NARROW-SBOM.cdx.json；旧STEP-SBOM及以下记录不改写为新核证明。
新核两支均受实际512MiB内存/表限制；仅三项新运行资源，不再含旧npm JS核。
门禁仍BLOCKED/INCOMPLETE，没有发布许可。

## 以下原文保留为旧版本与实验历史

# 用户修改库、替换与调试：当前边界

## 本轮新增：独立、受限的用户本地 WASM opt-in

状态仍 BLOCKED（分发许可/完整对应源码未闭环）；下文原阻塞探针与步骤保留为历史事实。
新增机制不修改默认资源、也不把自选库冒称 npm 原版。由用户在启动主进程前同时设置：

    CUNLIAN_STEP_LOCAL_OPT_IN=1 \
    CUNLIAN_STEP_LOCAL_WASM="/用户自行选择/compatible.wasm" \
    CUNLIAN_STEP_LOCAL_SHA256="该文件的小写64位SHA256" \
    env -u ELECTRON_RUN_AS_NODE "/新本地包/寸链.app/Contents/MacOS/寸链"

不使用 open -a（其环境继承不同）；不自动下载、不申请权限、不更改文件权限。
这是用户自选文件及其摘要的明确同意，不是模型/renderer/IPC 参数。主进程模块初始化
时捕获三项环境，仅在该进程生效；缺任何项、错误 opt-in、非绝对路径/摘要均拒绝，
不退回默认。即使启用此模式，随包四项默认 CJS/JS/WASM/worker 仍先逐项严格校验。
只允许 WASM；不接受自选 JS、CJS、worker 或动态库搜索路径。

读取使用 O_NOFOLLOW/O_NONBLOCK、同一文件描述符，只接受普通文件与8B–64MiB，
有界读取后验证用户摘要。符号链接叶节点/目录/缺失文件均拒绝；不提权，原有 OS
访问权限仍适用。父目录软链接不构成权限绕过；用户本来可访问的路径按 OS 解析。
将已校验字节快照送入一次性 worker，不让 worker 重新打开自选路径。

固定 glue 不支持 wasmBinary 入参（实测行为负例发现），因此必须通过
instantiateWasm 同步实例化校验后的快照。无文件/网络下载或默认 WASM 回退。
worker 内再次校验摘要、限制64MiB、编译验证、对照固定模块 imports/exports
名称/顺序/种类；引擎在实例化时检查函数签名/链接兼容，运行前检查关键绑定 API，
其后保留全部原几何、体积、通孔、面类型、schema/单位断言。
API 兼容检查不是数学上证明任意用户代码正确或无恶意；只针对受支持 ABI。

本地核要求一个非共享32位内存，声明最大 <=8192页（512MiB），以及受限 funcref
表（最大100万项）；未声明最大/超限/错误类型拒绝，不能以 V8 resourceLimits
冒充 WASM 内存限制。固定默认核不改其原内存声明。两种模式的 worker 均不继承
execArgv/环境，V8 old/young/stack 限额256/32/4MiB，30秒超时、单任务并发、
取消/超时等待真实 terminate 后释放忙状态，STEP接收上限16MiB。
这不是 OS 进程 sandbox 或总 RSS 硬上限：编译器/native开销仍存在；WASM 只能
调用固定 glue 的 imports（虚拟 FS，不挂载用户目录），不能选择任意 Node JS。
不声称引擎漏洞防护或恶意代码强隔离。不要加载不信任的文件。

回执 kernelVersion 标注 user-selected-local-wasm/unverified source identity，
wasmSha256 为实际用户字节，generatorVersion 带 local-wasm-opt-in-v1。
错误使用 STEP_LOCAL_CONFIG/FILE/SIZE/HASH/COMPILE/ABI/MEMORY/TABLE/INSTANTIATE
或原几何断言，通道继续返回 STEP_EXPORT_FAILED 且不输出本地路径/原始异常。
取消、历史冻结、会话/写入授权没有新增绕过入口。

可复验候选生成器 scripts/step-evidence/local-candidate.mjs：对固定 WASM 的真实
数据段修改 STEP translator/processor 字符串，并将真实内存最大值从4GiB降到512MiB，
不添加 custom section。导出文件必须出现 USER PATCHED，才能证明实际执行了修改库，
只看摘要/成功回执不足。它是二进制行为修改探针，明确不是从对应 OCCT 源重编，
不是应用对象重链接或完整 LGPL 第6节验证。正式源码构建仍需后述缺失材料。

证据：../step-followup/replacement-20261114/；固定源码续追与局部构建候选：
../step-followup/replacement-20261114-research/REPORT.zh-CN.md。

## 以下为220a45f及之前的历史结论（不是新增机制的现状）

状态：BLOCKED。应用不以条款禁止LGPL库修改、重新链接及为调试修改而逆向工程；
MIT应用源许可保持原样。但技术上固定hash拒绝直接替换，此版本不声称已提供
LGPL第6节合规机制。不能把“源码可见”或“外置WASM”当作机制已经闭环。

## 已可执行的安全探针（只对新本地实验包）

在本仓库已有局部依赖的工作副本，使用从未存在的输出目录：

    npm run step:assets
    STEP_EVIDENCE_DIR="$PWD/step-fixtures-new" ./node_modules/.bin/vitest run --config vitest.step-evidence.config.ts
    env -u ELECTRON_RUN_AS_NODE npm run package:desktop -- --arch=arm64
    node scripts/step-evidence/packaged.mjs "$PWD/out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链" "$PWD/step-fixtures-new" "$PWD/step-replacement-new"
    npm run check:package:step -- "$PWD/out/寸链-darwin-arm64/寸链.app/Contents/Resources"

注意：package会写out，应只在新副本运行，勿指向旧验收包。未安装/未授权工具则先
停在相应前置条件，本说明不要求全局安装。脚本调用真实成包IPC/worker，只桩化
原生对话框。将原WASM追加一个合法无行为custom section，WebAssembly.validate
确认合法，写出候选/hash，再置入本次包。期望STEP_ASSET_HASH、无目标写入；
finally恢复原WASM字节，随后odd导出及资源断言验证恢复。失败日志不能计作可替换通过。

该探针只证明当前直接替换被阻塞；它不是修改OCCT代码、重新链接或验证API兼容性。
receipt/audit保留在新输出目录，不修改开发源manifest，不放宽运行时hash检查。

## 修改源/重链接的待闭环步骤（不是已验证的成功操作）

1. 取得与NOTICE中目标WASM对应的完整源/补丁、目标生成binding CPP、完整工具链、
   对象/静态库manifest、link command/map及必要脚本。当前这些材料不齐，此处即阻塞。
2. 固定所有源码与构建容器digest/平台，构建未修改库，先重现原始资产并记录sha。
   当前taucad固定commit只是构建参考，禁止声称能重现目标；不提供虚假成功命令。
3. 修改OCCT并重编绑定/链接为相同单线程ABI的 JS/CJS/WASM，保留新增许可与完整源码。
4. 用户可依据MIT修改本应用源中的desktop/main/cad/stepAssetManifest.ts，审核并
   更新三项内核hash（如worker修改也更新其hash），保留所有输入/几何/安全断言；
   同步SBOM、NOTICE和依赖身份，不能把修改库仍谎称原npm版本。
5. npm run step:assets；typecheck、test、test:desktop、build、package:desktop；
   新包真实导出并原生读回，缺/坏资源仍拒绝，取消仍零导出文件。修改库的元数据测试
   需按其真实身份审查，不能仅删除失败断言。源码构建重钉hash路线本轮未执行。
6. 在有对应源码、可运行修改库及法律审查证据后才重新评估分发门禁。正常本地包
   构建成功、此探针通过或重新钉hash本身均不能解除许可阻塞。

本轮没有Docker/emcc/cmake命令可用；未安装新工具。不能实际编译修改OCCT、
证明可重链接或给出成功的终端输出。当前阻塞有源材料缺失与工具链两层，
即使装工具也不自动弥补历史构建证据。完整本轮结果见docs/step-validation.md。
