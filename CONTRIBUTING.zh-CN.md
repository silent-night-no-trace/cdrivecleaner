# 贡献指南

感谢你关注 `CDriveCleaner`。

## 本地开发基础命令

- 安装依赖：`pnpm install`
- 在干净机器上，先执行一次 `pnpm --filter desktop exec playwright install chromium` 安装 Playwright Chromium
- 桌面端测试：`pnpm test`
- 桌面端构建：`pnpm build`
- UI 端到端验证：`pnpm e2e`
- Rust 工作区测试：`cargo test --workspace`

Windows 便携包构建补充说明：

- `pnpm --filter desktop tauri:build:portable` 依赖 `LLVM_MINGW_BIN` 指向 `llvm-mingw` 的 `bin` 目录，以便补齐运行时 DLL。
- 运行历史 / 导出数据默认写入 `LOCALAPPDATA\\CDriveCleaner`；如果没有设置覆盖环境变量，应用会尽力自动迁移旧目录 `LOCALAPPDATA\\CDriveCleanerGreenfield`。

## 建议协作流程

1. 较大的改动建议先通过 issue 或 discussion 讨论。
2. PR 尽量保持聚焦，方便评审。
3. 提交 PR 前请先运行相关测试。
4. 如果行为、交互或工作流变化，请同步更新文档。

## 当前项目范围说明

- 当前项目重点面向 Windows 清理场景。
- 安全性和可解释性优先于激进自动删除。
- 与全盘扫描树相关的性能回退需要认真对待。

## PR 自检清单

- 本地可以正常构建。
- 相关测试通过。
- 需要时已更新文档。
- 没有误提交本地产物或缓存文件。

## 沟通建议

请在 PR 中尽量明确说明：

- 改了什么
- 为什么改
- 如何验证
