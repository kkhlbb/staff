A-04c 交付记录

工作树 /Users/aston/DSH/wt/dsh-v3-A
现有分支 agent/dsh-v3-A；起点 2cbbd23。没有创建/改名/合并/推送/删除分支。

实现
  最近项目显示 main 的 rev，缺值明确标 Rev 不可用。
  启动 reattachSession，沿用 main 的会话、快照及 editSeq；编辑序号继续递增。
  尺寸链数值/方向/目标编辑走 workspaceReducer -> draftToChain -> calculateChain -> adapter.edit/stageDraft；非法字符串保留在草稿并逐字段关联错误，不显示旧计算结果。
  有效编辑同步当前 project.dimensionChain/relationRevision；既有冻结历史不变。
  PDF 显式注入 readAttachment，不走 PdfViewer 默认 IndexedDB；可切页、缩放、旋转、跳到绑定版本/页/高亮。只读禁用绑定写入，声明缺失或读取失败明确显示不可用。
  历史报告只读列出 snapshot.analysisSnapshots；展示冻结结果与当时审查状态，不重算、不冒充当前确认。comparison=null/缺字段均显示未冻结。
  375px 默认折叠侧栏；中央容器 min-height:0 防止长内容越过页脚。

真实数据链路与测试替身的界限
  verify-ui.mjs 在真实 Electron/Chromium 内点击页面控件；项目通过真实 open IPC 从 fixture.cunlian 解码，数值编辑经真实 stage IPC；从 reattachSession 读回 seq=1 / nominalQ=523000；整页重载后会话 ID、序号、草稿一致。
  fixture.cunlian 是 make-fixture.mjs 通过现成 codec 生成的真实容器，内含两页有英文标识的合成 PDF（不是客户工程图）、既有示例尺寸链和冻结历史。readAttachment 实际返回 1126 字节，现成 PDF.js 渲染第 2 页并高亮已有来源区域。
  最近索引的真实 listRecent 返回该磁盘 fixture 的 Rev rev-a1；UI Rev 渲染另有单元测试。
  自动化用 main inspector 暂时把 showOpenDialog 返回路径设为 fixture，并在重复跑时让 showMessageBox 返回“不保存”，finally 恢复。没有模拟 IPC 结果，但这不证明操作系统原生对话框按钮点击。
  附件失败/声明缺失、非法字段、冻结值不重算由单元测试覆盖。未宣称实际客户附件或损坏磁盘文件已经验收。
  npm start:desktop 的开发窗口原先打开 http://localhost:5173/（Web 入口）；验证脚本通过 main loadURL 打开同源 index.desktop.html。未修改 main 的入口配置。生产 package:desktop 构建成功，本次未启动生产包做交互验收。

真实执行结果（日志均在本目录）
  npm run typecheck：exit 0
  npm run typecheck:desktop：exit 0（新增 renderer vite/client 类型声明后）
  npm run lint：exit 0
  npm test：57 files / 603 tests passed
  npm run test:desktop：14 files / 112 tests passed
  npm run build：exit 0；有 Vite >500kB chunk 警告，不是零警告
  npm run package:desktop：exit 0，main/preload/renderer 生产构建与 darwin arm64 包生成完成
  node evidence/A-04c/verify-ui.mjs：exit 0，真实浏览器断言见 browser.log
  回退实验：保留新测试，四个既有实现文件临时换回 2cbbd23，A-04c 新增六用例全部失败；finally 恢复实现后定向测试 14 passed。见 rollback-red.log / targeted.log；未切分支、未移动 HEAD。

截图（均为真实 Electron renderer，不含原生对话框）
  chain-1440.png：1440x1000，浏览器缩放100%，修改 H 后当前链、目标与计算结果。
  source-pdf-1440.png：1440x1000，PDF100%/0°，fixture第2页和绑定高亮。
  history-1440.png：1440x1000，冻结历史、非当前确认、comparison未冻结。
  source-pdf-200pct-90deg.png：1440x1000，PDF200%/90°，同一区域定位后可见（超出视口部分可滚动）。
  chain-1280.png：1280x900，浏览器缩放100%。
  chain-375.png / chain-result-375.png：375x812，组成环表局部横滚；向下滚动可读目标与结果，页脚不遮挡。
  source-pdf-375.png / source-location-375.png / history-375.png：375x812，来源工具栏/定位到第2页/只读历史。

未做与契约限制
  reattach DTO 没有 savedSeq，重挂接后正式保存状态显示未知；不猜测 dirty/已保存，文件事务与 dirty gate 仍由 main 决定。需要精确展示须由契约负责人另给字段，本卡未修改契约。
  不开放增删环、关系/来源审查确认、绑定写入或新建冻结快照；按钮禁用并说明。来源导入仍未实现。
  工程图、3D、STL、SVG 和图纸 PDF 出图仍明确占位（B/C批）。没有新增打印能力；未做 A4 打印验收。
  没有修改 src/domain、q 精度、schemaVersion 或存储事务实现；没有全局安装依赖。
