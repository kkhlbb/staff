# 产品窄 ABI 运行核：当前资产与边界

当前默认核不再采用 npm replicad-opencascadejs 或248-symbol Embind ABI。
仅打包 `step-narrow-v1/{spacer.cjs,spacer.wasm,step-worker.cjs}`；开发源在
`vendor/step-narrow-v1/`，独立缓存 `node_modules/.cache/step-narrow-v1/`。
旧npm、缓存及旧STEP-SBOM保留为历史输入，不进入新包运行资源。

## 几何和隔离

工厂 createNarrowSpacer；C ABI `_spacer_step(Dmm,dmm,Lmm)`，零返回码才读取
虚拟FS `/spacer.step`。固定glue与worker先严格hash；只有主进程启动时显式
`CUNLIAN_STEP_LOCAL_OPT_IN=1`、绝对路径 `CUNLIAN_STEP_LOCAL_WASM`、小写
64位 `CUNLIAN_STEP_LOCAL_SHA256` 三项同意才采用用户WASM的同fd有界快照。
本地核不允许用户JS/worker；编译/ABI/资源/运行失败不回退默认核。

q整数、奇数q和旧几何边界不变。旧worker中单solid、单closed shell、四解析面、
两圆柱半径、两平面、体积及三孔点/材料点与距离断言迁至产品C++ wrapper，
在写STEP前及真实STEP回读后均执行。体积阈值max(1e-6,参考*1e-9)，
线性1e-6mm；没有用仅BRepCheck替代几何检查。默认与源修改核均真实重编
新应用对象后重链接，不能直接用缺检查的旧实验spacer.o。

默认/本地两支均检查实际WASM内存和表声明：单非共享32位memory，
最大8192页/512MiB；单funcref表有最大值且<=100万项。worker V8限额
256/32/4MiB不冒充WASM限制或总RSS硬上限。30秒、单任务、取消/超时等待
terminate、16MiB输出、冻结会话、原子写入及脱敏保持原契约。
不是OS sandbox；不可加载不信任的用户核，不能保证恶意库数学正确或引擎无漏洞。

## 对应材料及真实源修改

本地证据根 `../step-newkernel-integration/runtime/`：
- `rebuild-product.py`：真实编译新wrapper并重链接默认/修改OCCT库，map、why-extract、
  reproduce、完整命令与日志保留；非全库新编译。
- `core-supply-product.tar.gz`：独立产品应用对象/源码供给；配套工具实物仍为
  `../step-newkernel-integration/supply/tool-materials/`（供给内TOOLS.json精确核查）。
- 解包后的可移植 `rebuild.py --tools <工具材料> --work <全新目录>` 重编wrapper见证、
  默认链接、真实Controller源patch/重编/更新库并重链接同应用对象；不依赖旧绝对路径。
- `kernel-modified/spacer.wasm`：真实OCCT源修改产物，用主进程显式opt-in验证，
  成包结果由父任务独立收集。不是把data-section探针冒称源码重建。

固定OCCT源 b8f597c677811d1f9f4d8a97f5ae2825c0353a42及26文件补丁，
SDK6.0.5-git、23供应archive与系统组件原文/对象材料保留。
当前 `STEP-NARROW-SBOM.cdx.json` 对应新资产；旧 `STEP-SBOM.cdx.json`
是原npm历史记录，未被改写。新机器门禁仍INCOMPLETE/BLOCKED，绝无环境豁免。

新链已具本地源码/构建/对象/链接材料，但正式对应源交付机制、修改通知、
传递头文件/生成JS逐项notice与法律审查仍未闭合；产品成包修改核执行需父任务验证。
不得借新链补写旧npm历史来源或以普通打包成功宣称LGPL认证/发布许可。
OCP读回同OCCT家族，默认transfer可能heal，不是异厂商或无修复证明。
