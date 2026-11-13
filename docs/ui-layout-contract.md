# UI 布局契约（骨架，不做皮肤）

基线：main a86cf8a；实现分支：agent/ui-layout-contract。

## 尺寸预算（CSS px，数值即自动断言值）

| 视口 | 侧栏 | 中央 | 底部 | 塌陷策略 |
|---|---|---|---|---|
| 960×640 | ≤280（默认280） | ≥360 | 折叠为一行（33） | 项目树/属性栏/任务侧栏均保留收起入口；底部默认折叠 |
| 1280×800 | 320 | ≥560 | 280 | 默认展开 |
| 1440×900 | 360 | ≥700 | 320 | 默认展开 |

侧栏预算指右侧属性栏，以及保持原抽屉交互的 Agent 任务侧栏；后者覆盖属性区域而不占第二条布局轨道。左侧项目树沿用 232 默认、180～280 可拖动。分割条各 6。中央实际剩余宽度为 436 / 716 / 836，均不以缩字号/藏按钮/裁切内容达标。

代码逐值对照：

    src/components/layout/budgets.ts: LAYOUT_BUDGETS
    { width: 960, height: 640, sidebar: 280, centerMin: 360, bottom: 33, collapsed: true }
    { width: 1280, height: 800, sidebar: 320, centerMin: 560, bottom: 280, collapsed: false }
    { width: 1440, height: 900, sidebar: 360, centerMin: 700, bottom: 320, collapsed: false }

    src/components/layout/tokens.css
    默认：--panel-sidebar-w: 320px; --panel-center-min: 560px; --panel-bottom-h: 280px;
    max-width: 1123px：--panel-sidebar-w: 280px; --panel-center-min: 360px;
    min-width: 1400px：--panel-sidebar-w: 360px; --panel-center-min: 700px; --panel-bottom-h: 320px;
    --panel-sidebar-min: 240px; --panel-sidebar-max: 400px;
    --panel-bottom-collapsed-h: 33px; --gap: 8px; --layout-splitter: 6px;

33 = 原有按钮最小高度32 + 底部上边框1，不改按钮尺寸。紧凑档手动展开仍有280高局部滚动区，不是33高的空面板。1123/1400 是布局断点，960/1280/1440 是验收视口；中档最少需要232+12+320+560=1124，因此不能在1025就启用中档预算。项目树拖动上限同时受中央预算剩余空间约束（1124时上限232），缩窗会收回超出的拖动宽度。CSS原生media不能读取var，预算映射函数和真实浏览器断言共同锁定对应关系。

## 边界与塌陷

- 中央低于各档 minWidth 即违约，不继续压缩；不得把 minWidth 改成0以静默吞掉压力。超出预算应修布局或让用户用既有收起入口，不可 hidden 裁切。
- 属性栏最小240，可拖动至该档预算上限；项目树180～280。中央轨道 `minmax(auto, 1fr)` 接受 Panel 的最小尺寸约束并吸收剩余空间，不是固定像素中央区。
- 960档底部默认仅一行；跨1123/1400断点重置默认展开态和拖动预算，不触碰工程数据、IPC或业务流程。1280/1440默认展开；长历史表完整留在局部滚动区，不缩行高或删行。
- 工程图参数表单自动按140最小列宽换行，按钮正常换行；所有文字/控件保留原字体尺寸。提交按钮需要时在 ChangeWorkbench 局部滚动后操作；页面自身不滚。
- Agent 抽屉用CSS anchor定位到工作区body顶部，不再用104px覆盖工具栏。保持原任务抽屉交互，不另造业务面板。目标运行环境为项目固定版本 Electron（实际打包回归）。
- 小于960不在本任务验收档位；原600手机覆盖布局保留，不宣称已验收。任意新面板须先有局部滚动边界再接入，不能通过整页横滚解决。

## 容器原语

- `src/components/layout/Panel.tsx`：minWidth / collapsed / overflow:'scroll'|'hidden'。默认scroll映射auto；hidden仅是要求的显式能力，工作区展开面板不使用hidden。
- `src/components/layout/SplitPane.tsx`：grid轨道容器和提取出的 Splitter，真实pointer capture拖动与键盘步进/Home/End；轨道配置在调用方，业务状态不入原语。
- `src/components/layout/ScrollArea.tsx`：min-width/min-height=0和overflow:auto，局部滚动边界；工作区tabpanel已使用。
- 接入：DesktopWorkspace项目树/中央/属性栏/底部使用Panel，body使用SplitPane；AgentSidebar展开抽屉使用Panel。内部业务渲染及处理函数不变。

## 52处处理账

详见 `docs/ui-layout-width-inventory.md` 的 W01～W52，N=36变量化，M=16保留并在代码注释理由，N+M=52。口径是基线 `src/**/*.css` 的 `(min-/max-)?width: 整数px`，包括media条件；不包括border-left-width。新tokens中的声明值不是新增未处理的硬编码width。

## 自动回归与变异

    npm run package:desktop
    npm run test:desktop:layout
    node scripts/ui-layout-mutations.mjs

真实打包应用，独立userData和既有committed.cunlian的临时副本，不使用伪造DOM、伪造IPC响应或静态布局样板。额外覆盖1025/1123/1124/1399/1400五个断点边界视口，并实际拖动项目树；展开档还拖动底部分割条往返8px，核对aria起值和实际高度，防止首次拖动跳变。每档点过六个真实页签，断言root scrollWidth<=clientWidth、页面不竖滚、四个区域boundingBox在视口内、中央实宽和computed minWidth≥预算、侧栏宽/底部高度等于预算。再真实鼠标点击导出菜单；走建立草稿→预览→确认提交，用elementFromPoint验证命中，用reattachSession读回新revision确认提交。截图拍在真实可提交按钮出现时。提交会改变隔离副本，不动证据源文件。

M49：在真实DesktopWorkspace源码删除中央Panel minWidth属性，重新打包后960档失败。断言是computed minWidth=0<360；默认实宽仍436，不谎称默认实宽已变窄。此守卫专门防范删除未来抗挤压约束，不能只量默认剩余宽度。

M50：真实源码将属性栏默认宽度改为424px，重新打包后960档 root scrollWidth=1028>clientWidth=960，确由水平溢出断言杀死。不是编译失败或仅源码字符串检查。finally还原源码并重新打包，三档回归必须再绿。

证据：`docs/evidence/ui-layout/`（截图、layout-result.json、mutations.json、logs/）。新JSON统一serializeEvidence归一；原始日志保留真实输出。当前仓库没有既有CI配置；新增npm命令可直接接入具备macOS GUI会话的CI，本任务不声称已发布或安装远端CI。

## 范围承诺

未做配色、字体、图标、动效；未改业务逻辑、IPC契约、抽取规则、计算精度、判据；未重写业务组件、未改变提交/导出流程。未引入新的overflow:hidden遮挡方案；原有sr-only裁切以及非桌面页面历史样式不扩展治理。
