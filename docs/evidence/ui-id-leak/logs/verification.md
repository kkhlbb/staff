# 实际执行结果

| 命令 | 退出码 | 实际输出摘录 | 原始日志 |
|---|---|---|---|
| npm test | 0 | Test Files  119 passed (119); Tests  1342 passed (1342) | 01-test.log |
| npm run test:desktop | 0 | Test Files  44 passed \| 2 skipped (46); Tests  307 passed \| 17 skipped (324) | 02-test-desktop.log |
| npm run typecheck | 0 | 无诊断，退出 0 | 03-typecheck.log |
| npm run typecheck:desktop | 0 | 无诊断，退出 0 | 04-typecheck-desktop.log |
| npm run lint | 0 | 无诊断，退出 0 | 05-lint.log |
| npm run build | 0 | ✓ built in 252ms | 06-build.log |
| npm run package:desktop -- --arch=arm64 | 0 | ❯ Packaging for arm64 on darwin; ✔ Packaging for arm64 on darwin; RESULT PASS 打包产物中的 pdf worker 可被 main.cjs 运行时加载 | 07-package-desktop.log |
| npm run test:mcp | 0 | Test Files  3 passed (3); Tests  22 passed (22) | 08-test-mcp.log |
