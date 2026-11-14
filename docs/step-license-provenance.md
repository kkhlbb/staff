# 固定 STEP 二进制：来源、义务和分发门禁

状态：分发仍阻塞；不是法律认证。机器清单 STEP-SBOM.cdx.json 明确 incomplete。
外部证据相对本工作树 `../step-followup/provenance-research/`；保存原始HTTP、官方
固定commit源码归档、下载哈希与源文件摘录，不用上游main/master作为对应源码。

## 字节身份：已闭环

npm官方 https://registry.npmjs.org/replicad-opencascadejs/1.2.1 的真实tarball
SHA256 07b6fb17a26a0be2de35be298fe3401852446a8cbb7306605b63c07d1d4207c2，
SRI见NOTICE；SHA1 f8b65496b26b232e16023de87089ec1d3a425722。
registry签名验证2项成功，11个安装文件与tarball一致。
固定仓库 https://github.com/sgenoud/replicad/tree/5e4ad9bb5a35bb9ae0571e91c25fa1897ba0570c
的8个dist与npm字节相同（package.json仅npm多gitHead）。WASM固定sha见SBOM。
这确认发布资产身份，不确认可重现构建。npm attestation端点404，原文保留。

## 构建参考：已锁定，但未证明产出目标

https://github.com/taucad/opencascade.js/tree/341fa789f49ce73db76a0209d89ae518cc64a52d
由v3.1.0 annotated tag解析而来，无gitlinks/.gitmodules；依赖用DEPS而非子模块。
该参考DEPS：

  OCCT V8_0_1 b8f597c677811d1f9f4d8a97f5ae2825c0353a42
  C++ RapidJSON 24b5e7a8b27f42fa16b96fc70aade9106cf7102f
  FreeType头文件2.13.0 de8b92dd7ec634e9e2b25ef534c54a3537555c11
  emsdk6.0.5 dfb9d1a46c3bb8f52e1e6324be23123b9d73c190
  Emscripten6.0.5 1db513782be24469589d7cb8a1f1834e9a33f271
  LLVM abd3b3a1445b5a8eeffae5c3912883faa9287fb7
  Binaryen 55dff6b2430aee4fee7e5cf748af07222b079742

以上前五项源码归档已实际下载核验；LLVM/Binaryen只追到官方DEPS，未下载/构建。
Dockerfile base emsdk digest 76a44fff907397784decc435115d07fcb9587a4f1504977f39f3745e538e3a1e。
当前GHCR tag index digest d7bf97ada840afb0f0e0f6bba04b1b55dd0d276e1679a3e40c1431a2cf44900b，
OCI manifest/config/attestation的12个descriptor核验匹配，config/SLSA指向上述commit。
但npm构建脚本使用可变tag，不知构建时digest/平台。容器SLSA明确
resolvedDependencies=false，含seed image，未独立验证DSSE签名，也未运行镜像。
不能倒推当前容器就是目标WASM所用容器。

完整build-config YAML、6个wrapper CPP、生成器、patches在固定源码中可得；
容器Dockerfile却删除生成binding .cpp/.h只留.o/.a。目标无sidecar/link map，WASM
无custom provenance section。源码下载树是官方未应用patch版本，不能称已重建修改源。

## 静态组件/嵌入许可

SBOM区分已测资产与候选源组件，不把容器的Ubuntu/Node/Python全算进WASM。
OCCT、LGPL绑定与Emscripten glue存在；运行时对象/裁剪情况仍缺map。
候选包括musl、libc++/abi、libunwind、compiler-rt、mimalloc、RapidJSON；OCCT内嵌
David Gay dtoa/strtod、Delabella MIT、Bison parser skeleton special exception等
原文保留在licenses/STEP-CANDIDATE-LICENSES.txt，不能漏掉也不凭此断言全部存活。
FreeType头文件2.13.0不等于Emscripten port 2.13.3；后者及zlib1.3.2归档SHA512
已核，但目标YAML无USE_FREETYPE，实际链接未证实。可视化关闭，不把OCCT源码内
DejaVu字体自动列为实际产品依赖。不是完整实际静态组件清单。

## LGPL 2.1与exception：必须闭环而非本地测试替代

以随附原文为准（尤其第4/6节），选择适用路径并请专业审查：显著告知、许可文本、
完整对应库源码及修改/必要脚本；适用的应用对象/可重链接或兼容共享库机制；
允许用户修改库并实际运行、允许为调试这些修改而逆向工程。OCCT exception只涉及
头文件材料，不是库的静态/WASM对象普遍豁免。业务MIT边界原样保留。
当前只是本地实验，不提供不实的书面源码offer，不拿上游URL代替供给。

正式供给包仍缺：目标构建历史digest与平台；完整patched source与生成绑定CPP；
实际对象/静态组件清单、工具链与最终link command/map；可执行并已验证的
修改库重新链接/运行路径。完整源码包应逐文件哈希，与目标资产建立对应并随实际
分发渠道提供。没有这些材料，不可能靠一句“MIT开源可自己改”就关闭LGPL门禁。

## 可机器检查门禁

npm run check:release:step 明确非零退出并列blockers；普通package仅表示本地构建成功，
不表示许可通过。打包断言要求NOTICE、部分SBOM、完整许可、替换/来源文档字节
与源码一致，要求SBOM状态blocked/incomplete、资产sha与运行manifest匹配。
删除或篡改任何告知均须失败；不能移除门禁以获得绿灯。

## 220a45f之后的阻塞缩减（发布状态不变）

新来源材料见 ../step-followup/replacement-20261114-research/REPORT.zh-CN.md。
父任务独立逐文件重算该目录清单36511项，零不一致；报告和归档摘要均可核对。
实际从固定官方 OCCT 源副本应用9个 taucad patches，26文件变化，保存逐文件
前后sha与统一diff；libembind补丁结果与固定上游expected.sha256一致。这些现在是
候选修改源码实物，不再只有未应用补丁的原始树；仍无证据确认目标npm采用这些字节。
LLVM/Binaryen缺失的固定commit完整归档已实际下载并校验，许可原文落盘。

本机实际编译原OCCT Standard_Strtod.cxx，再修改该组件、重编/重链接运行，
两版输出与对象/native link map保留；这仅证明native数值组件，不是WASM或产品
重链接。窄C ABI方案 narrow/spacer.cpp、build.py、smoke.cjs已落盘，真实头文件
语法检查通过；构建前检exit2明确缺emcc/em++/emcmake/cmake。手写窄接口无需
全量绑定工具；若走上游生成器则还缺Python3.14、PyYAML6.0.3、Cerberus1.3.8、
libclang18.1.1和LLVM17解析头。仅批准后才将固定SDK6.0.5和CMake4.3.2放项目局部，
用现有make；不需要全局安装、Docker或Ninja。源码依赖保守闭包23个toolkit，
TKDESTEP经XCAF引入可视化支持，不能承诺只三库或无字体/图形依赖。候选构建
尚需真实configure/link求值，报告不冒充可重复构建成功。

新增本地WASM opt-in将随包默认资源与用户修改资源分开：固定默认资源严格hash
仍不变；用户独立同意、绝对路径和摘要，受限读取字节快照，固定worker/glue/API
检查及资源限额。测试采用真实数据段行为修改和内存最大值修改，不是custom section。
具体入口/安全边界/限制见step-kernel-replacement.md。其可运行结果不等于完整
对应源码/应用对象/重链接及法律供给路径都已证实；四项release blocker继续保留。
旧npm仍缺历史构建digest/平台/日志、完整生成CPP、实际最终link map/对象清单；
新窄核也尚无完整WASM构建/两次复现结果，因此没有改为complete或解除分发门禁。
