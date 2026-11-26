# Track X · OCCT WASM 构建

从仓库根目录执行。已锁定 OCCT 7.8.1 源码、Emscripten 4.0.23 和构建辅助工具。构建不需要 Electron、系统 CAD 库或 Docker。当前输出面向支持 WASM 异常及显式资源管理的 Node，应用集成由 M3X-INT-01 负责。

## 本地构建

需要 Git、curl、tar、shasum、Python 3、npm，Node 24 或更高版本，以及 Emscripten SDK 支持的主机。用仓库外部目录安装工具：

```bash
source scripts/occt-wasm-build/versions.env
occt_tools="$(mktemp -d)"
git clone https://github.com/emscripten-core/emsdk.git "$occt_tools/emsdk"
git -C "$occt_tools/emsdk" checkout --detach "$EMSDK_COMMIT"
"$occt_tools/emsdk/emsdk" install "$EMSDK_VERSION"
"$occt_tools/emsdk/emsdk" activate "$EMSDK_VERSION"
source "$occt_tools/emsdk/emsdk_env.sh"
python3 -m venv "$occt_tools/venv"
"$occt_tools/venv/bin/pip" install "cmake==$CMAKE_VERSION" ninja==1.13.0
npm install --prefix "$occt_tools/ts" --no-audit --no-fund --save-exact "typescript@$TYPESCRIPT_VERSION"
export PATH="$occt_tools/venv/bin:$occt_tools/ts/node_modules/.bin:$PATH"
export OCCT_BUILD_DIR="$occt_tools/build"
scripts/occt-wasm-build/build.sh
node scripts/occt-wasm-build/smoke.mjs
```

默认输出为 `vendor/occt-unified/cunlian_occt.{wasm,mjs,d.mts}`。设置 `OCCT_OUTPUT_DIR` 可以输出到独立目录。用 `JOBS` 调整编译并行度，默认 8。离线构建可预置锁定的工具链、Emscripten 缓存与 `$OCCT_BUILD_DIR/occt.tar.gz`，脚本仍会核验源码压缩包。每个构建进程使用独立的 `OCCT_BUILD_DIR`。

`reproduce.sh` 在两个空目录中构建并执行同一套 Node 烟测，然后逐字节比较 WASM、glue 和声明并打印 SHA-256。需预留两份构建目录的磁盘空间。STEP 文件包含生成时间，验证以解析后的几何和元数据为准。

## 构建配置

OCCT 静态对象默认以 `-O2` 构建。为稳定输出，[wasm-codegen.cmake](wasm-codegen.cmake) 对六个存在指令顺序差异的源文件降低优化级别。原生 WASM C++ 异常保留，关闭基于 Unix 信号和 `setjmp` 的 OCCT 信号转换。交付用的集成构建保留绑定层及隔套接口的 DWARF，便于回溯跨 WASM 边界的异常和调用。平台发布时的符号保留策略由接入与打包阶段决定。

## 绑定

`bindings.cpp` 和 `xcaf.cpp` 是 Embind 接口源。JS 层销毁所获对象，继续使用当前代码的 `using` 约定。XCAF 文档用完后调用 `application.Close(document)`，再销毁其 JS 句柄。标签依附于其文档。标签序列按 OCCT 的规则从 1 开始索引。RGB 为 0–1 sRGB；用零件定义标签或子形状标签获取适用颜色。实例标签引用定义，实例局部位置通过 `GetLocation` 获取，按父位置乘子位置组合。

隔套导出链接基线的 `vendor/step-narrow-v1/spacer.cpp`，保留 `_spacer_step(D,d,L)` 的状态码和 MEMFS 文件名。脚本校验该翻译单元的 SHA-256。

`symbols.json` 是 Node 运行时核对表。现有调用来自 `desktop/main/geometry-prototype/plate.mjs`、`desktop/main/project-agent/m2/solid.mjs`、`src/core/geometry/{primitives,topology,orthographic,stepImport,assemblyGeometry}.mjs` 和隔套 worker。符号核对既包括这些文件的模块入口，也包括从类方法返回的句柄类型。距离、抽壳和 XCAF 为本卡验收约定的附加接口。
