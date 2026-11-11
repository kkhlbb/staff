# A40-01 PDF fixture 完整性核查

核查基线：`agent/v40-stage1`，HEAD `60d8750`。核查步骤未修改原 PDF、历史证据或产品代码，未单独提交；无依赖安装。后续工具链与打包证据见父目录 README，新增 seed 容器不改变原 PDF。

## 结论

**仓库现有 `src/document-extraction/__fixtures__/taskbook-TB-2026-1110.pdf` 完整，可直接用于 A40-01，无须创建或替换合成 PDF。**

真实项目本地 `pdfjs-dist 6.5.438` 逐页提取结果：2 页、42223 字节。全部字段通过核查：

- 隔套内径 20.00 mm、外径 32.00 mm、长度 12.00 mm。
- H 52.20，+0.02/-0.02 mm；B1/B2 20.00，+0.01/-0.01 mm；S 12.00，+0.01/-0.01 mm。
- `C = H - B1 - S - B2`，并明确“S 为隔套长度”。
- C 目标区间 `[0.1000,0.3000]` mm，含两端；不是基线计算结果区间。

SHA256：`6b6b02ebbe796168447ec18b698fa12db6a93eb7f5dd1ec5b9a9473879b6f0ff`。

相对地，`/Users/aston/DSH/tmp/v35-indep/generic/taskbook.pdf` **不完整**：缺内径、外径、长度 12.00 和 S 的基本尺寸；它写的是“长度 ±0.01 mm”。该旧样本不可单独承担 A40-01 完整输入。SHA256：`fec9afafcb044d550422bda68841383543aa99e68b8ba208797dd525082145e9`。

## 可重跑核验

从 `/Users/aston/DSH/staff` 执行：

```sh
node docs/evidence/v40-stage1/fixtures/verify-a40-01.mjs --audit
node docs/evidence/v40-stage1/fixtures/verify-a40-01.mjs
```

两条命令均已实际运行成功，退出码 0。第一条生成 `existing-fixtures-audit.txt`，记录两个来源的真实逐页文本、SHA256 与缺项；第二条生成 `verification.txt`，对选定的完整仓库 fixture 作强制断言，缺项立即非零退出。审计模式的 0 代表审计正常完成，不代表旧样本完整。

脚本参考项目 `src/document-extraction/__tests__/helpers/pdfFixture.ts` 的 `getDocument/getPage/getTextContent` 用法，使用既有项目依赖，不调用 OCR，不使用模拟 PDF 文本。匹配允许 PDF 字体映射产生的 `⻓` 字符、词内空格、表格上/下偏差和 ASCII 减号；原始文本在日志中保留，不把这些排版差异误报为资料缺失。

已阅读项目 PDF 生成参考 `scripts/make-taskbook-pdf.cjs`；由于已有完整 fixture，本次不引入多余合成来源及生成脚本。不复制 PDF，测试应直接引用上述仓库 fixture。此核查仅验证真实文本层输入完整性，不冒称已运行候选确认、应用草稿或计算内核工具链。
