# 真实 Electron 截图复现说明

## 基线来源

fdd200de96d1c50154da68c1c3cf97a5f3efe499 用 git archive 提取到独立目录，只链接现有项目 node_modules 后实际打包；没有覆盖主工作树。为避免污染工作区，基线目录现位于：

/Users/aston/.hermes/profiles/daedalus/cache/scratch/ui-id-baseline-fdd200d

基线 app.asar SHA-256（已重新实测核对）：
c4576f7281f73bf9836bc6b10f5d403020b451faea7a5b5bd98ca77f65f1dec4

## 实际命令

在 /Users/aston/DSH/staff 执行：

    env -u ELECTRON_RUN_AS_NODE node scripts/ui-id-evidence.mjs before '/Users/aston/.hermes/profiles/daedalus/cache/scratch/ui-id-baseline-fdd200d/out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链' 9460
    env -u ELECTRON_RUN_AS_NODE node scripts/ui-id-evidence.mjs after
    env -u ELECTRON_RUN_AS_NODE node scripts/ui-id-evidence.mjs packaged 'out/寸链-darwin-arm64/寸链.app/Contents/MacOS/寸链' 9462

三条均已真实执行且 exit 0。日志分别为 logs/before-screenshot.log、after-screenshot.log、packaged-screenshot.log；输出 UI_ID_EVIDENCE=baseline-reproduced / pass / pass。

## 截图与真实流程

before / after / packaged 各有：

- <阶段>-topbar-formal-version-960x640.png：顶栏和 Agent 正式版本。
- <阶段>-agent-submit-receipt-960x640.png：真实成功提交回执。
- <阶段>-observed.json：可见文案、PNG SHA-256、主进程前后快照与原始断言结论。

使用仓库已有 docs/evidence/v40-stage3/fixtures/stage3-seed.cunlian 的隔离副本，不改 seed；项目名为“隔套 · 阶段3 侧栏走查”，不是用户原项目截图。实际启动 .app，以独立 user-data-dir 运行，通过 CDP 真实鼠标点击内置离线正常改图和确认保存。没有替换 DOM 文案，没有 mock IPC；预览、授权和原子提交是实际主进程实现。脚本断言提交前后 currentRevisionId 确实改变。

基线 seed 的原始版本是短 ID rev-a1，所以先真正提交生成 UUID，拍提交回执；再 reload 重新挂接提交后的主进程快照拍顶栏/正式版本。基线普通提交原本不会刷新顶栏。修复后已复用只读重新挂接回调刷新；脚本仍按相同流程重载，保证三组可比。JSON 的 initial.session 是提交前快照，initial.topbar / initial.formalVersion 是重载后的三位置取证文字，committed 是提交后快照。

修复后及最终包的三处实际文字均与主进程历史中的第 2 版一致；回执为“已提交（工具回执） · 第 2 版”。脚本不只检查“没有 ID”，还核对实际正式序号，防止空白/随便一段占位文案通过。

PNG 来自实际 Electron renderer 的 Page.captureScreenshot，960×640 viewport override，脚本校验 PNG IHDR 的实际像素。不是合成图/遮掩图，也不声称包含 macOS 原生窗口边框。图中文字已视觉核对。

JSON 在检查原始渲染输出后才用 serializeEvidence 归一 UUID/机器路径，遵守项目证据守卫；没有对 PNG 进行遮掩或归一。包 hash 见 packaged.sha256。
