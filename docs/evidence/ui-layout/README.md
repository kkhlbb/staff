# UI布局契约验收证据

分支：agent/ui-layout-contract；基线：a86cf8a。实现及本目录一起提交，最终提交号以交付消息及 `git log -1` 为准。

## A/B/C

- 契约及预算逐值对照：`docs/ui-layout-contract.md`。
- 52处完整清单：`docs/ui-layout-width-inventory.md`。`node scripts/ui-layout-audit.mjs` 逐文件读取基线git对象，逐项核对位置/原值，实际输出：

      WIDTH_AUDIT=PASS baseline=a86cf8a original=52 N=36 M=16 N+M=52

- 原语：`src/components/layout/{Panel,SplitPane,ScrollArea}.tsx`。预算：`budgets.ts`、`tokens.css`。原语+契约单测10条（包括960～1440逐像素预算）。

## D/E 三档及边界取证

    视口        scrollWidth/clientWidth  中央实宽/下限  侧栏    底部
    960×640     960/960                  436/360        280     33，一行折叠
    1280×800    1280/1280                716/560        320     280
    1440×900    1440/1440                836/700        360     320

截图（未裁剪、未注入DOM）：

- `layout-960x640.png`：提交按钮在局部滚动后可见、可命中，工具栏导出不再被任务抽屉遮挡。
- `layout-1280x800.png`
- `layout-1440x900.png`
- 另有1025/1123/1124/1399/1400边界截图，均在本目录。

`layout-result.json`、`logs/09-test-desktop-layout.log`：真实打包Electron，8个视口×6页签测几何，另测真实分割拖动与按钮操作，汇总64条检查记录；8次走真实建立草稿→预览→确认提交并读回revision变化。root无水平溢出、页面无纵向滚动；局部滚动和内容换行允许，不隐藏控件、不缩字体。

补充修正：中档断点不能从1025开始，因为最少需要1124px；现紧凑档延续至1123，中档从1124开始。项目树拖动上限按剩余中央预算收口。底部分割条起值与280/320实际高度同步，实拖±8px核验无初跳。

先前 `prior-bottom-drag-failure.png` 与 `logs/prior-bottom-drag-failure.log` 是增强拖动测试时的失败记录，不是验收通过截图。增强拖动测试时曾有一次320≠328失败；未改产品尺寸，测试改为保持按下直到真实尺寸更新后再释放，不改任何尺寸断言。尚未单独证明那次丢失移动的底层原因。`logs/bottom-drag-debug.log` 是诊断复跑输出。后续恢复和最终门禁均绿。

## F 真实源码变异红绿

    node scripts/ui-layout-mutations.mjs
    M49-package: exit=0
    M49-red: exit=1
    M50-package: exit=0
    M50-red: exit=1
    restored-package: exit=0
    restored-green: exit=0
    M49/M50 killed; restored layout green

- M49：删中央Panel minWidth，断言 `central min-width contract missing: 0 < 360`；默认实宽仍436，诚实区分约束丢失和默认几何收缩。
- M50：属性栏宽改424，真实root溢出 `horizontal overflow at 960: 1028 > 960`。
- `M49.patch` / `M50.patch` 描述准确变异；JSON及两张failure图、对应日志保留；编译失败不计杀死。
- finally还原源码、重新打包，8视口64条检查再次PASS。恢复日志：`logs/restored-green.log`。

## G 六门禁 + build + 打包 + 布局回归

复跑：`node scripts/ui-layout-gates.mjs`。最终实测全部exit=0：

| 命令 | 实际结果 | 日志 |
|---|---|---|
| npm run typecheck | exit0，无诊断 | logs/01-typecheck.log |
| npm run typecheck:desktop | exit0，无诊断 | logs/02-typecheck-desktop.log |
| npm run lint | exit0，无诊断 | logs/03-lint.log |
| npm test | 116文件，1324通过 | logs/04-test.log |
| npm run test:desktop | 44文件通过/2跳过；307通过/17跳过 | logs/05-test-desktop.log |
| npm run test:mcp | 3文件，22通过 | logs/06-test-mcp.log |
| npm run build | exit0，built in 227ms | logs/07-build.log |
| npm run package:desktop | RESULT PASS，asar中pdf worker可加载 | logs/08-package-desktop.log |
| npm run test:desktop:layout | LAYOUT_RESULT=PASS checks=64 | logs/09-test-desktop-layout.log |

相对基线增加10条原语/契约测试和6份JSON证据守卫；桌面17条跳过未记为通过。`gates.json`保存命令退出码和摘要。测试不安装任何依赖，未改锁文件。打包产物为 `out/寸链-darwin-arm64/寸链.app`；最终交付前本地提交后检查 `git status --short` 应无输出。

## 未做/限制

- 明确未做：配色、字体、图标、动效；业务逻辑、IPC、抽取规则、计算判据均未改。
- 本测试验证真实导出菜单按钮可点，不声称重新验证PDF生成、原生保存对话框或真实模型联网调用。未重跑真实语料专项；本卡范围为布局。
- 小于960及跨浏览器未验收；CSS anchor在当前项目Electron打包产物中实测。保留既有Agent抽屉覆盖属性栏的交互。
- 当前仓库无CI配置，仅提供可直接失败退出的自动命令，未擅自部署远端CI。未merge/push/删除分支/发布。
