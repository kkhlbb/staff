# M3X-KERNEL-01 验证报告

基线为 `5eb5e67f753600ffb0a94b19be06f942e697716d`。在 macOS 26.4 arm64 用锁定的 OCCT 7.8.1、Emscripten 4.0.23、CMake 3.31.6、Ninja 1.13.0 和 TypeScript 5.9.3 构建，以 Node 24.0.0 和 26.12.1 验证。OCCT 源码归档与隔套翻译单元均通过 SHA-256 校验，两份许可文件与 OCCT 官方压缩包中的原件逐字节一致。

| 产物 | 字节 |
| --- | ---: |
| `cunlian_occt.wasm` | 34,129,104 |
| `cunlian_occt.mjs` | 289,175 |
| `cunlian_occt.d.mts` | 27,522 |

单份 WASM 为 34.13 MB，在 30–45 MB 目标内。基线的 Replicad 与隔套 WASM 合计 40,687,078 字节。统一 WASM 少 6,557,974 字节。此处比较原始 WASM 字节，安装包体积留待集成验证。交付保留绑定层的 DWARF，支持后续调试跨 WASM 边界的调用和异常。

WASM 的 SHA-256 为 `6cb34be8e7cd73b121618bb8d3900d2950dc1b67043e59c9e499771afaf89282`。三份文件的校验清单见 [SHA256SUMS](../../vendor/occt-unified/SHA256SUMS)。

## 核对与运行证据

| 范围 | Node 运行证据 |
| --- | --- |
| 现有构形与量测 | 孔板、长方体两种构造签名、布尔切除并集交集、平面拉伸、倒角圆角、偏移厚度和抽壳、实体距离、旋转工况 |
| 拓扑、三角化、HLR | Adaptor、Explorer、曲面导数、184 个三角面、三视图可见线与隐藏线 |
| STEP 和隔套 | 单体与组合体写出及读回、隔套 AP214 读回几何校验、失败清理 MEMFS |
| XCAF | 八个核心类、三层标签链、中文定义名、两个共享定义的实例、旋转与父子组合平移、零件与面级 sRGB |
| 运行时 | 线性内存导出、C++ 异常类型查询与引用释放、TypeScript 声明严格检查 |

[符号核对表](symbols.json) 共列出 69 个不同的运行时符号，方法行为由 [Node 烟测](smoke.mjs) 覆盖。[实际烟测日志](smoke.log) 记录了符号和运行结果。用临时 Node 加载钩子把现有测试和 Worker 指向统一核后，孔板与装配几何的 9 个现有行为测试通过。该次运行排除了专门校验 Replicad 旧包版本、旧 WASM 字节与哈希的断言，尚未接入生产加载器。

首次试编发现 7.8.1 的 STEPCAF provider 依赖 `TKBinXCAF`，已加入构建。Emscripten 原生 WASM 异常与 OCCT 的 Unix 信号转换组合生成无效的 `br_table`，关闭信号转换后成功构建并通过 Node 测试。

## 可复现性

从两个独立的空工作目录构建。初次比对把 128 个 WASM 字节的差异定位到六个 OCCT 编译单元。对四个文件使用 `-O1`，对两个文件使用 `-O0`，在两个目录分别重新编译并链接后，`cmp` 确认 WASM、JS 和 TypeScript 声明逐字节一致。两份产物均通过烟测，日志也逐字节一致。用 [reproduce.sh](reproduce.sh) 可重复完整对照。

## 验证边界

多层装配样件由独立测试文档写成真实 STEP 文件，再传入新建文档核验。第三方 CAD 样件、外部 STEP 引用、跨平台打包、应用 Worker 集成、发布侧源码供给和用户替换入口由 M3X-INT-01 和 M3X-QA-02 继续验收。发布门禁保持待验状态。对应源码和替换说明见 [SOURCE.md](../../vendor/occt-unified/SOURCE.md)。
