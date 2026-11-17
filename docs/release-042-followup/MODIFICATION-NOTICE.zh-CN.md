# 修改通知与日期边界（2026-11-17）

## 本轮实际新建内容

**添加日期：2026-11-17（本机本次操作日期）。** 新建本目录下的决策表、FFmpeg 受控替换说明、
本通知及辅助脚本：`ffmpeg-controlled-copy.py`、`verify-ffmpeg-controlled-copy.py`、
`probe-ffmpeg-runtime.mjs`、`inspect-legal-materials.py`、`audit-legal-docs.py`。
这些是本轮新编写的工程文档/见证工具，不是改写 LGPL 库源码；没有替换仓库或旧供给中的 LICENSE。
新增脚本头已标注本次添加日期（只读材料清点工具的日期见本通知）。

替换工具只将既有官方另一配置 dylib 安装到新建测试副本；没有改变候选库内部字节、
没有修改 OCCT/FFmpeg 源或重编任何内核，候选来源/双摘要/单文件变化记录于新证据。
这不是把二进制替换宣称为带日期的用户源修改见证。

## 既有 OCCT 通知不得重写的历史

`../release-042-artifacts/supply/review/source-notice-overlay.patch` 和
`modified-controller-notice-overlay.patch` 原文标注 **2026-11-14** 为通知添加日。
`modified-file-date-review.json` 将历史修改日明示为 `NOT_INFERRED`。
本轮不把它改成 2026-11-17、不把上游文件 Created on/版权年份/归档 mtime 当作本次行为修改日期，
也不自动断言已满足 LGPL §2(b)。26 文件适配和 Controller 演示修改必须分别保留身份。

需要新增真实源修改时，由执行修改的人在对应文件显著位置记录实际日期和范围，例如：

```cpp
// Modified by <实际修改者> on <实际修改日期 YYYY-MM-DD>.
// Change: <可核对的行为或适配说明>; patch: <供给内相对路径>.
```

以上是**未应用模板**，不能把占位符带入正式供给或冒称已有修改事实。
历史日期无法确认的项目继续列为未决；可在独立供给派生副本记录“通知添加日”及
原始/派生 hash，但不得用该日期追认未知历史编辑。要不要以现有材料作出充分性决定，由有权人员处理。

本轮不改 `HOLD`、`BLOCKED`、release gate 或任何资产 hash；不新增禁止自用修改、重链接或调试逆向的条款。
