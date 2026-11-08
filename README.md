# staff

轴系轴向公差链分析与修改追踪工具（MVP）。产品与验收依据见
[docs/MVP开发文档.md](docs/MVP开发文档.md)。

## 常用命令

```bash
npm install
npm run dev
npm test
npm run lint
npm run typecheck
npm run build
```

## 分析快照与完整备份（V2.2 第二组）

报告已改为由**不可变分析快照**生成，不再读取工作台实时数据。工作台点“创建分析快照”后
进入快照报告；旧 `#/project/<id>/report` 链接会转到快照列表并说明变更。审查未完成也允许
创建，但报告会明确标注待办，不能当作“已完成复核报告”。

项目列表提供 `.cunlian.zip` 完整备份与恢复：

- 包含项目、草稿、来源附件原始字节、版本、绑定、事件与快照；
- **不包含全局映射模板**（manifest 中明示）；
- 导入校验路径穿越、条目数 ≤500、解压后 ≤150 MiB、逐文件 SHA-256 与引用一致性；
- 全部通过才在单个事务写库，失败零写入；恢复只支持空数据库，并清除人工确认。

实现与验收细节见
[docs/V2.2-第二组-快照与完整备份.md](docs/V2.2-第二组-快照与完整备份.md)。

## 本地运行

```bash
npm run build
npm run preview
```

然后在浏览器打开 `npm run preview` 输出的地址（默认 `http://localhost:4173/`）。构建产物不依赖外网，断网后仍可通过这个本地服务打开和刷新。

不支持直接双击 `dist/index.html`：用 `file://` 打开时，浏览器会因安全限制拦下模块脚本，页面会白屏。
