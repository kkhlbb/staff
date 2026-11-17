# 发布源码复验域（2026-11-17）

公开源码不携带 `.git`、stash、私人历史或六份冻结采集的私密原文。它是明确标记的展示派生归档，不冒称逐字节 Git archive。

## 两个校验域，禁止错误回退

- Git 工作树：`.git` 存在（包括损坏、浅克隆缺历史）或 Git 顶层正是项目根时，继续要求六份当前原件及 `git show 9fe22fd:<file>` 与 `legacyCaptures` 固定 SHA 相同。缺历史必须失败，绝不转去认可派生文件。另核全部 manifest 原件对基线 `7e11f5e` 的 SHA。
- 无 Git 源码归档：先验证 `release/source-privacy-manifest.json` 的独立固定 SHA，再对所有列明文件逐项校验发布 hash；不是「存在的文件扫一遍」，缺图、缺报告均失败。即使放在别的 Git 仓库里面，也不误用父仓库历史。该域证明公开材料身份与允许的映射，不宣称读到了私密原件。

固定 manifest SHA：`715f43e743a57c72a65ec928710573be51cae6819f8ea19359578034c37f67f9`，同时固定在 TS 验证器及 Python 归档器。更改 manifest 需要显式审查和更新两处锚，不能让调用者任意传入 hash 或临时关校验。

## 派生边界

992 条目包含已批准文本展示派生、六份冻结 JSON 和历史图片。文本仅替换明确路径内的 home 用户名为 `fixture-user`；每个偏移、长度、原片段 hash、替换值和整文件原/派生 SHA 全部列明。其余字节保持，数值、布尔、null、数组、键、probe 内容和业务 hash 不做泛化。相同字段中的嵌入 JSON 也是逐字节受保护的；不允许重生成一份「差不多」的报告。

一个历史图片沿用此前审查的展示派生双 hash；不宣称像素等价。其余历史图片原样绑定。公开 manifest 不含被替换的用户名/私密文本，原文继续只在原 Git 和旧本地证据留档。运行实现、依赖锁、内核、精度和计算输入不变。

`create-source-privacy-manifest.py` 是维护者从固定 Git 基线和既审图片映射生成候选的工具，不在消费方验收时自动重写基线。`archive-release-source.py` 只接受固定 manifest 和干净已提交树，严格应用每条已审展示编辑；并输出覆盖所有 tracked 文件的 `SOURCE-DERIVATION.json`，无静默漏项。

## 复验

解包正式 `cunlian-v0.4.2-beta-source.tar.gz` 后，在该目录执行：

    npm ci
    npm test
    npm run typecheck
    npm run typecheck:desktop
    npm run lint
    npm run build
    npm run test:desktop
    npm run test:mcp
    npm run test:real-docs

需要项目锁指定的 Node/npm 和依赖安装源或完整缓存；`npm ci` 是实际安装，不用链接旧 node_modules 冒充。最终执行证据与新资产全部另存 `release-042-artifacts/followup-source`。旧的 12 失败记录保持原样；新通过不抹除它。

负例覆盖：篡改真实数值、删字段、缺历史图片、改 manifest、损坏 Git 标识，以及将允许的公开副本放回 Git 原件位置。HOLD 不因测试通过自动解除。
