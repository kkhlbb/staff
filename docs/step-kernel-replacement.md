# 用户修改库、替换与调试：当前边界

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
