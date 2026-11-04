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

## 本地运行

```bash
npm run build
npm run preview
```

然后在浏览器打开 `npm run preview` 输出的地址（默认 `http://localhost:4173/`）。构建产物不依赖外网，断网后仍可通过这个本地服务打开和刷新。

不支持直接双击 `dist/index.html`：用 `file://` 打开时，浏览器会因安全限制拦下模块脚本，页面会白屏。
