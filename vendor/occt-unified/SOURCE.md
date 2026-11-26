# 对应源码与替换说明

本构建链接 Open CASCADE Technology（OCCT）7.8.1，适用相邻的完整 LGPL 2.1 和 OCCT Exception 文本。

- 官方源码仓库为 [Open-Cascade-SAS/OCCT](https://github.com/Open-Cascade-SAS/OCCT)，标签 `V7_8_1`，提交 `bd2a789f15235755ce4d1a3b07379a2e062fdc2e`。
- [对应压缩包](https://codeload.github.com/Open-Cascade-SAS/OCCT/tar.gz/refs/tags/V7_8_1) 的 SHA-256 为 `7321af48c34dc253bf8aae3f0430e8cb10976961d534d8509e72516978aa82f5`。
- OCCT 源码直接从校验后的压缩包构建。构建配置、绑定与烟测见 [构建指南](../../scripts/occt-wasm-build/README.md)。隔套翻译单元见 [spacer.cpp](../step-narrow-v1/spacer.cpp)。

## 重编译并替换

1. 获取包含本目录、构建脚本及隔套翻译单元的对应源码树。按构建指南安装工具链并生成 WASM、JS glue 和 TypeScript 声明。
2. 如需使用修改版 OCCT，将其打包为含相同顶层目录的归档，放到新的空构建目录的 `occt.tar.gz`。在自身副本的版本锁更新 SHA-256，并保留改动与其许可证记录。重编译所有 OCCT 静态库及绑定。
3. 在独立输出目录运行 Node 烟测。客户端使用修改版时，让加载器载入此次构建的 `cunlian_occt.mjs` 和匹配的 `cunlian_occt.wasm`。两个运行时文件来自同一次构建，声明随之替换。

本卡准备构建侧材料。M3X-INT-01 与 M3-QA-02 仍负责应用加载与打包、发布渠道提供对应源码及替换方式、安装包验证和 LGPL 发布门禁。
