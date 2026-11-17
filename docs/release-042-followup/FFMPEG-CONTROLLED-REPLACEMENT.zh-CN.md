# FFmpeg 受控替换：可执行副本流程（2026-11-17）

**仅工程见证，HOLD 不变。** 不重编内核、不在线下载、不全局安装、不改源应用、不重签名、不关 hash。
Python 3.9+、Node（须支持全局 WebSocket；本机已实测）、macOS 自带 `otool`/`lsof`。
脚本从自身位置确定仓库，所有输出限定在
`../release-042-artifacts/followup-source/legal/`；运行前停止要测试的独立副本，不对运行中的库做替换。

## 既有脚本审读结论

`../release-0.4.2-artifacts/revision-02/prepare_ffmpeg_replacement.py` 会先创建独立副本，再把
官方另配置 FFmpeg 写入固定 `Versions/A/Libraries/libffmpeg.dylib`，不是生产 opt-in。
它依赖 `archive_read`/旧目录，不提供通用 CLI，未在写入前要求调用者提供原库和候选双 hash。
`verify_media_policy.py` 的旧 `FFMPEG-REPLACEMENT-WITNESS.json` 记录 16 项应用导出检查，
但其 SVG/PDF 成功不等于媒体解码。**不直接重跑旧脚本或覆盖旧证据。**

新增 `ffmpeg-controlled-copy.py` 是独立工程辅助，不向产品增加动态搜索目录、renderer 参数或加载后门：

- 默认只校验与输出计划；只有 `--apply --run-name <全新名字>` 才复制后修改。
- 原库 SHA256 与候选 SHA256 均强制、小写 64 位；同字节候选拒绝，不能伪报替换。
- 候选只接受普通文件、有界读取、同 fd 校验，拒绝路径任意层软链接；镜像 magic 检查不是 ABI 证明。
- 库相对路径只有两项白名单：mac `.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib`；Windows 应用目录 `ffmpeg.dll`。不接受任意目标路径。
- 复制保留应用内部 framework 软链接，但拒绝解析到 bundle 外的链接。独立副本先逐文件 hash/模式/链接验证，原子替换库后只允许白名单一项变化，再核对整个源应用未变。
- 不修改应用可执行文件、`app.asar`、STEP manifest、SBOM、签名、系统权限或全局库路径。不执行候选库。
- 失败 exit 2，不回退为“通过”；副本中途失败的目录保留供检查，换新名字再试，不覆盖/删除历史。
- 不面向可恶意并发篡改工作目录的攻击者；需使用当前用户控制且无并发修改的本地目录。候选原生库不受 WASM 隔离，**仅使用可信来源**。hash 证明字节身份，不证明安全或 ABI。

## 只读计划与显式执行

从仓库根运行。下例使用本轮已核对的**官方另一 codec 配置**候选，绝不把它称为产品对应库或用户源码重编库：

```sh
python3 -B docs/release-042-followup/ffmpeg-controlled-copy.py \
  --platform macos-arm64 \
  --product 'out/寸链-darwin-arm64/寸链.app' \
  --candidate '../release-042-artifacts/followup-source/legal/candidate-20261117/libffmpeg.dylib' \
  --original-sha256 c0cc2b45bae4705548b0baecefbcf621589267473156023b894df1b28a1ddc28 \
  --candidate-sha256 61c9c2ac6390e8d5cf0c666bd760b93f203c9ad9448ff3fba1ab4a466cdd45f8
```

默认结果 `mode=READ_ONLY_PLAN`，无副本写入。在**同一命令末尾显式加**
`--apply --run-name mac-copy-new-01` 才创建新的隔离 `.app` 副本并替换；名字已存在即拒绝。
在别的机器上，应自行准备可信接口兼容候选、核验其源码/平台/版本/摘要后替换参数，不能复制以上摘要去“批准”不同字节。
Windows 选择 `--platform windows-x64` 并提供应用目录和可信 x64 DLL 的实际双摘要；仅提供复制工具能力，**没有 Windows 运行测试**。

## 本机见证重放入口

下面两条已实跑。它们使用固定的新证据目录名，只能在这些名字不存在时运行；当前再次运行会拒绝，避免覆盖证据。
要重放，先审阅并另选新运行名字/证据目录，不能删除历史来取得绿色。无需安装新依赖。

```sh
python3 -B docs/release-042-followup/verify-ffmpeg-controlled-copy.py
node docs/release-042-followup/probe-ffmpeg-runtime.mjs
```

第一条从已存在的官方 FFmpeg zip **只读取**唯一 dylib member，核对独立旧见证中的候选摘要后，
在新证据目录提取候选；检查默认只读、错误候选 hash、错误原库 hash、非法目录名、缺少显式名字、
软链接候选、真实副本单库替换、拒绝重复目录、framework 链接路径，共 9 项。没有修改旧脚本/旧材料。

第二条只启动 `mac-copy-20261117/product.app`，用独立 user-data，清除敏感 token 和库加载注入环境；
通过 loopback Node inspector 在真实产品窗口执行 PCM WAV 解码，`lsof` 确认本进程映射了副本中候选库路径，
再核对该文件摘要，退出自己启动的进程。测试夹具为程序生成 400 Hz / 800 帧 PCM WAV，不是外部私密媒体；
没有修改产品 `webPreferences`、权限或安全配置，不自动操作任何签名。调试端点仅测试期间存在。

## 2026-11-17 实测输出

```json
{"passed":true,"checks":9,"changedFiles":["Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib"],"sourceTreeVerifiedUnchanged":true,"nativeRebuildExecuted":false}
```

运行测试实际返回：

```json
{"status":"PASS","decode":{"electron":"45.2.3","channels":1,"frames":800,"sampleRate":8000,"peak":0.30518507957458496,"passed":true},"loadedCandidateImage":true,"processExit":{"code":0,"signal":null},"hashChecksDisabled":false,"signatureOrPermissionChanges":false}
```

准确机器证据（相对仓库根）：

- `../release-042-artifacts/followup-source/legal/controlled-copy-verification-20261117.json`
- `../release-042-artifacts/followup-source/legal/mac-copy-20261117/replacement.json`
- `../release-042-artifacts/followup-source/legal/mac-runtime-20261117/runtime.json`
- `../release-042-artifacts/followup-source/legal/mac-runtime-20261117/generated-400Hz.wav`

user-data/应用副本只供本地见证，不列为公开资产；不得未经另行隐私筛查整目录打包。

## 仍不能作出的结论

本机仅证明当前 mac 环境下官方另配置库可映射、产品可启动且完成一例 PCM WAV 解码。
加载路径证据与解码结果并不证明 decoder 内部所有函数都来自 FFmpeg，也不覆盖专有 codec、ABI 所有符号、
用户源码重编库、Windows、Gatekeeper/签名发行环境或 LGPL §6(b) 全部条件。
如果签名/加载失败，应记录失败并停止：本说明不提供去签名、降级验证或临时关闭 hash 的捷径。
最终 `args.gn`/SDK 配方和用户修改源码库验证缺口见决策表 C，不能靠本工具解除。
恢复方式是退出并停止使用此副本，回到从未被修改的源应用；不自动删除历史、不把候选复制回原包。
