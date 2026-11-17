# LICENSE 工程决策表（2026-11-17）

状态：**HOLD / BLOCKED 原样保留；不是法律结论或发布批准。** 基线 `7e11f5e`。
根 `LICENSE` 是应用 MIT，不替代第三方原文。本表对应
`../release-042-artifacts/LICENSE-FACTS.zh-CN.md` §5 的 A/B/C；路径均相对仓库根。

## 原文定位与准确短引

下列 L 指 `desktop/main/cad/licenses/LICENSE_LGPL_21.txt` 的行号，短引只把换行并为空格。
FFmpeg 随供 `source/electron-45.2.3-ffmpeg-corresponding-source.tar.gz` 内
`electron-45.2.3-ffmpeg-source/ffmpeg-electron/COPYING.LGPLv2.1` 也保留 LGPL 2.1 原文。

| 项 | 相关原文短引 | 已供材料（本地实物，不等于已正式交付） | 确切缺口 | 可修工程措施 / 需用户或有权人员决定 |
|---|---|---|---|---|
| **A：修改文件显著通知与日期** | §2(b), L169–170: “stating that you changed the files and the date of any change.” | `../release-042-artifacts/supply/review/{modified-file-date-review.json,source-notice-overlay.patch,modified-controller-notice-overlay.patch}`；26 个既有 OCCT 修改文件的补丁、前后 hash；overlay 明示添加日 **2026-11-14**，历史修改日 `NOT_INFERRED`。 | 添加通知的日期不是原修改日期；尚无逐文件历史修改日期与显著通知充分性的决定。当前新文档日期不能填补此事实缺口。 | 工程：从固定补丁/可核历史提取逐文件日期证据，区分提交日期、实际编辑日期、通知添加日期；在独立源码供给派生副本加显著头、保留原版权和双 hash，不改编译输入冒称原件。决定：有权人员逐项判断材料是否足够及采用哪种披露，不自动写 APPROVED。见 `MODIFICATION-NOTICE.zh-CN.md`。 |
| **B：静态 OCCT WASM 的源与重链接路径** | §4, L230: “complete corresponding machine-readable source code”；§6(a), L291–293: “so that the user can modify the Library and then relink to produce a modified executable containing the modified Library.”；工具例外 §6, L321–323: “normally distributed (in either source or binary form) with the major components” | `../release-042-artifacts/supply/source/core-supply-product.tar.gz`、`source/tool-materials/`；固定源、26 文件补丁、wrapper/应用对象、23 静态库、缓存与工具；`supply/review/OFFLINE-RELINK.json`：35413 输入重构全同、重链接 JS/WASM 与两平台相同。`docs/step-narrow-runtime.md` 记录真实修改核成包执行；本轮未重编内核。 | 选定 §4/§6(a) 路径的材料范围与工具例外边界尚未形成有权决定；不能把缓存重链接说成全部工具二进制或全内核从零复现。A 中日期问题仍独立存在。 | 工程：按对象/静态库/link 命令/工具索引逐项复核可移植供给与既有见证，明确哪些工具随应用、哪些仅开发依赖；保留 ABI、hash、资源限额与修改核 opt-in。决定：有权人员确认所选路径与例外范围。OCCT exception 原文仅涉及 “material from a header file”，不是整个静态库的普遍豁免。 |
| **C：原生 FFmpeg §4 / §6 路径与替换限制** | §0, L139–140: “the scripts used to control compilation and installation of the library.”；§4 同上；§6(b), L302–304: “will operate properly with a modified version of the library, if the user installs one, as long as the modified version is interface-compatible” | `../release-042-artifacts/supply/source/electron-45.2.3-ffmpeg-corresponding-source.tar.gz`：固定完整 FFmpeg、Electron 四补丁、Chrome 两目标配置、GN/生成脚本、许可；`supply/review/NATIVE-SOURCE-VERIFICATION.json`：11114 重构文件全 hash 同。两平台产品库等于官方完整 Electron zip。新增受控副本替换和 mac 实测见 `FFMPEG-CONTROLLED-REPLACEMENT.zh-CN.md`。 | 官方最终完整 `args.gn`/SDK 配方、用户源码重编库及两平台修改库兼容性仍未证实；mac 本轮仅另一官方 codec 配置库的加载和 PCM WAV 解码。未证明 Windows、所有 codec、签名分发场景或任意 ABI 兼容修改库。 | 工程：先只在独立副本用白名单库路径、原库和候选双 hash 替换并保留默认验证；用户库可用时再测所需媒体、加载和 ABI；签名/加载失败即停，不自动重签或放宽验证。决定：选用 §6(b) 或其他路径，审查 §4 源范围及实际加载限制。§6(b) 不据此取消库本身 §4 的对应源材料问题。 |

### 共同边界

- §6 L274–276 原文：“permit modification of the work for the customer's own use and reverse engineering for debugging such modifications.” 既有自用修改/调试权利不新增限制；本工程工具不等于对这些权利的法律充分性裁定。
- `CONFIG_GPL/NONFREE/VERSION3=0` 是目标配置事实，不解决 codec 专利/法域问题，也不因源树有可选 GPL 文件就判断实际库为 GPL。
- **D 正式交付仍 pending**：用户已批准同一 GitHub Pre-release 页面渠道，主控仍须实际上传、下载、核验。此次没有发布、push/tag/release，也没把渠道授权写成已交付。
- `scripts/check-step-release.mjs` 无环境豁免且固定非零退出；新增材料不更改 SBOM、hash、门禁或旧供给。没有要求付费认证、无边界扩展所有 MIT/BSD 组件或新增 EULA。
