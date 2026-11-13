# 基线宽度清单

基线 a86cf8a。逐条枚举 src/**/*.css 的 (min-/max-)?width: 整数px，包含 media 条件；排除 border-left-width（边框不是布局宽度）。原始行号保留供 git show 对照。

N=36 收进变量；M=16 保留且代码注释；N+M=52。值为1px的辅助技术盒及 media 条件保留，其余尺寸除 W01/W03 按本任务统一侧栏下限为 240px 外，均原值搬入 token，不改变字体/颜色/图标/动效。

| ID | 基线位置 | 原值 | 处理 |
|---|---|---|---|
| W01 | `src/components/AgentSidebar.css:15` | `min-width: 300px` | 变量 `--panel-sidebar-min` = 240px（按任务预算统一侧栏下限） |
| W02 | `src/components/AgentSidebar.css:234` | `max-width: 1000px` | 保留：CSS 原生 media 条件不支持 var()；保留既有断点，避免改变非桌面页面行为。 |
| W03 | `src/components/AgentSidebar.css:237` | `min-width: 280px` | 变量 `--panel-sidebar-min` = 240px（按任务预算统一侧栏下限） |
| W04 | `src/components/AgentSidebar.css:241` | `max-width: 700px` | 保留：CSS 原生 media 条件不支持 var()；保留既有断点，避免改变非桌面页面行为。 |
| W05 | `src/components/DxfViewer.css:106` | `width: 12px` | 变量 `--layout-dxfviewer-106-width` = 12px |
| W06 | `src/components/DxfViewer.css:155` | `min-width: 52px` | 变量 `--layout-dxfviewer-155-min-width` = 52px |
| W07 | `src/components/DxfViewer.css:240` | `width: 1px` | 保留：辅助技术专用 sr-only 1px 盒，不参与可见布局预算。 |
| W08 | `src/components/ExtractionReviewPanel.css:348` | `min-width: 220px` | 变量 `--layout-extractionreviewpanel-348-min-width` = 220px |
| W09 | `src/components/ImportWizard.css:74` | `width: 18px` | 变量 `--layout-importwizard-74-width` = 18px |
| W10 | `src/components/ImportWizard.css:267` | `min-width: 220px` | 变量 `--layout-importwizard-267-min-width` = 220px |
| W11 | `src/components/ImportWizard.css:464` | `max-width: 640px` | 保留：CSS 原生 media 条件不支持 var()；保留既有断点，避免改变非桌面页面行为。 |
| W12 | `src/components/ModelViewport.css:30` | `min-width: 28px` | 变量 `--layout-modelviewport-30-min-width` = 28px |
| W13 | `src/components/RequirementRevisionHistory.css:47` | `min-width: 900px` | 变量 `--layout-requirementrevisionhistory-47-min-width` = 900px |
| W14 | `src/components/RequirementRevisionHistory.css:101` | `max-width: 260px` | 变量 `--layout-requirementrevisionhistory-101-max-width` = 260px |
| W15 | `src/components/RequirementWizard.css:60` | `min-width: 180px` | 变量 `--layout-requirementwizard-60-min-width` = 180px |
| W16 | `src/components/SpacerDrawingPanel.css:193` | `max-width: 1200px` | 保留：CSS 原生 media 条件不支持 var()；保留既有断点，避免改变非桌面页面行为。 |
| W17 | `src/components/ThreeViewport.css:30` | `min-width: 28px` | 变量 `--layout-threeviewport-30-min-width` = 28px |
| W18 | `src/components/ThreeViewport.css:53` | `min-width: 72px` | 变量 `--layout-threeviewport-53-min-width` = 72px |
| W19 | `src/components/ThreeViewport.css:58` | `min-width: 40px` | 变量 `--layout-threeviewport-58-min-width` = 40px |
| W20 | `src/index.css:41` | `min-width: 320px` | 变量 `--layout-index-41-min-width` = 320px |
| W21 | `src/pages/DesktopWorkspace.css:53` | `width: 280px` | 变量 `--layout-desktopworkspace-53-width` = 280px |
| W22 | `src/pages/DesktopWorkspace.css:114` | `width: 112px` | 变量 `--layout-desktopworkspace-114-width` = 112px |
| W23 | `src/pages/DesktopWorkspace.css:130` | `max-width: 600px` | 保留：CSS 原生 media 条件不支持 var()；保留既有断点，避免改变非桌面页面行为。 |
| W24 | `src/pages/DesktopWorkspace.css:208` | `width: 1px` | 保留：辅助技术专用 sr-only 1px 盒，不参与可见布局预算。 |
| W25 | `src/pages/PrintReport.css:3` | `max-width: 1120px` | 变量 `--layout-printreport-3-max-width` = 1120px |
| W26 | `src/pages/PrintReport.css:40` | `max-width: 720px` | 变量 `--layout-printreport-40-max-width` = 720px |
| W27 | `src/pages/PrintReport.css:369` | `min-width: 88px` | 变量 `--layout-printreport-369-min-width` = 88px |
| W28 | `src/pages/PrintReport.css:476` | `max-width: 720px` | 保留：CSS 原生 media 条件不支持 var()；保留既有断点，避免改变非桌面页面行为。 |
| W29 | `src/pages/ProjectList.css:3` | `max-width: 1100px` | 变量 `--layout-projectlist-3-max-width` = 1100px |
| W30 | `src/pages/ProjectList.css:46` | `width: 1px` | 保留：辅助技术专用 sr-only 1px 盒，不参与可见布局预算。 |
| W31 | `src/pages/ProjectList.css:259` | `max-width: 640px` | 保留：CSS 原生 media 条件不支持 var()；保留既有断点，避免改变非桌面页面行为。 |
| W32 | `src/pages/SnapshotList.css:3` | `max-width: 1120px` | 变量 `--layout-snapshotlist-3-max-width` = 1120px |
| W33 | `src/pages/SnapshotList.css:32` | `max-width: 760px` | 变量 `--layout-snapshotlist-32-max-width` = 760px |
| W34 | `src/pages/SnapshotList.css:133` | `max-width: 720px` | 变量 `--layout-snapshotlist-133-max-width` = 720px |
| W35 | `src/pages/Workspace.css:3` | `max-width: 1680px` | 变量 `--layout-workspace-3-max-width` = 1680px |
| W36 | `src/pages/Workspace.css:350` | `min-width: 1040px` | 变量 `--layout-workspace-350-min-width` = 1040px |
| W37 | `src/pages/Workspace.css:387` | `width: 28px` | 变量 `--layout-workspace-387-width` = 28px |
| W38 | `src/pages/Workspace.css:405` | `min-width: 82px` | 变量 `--layout-workspace-405-min-width` = 82px |
| W39 | `src/pages/Workspace.css:412` | `min-width: 82px` | 变量 `--layout-workspace-412-min-width` = 82px |
| W40 | `src/pages/Workspace.css:416` | `max-width: 150px` | 变量 `--layout-workspace-416-max-width` = 150px |
| W41 | `src/pages/Workspace.css:427` | `min-width: 74px` | 变量 `--layout-workspace-427-min-width` = 74px |
| W42 | `src/pages/Workspace.css:438` | `max-width: 170px` | 变量 `--layout-workspace-438-max-width` = 170px |
| W43 | `src/pages/Workspace.css:666` | `max-width: 1180px` | 保留：CSS 原生 media 条件不支持 var()；保留既有断点，避免改变非桌面页面行为。 |
| W44 | `src/pages/Workspace.css:682` | `min-width: 64px` | 变量 `--layout-workspace-682-min-width` = 64px |
| W45 | `src/pages/Workspace.css:686` | `max-width: 132px` | 变量 `--layout-workspace-686-max-width` = 132px |
| W46 | `src/pages/Workspace.css:690` | `max-width: 720px` | 保留：CSS 原生 media 条件不支持 var()；保留既有断点，避免改变非桌面页面行为。 |
| W47 | `src/pages/Workspace.css:726` | `min-width: 820px` | 变量 `--layout-workspace-726-min-width` = 820px |
| W48 | `src/pages/Workspace.css:745` | `max-width: 480px` | 保留：CSS 原生 media 条件不支持 var()；保留既有断点，避免改变非桌面页面行为。 |
| W49 | `src/pages/Workspace.css:800` | `width: 1px` | 保留：辅助技术专用 sr-only 1px 盒，不参与可见布局预算。 |
| W50 | `src/pages/Workspace.css:980` | `width: 74px` | 变量 `--layout-workspace-980-width` = 74px |
| W51 | `src/pages/Workspace.css:1122` | `max-width: 1180px` | 保留：CSS 原生 media 条件不支持 var()；保留既有断点，避免改变非桌面页面行为。 |
| W52 | `src/pages/Workspace.css:1143` | `max-width: 720px` | 保留：CSS 原生 media 条件不支持 var()；保留既有断点，避免改变非桌面页面行为。 |
