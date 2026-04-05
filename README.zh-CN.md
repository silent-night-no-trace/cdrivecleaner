# CDriveCleaner

[English](./README.md) | 简体中文

`CDriveCleaner` 是一个面向 Windows 磁盘清理与全盘扫描分析的桌面应用，技术栈为 Rust、Tauri 和 React。

## 为什么做这个项目

很多 Windows 清理工具要么强调速度但缺少解释，要么让用户很难在真正执行前看清楚磁盘占用与可回收内容。

`CDriveCleaner` 希望优先解决的是更安全的工作流：

- 先看清楚
- 再理解哪些内容大、哪些内容可回收
- 用边界明确、可解释的动作去清理
- 在扫描树变大时持续量化和优化性能

## 项目状态

- 当前阶段：重写进行中 / 预发布加固阶段
- 主要目标：Windows 桌面清理工作流
- 当前重点：安全清理、可解释的全盘扫描结果，以及大树场景下的性能优化

当前仓库已经包含可运行的桌面应用、共享 Rust 清理引擎、回归测试工具和压力测试脚本，并正在整理为后续公开开源的形态。

## 预览说明

- 现在最快的体验方式仍然是运行 `pnpm --filter desktop tauri:dev`，或者生成便携版可执行文件 `pnpm --filter desktop tauri:build:portable`。

### 截图

#### Home / 快捷操作

![Home 快捷操作](./docs/assets/screenshots/home-quick-actions.png)

#### Results / 全盘扫描树审查

![Results 全盘扫描树](./docs/assets/screenshots/results-full-scan-tree.png)

#### 预设清理流程

![预设清理流程](./docs/assets/screenshots/prepared-clean-flow.png)

## 安装与体验方式

当前还没有签名后的公开安装包。

目前建议的体验方式：

1. 通过 `pnpm --filter desktop tauri:dev` 直接本地运行
2. 通过 `pnpm --filter desktop tauri:build:portable` 生成便携版可执行文件
3. 如果希望先确认状态，再体验应用，可先运行：

```powershell
pnpm qa:full-regression
```

### 当前前提条件

- Windows 环境
- Rust stable 工具链（当前本地基线：`stable-x86_64-pc-windows-gnullvm`）
- 带 pnpm 的 Node.js 环境
- 目标机器上可用的 WebView2 Runtime
- 生成便携版时：本地需要有 `llvm-mingw` 分发包，并将 `LLVM_MINGW_BIN` 指向其 `bin` 目录（用于补齐 `libunwind.dll` / `libwinpthread-1.dll`）。

### 本地数据目录

- 默认情况下，运行历史、导出文件和计划扫描元数据会写入 `LOCALAPPDATA\\CDriveCleaner`。
- 如果没有设置覆盖用的环境变量，应用会在首次运行时尽力把旧目录 `LOCALAPPDATA\\CDriveCleanerGreenfield` 迁移到新目录。

## 当前已具备的能力

- 面向预设类别的安全清理流程
- 大目录 / 深层目录的全盘扫描树分析
- 结果排序、Top 文件 / Top 路径摘要、树搜索等结果审查能力
- 历史导出与扫描导出流程
- 面向 Windows 的受限计划扫描支持
- 通过 Rust CLI 与辅助脚本提供的验证和压力测试工具

## 功能矩阵

| 模块 | 当前状态 |
| --- | --- |
| 安全类别清理 | 已实现 |
| 全盘扫描树分析 | 已实现 |
| 树搜索 / 排序 / 摘要 | 已实现 |
| 历史与报告导出 | 已实现 |
| 计划扫描支持 | 已实现（受限范围） |
| 大树性能优化 | 持续加固中 |
| CLI 与桌面端能力对齐 | 部分完成 |
| 打包 / 签名自动化 | 持续完善中 |

## 安全模型

- 当前项目优先支持预设类别的清理，而不是无限制的任意删除。
- 大规模扫描树分析的目标是帮助用户先理解，再操作。
- 计划自动化目前刻意保持在受限边界内；无人值守清理仍属于高信任风险区域。
- 性能优化被视为产品能力的一部分，因为大扫描树就是核心使用场景之一。

## 仓库结构

- `apps/desktop/`：Tauri + React 桌面应用
- `apps/desktop/src-tauri/`：桌面端 Rust 桥接层
- `crates/core/`：Rust 清理引擎与全盘扫描逻辑
- `crates/cli/`：CLI 验证与压力工具
- `crates/contracts/`：共享契约与测试夹具
- `docs/`：架构、路线图、PRD 与开源准备文档
- `scripts/`：冒烟测试、基准脚本与构建辅助脚本

## 本地开发命令

```powershell
pnpm install
pnpm --filter desktop exec playwright install chromium
pnpm test
pnpm build
pnpm e2e
pnpm qa:full-regression
cargo test --workspace
```

命令说明：

- `pnpm test`：运行桌面端 Vitest 测试
- `pnpm build`：运行桌面端 TypeScript + Vite 生产构建
- 在干净机器上，首次运行 `pnpm e2e` 前先执行一次 `pnpm --filter desktop exec playwright install chromium`
- `pnpm e2e`：运行桌面端完整 UI 自测
- `pnpm qa:full-regression`：串联 test、build、e2e 与 Rust 全盘扫描压力验证
- Windows GitHub Actions CI 目前会运行 `pnpm test`、`pnpm build`、`pnpm e2e` 和 `cargo test --workspace`；便携包构建仍主要在 release 工作流中验证。

## 验证与基准

- 主要桌面端回归链路：`pnpm qa:full-regression`
- 压力脚本入口：`python scripts/run_full_scan_stress.py`
- 基准输出目录：`output/full-scan-stress/`
- 可通过 label 比较多次运行结果，用于跟踪性能回退

## 当前支持范围

| 项目 | 当前支持情况 |
| --- | --- |
| 操作系统 | 以 Windows 为主 |
| 主要用户界面 | 桌面应用 |
| CLI | 偏验证 / 压测 / 部分功能对齐 |
| 公开发布打包 | 持续完善中 |
| 签名安装包 | 暂未提供 |

## 本地启动桌面应用

```powershell
pnpm --filter desktop tauri:dev
```

如需生成便携版可执行文件：

```powershell
pnpm --filter desktop tauri:build:portable
```

## 文档入口

- [当前状态快照与开源准备说明](./docs/OPEN_SOURCE_READINESS.zh-CN.md#状态快照)
- 当前架构：`docs/CURRENT_ARCHITECTURE.md`
- 实施计划：`docs/IMPLEMENTATION_PLAN.md`
- 下一阶段路线图：`docs/NEXT_PHASE_ROADMAP.md`
- 产品需求：`docs/PRD.md`

## 路线图摘要

- 持续加固大规模全盘扫描树的性能与体验
- 继续缩小 CLI 与桌面端能力差距
- 完善安装包、签名与公开发布流程
- 保持文档与回归工具和实际产品状态同步

## 需要提前了解的边界

- 当前项目主要聚焦 Windows 清理场景。
- 桌面端能力在部分方面领先于 CLI。
- 安装包、签名与公开发布自动化仍在持续加固。
- 针对大规模全盘树的性能优化仍在持续推进。

## 已知限制

- 当前没有公开签名安装包。
- README 已经补入静态截图，但更完整的 GIF / 演示视频仍待补充。
- CLI 能力在部分流程上仍落后于桌面端。
- 公共 CI / 发布自动化目前仍处于基础阶段。

## 协作归属与模板

- CODEOWNERS 脚手架：`.github/CODEOWNERS`
- issue 模板：`.github/ISSUE_TEMPLATE/`
- PR 模板：`.github/pull_request_template.md`

## 常见问题

### 现在已经适合大规模公开发布了吗？

还没有到“广泛公开分发”的最终状态。当前应用已经可运行、测试链也比较完整，但安装包、签名、发布自动化仍在持续加固。

### 当前主要支持哪个平台？

当前重点仍是 Windows 桌面清理场景。

### 为什么同时保留桌面端和 CLI？

桌面端是主要用户产品；CLI 和脚本则承担验证、基准测试和长期自动化支持的角色。

## 贡献与项目规范

- 贡献指南：`CONTRIBUTING.zh-CN.md`
- 行为准则：`CODE_OF_CONDUCT.zh-CN.md`
- 安全说明：`SECURITY.zh-CN.md`
- 许可证：`LICENSE`

如果你打算参与贡献，建议先阅读 `CONTRIBUTING.zh-CN.md`，并在提交 PR 前运行对应验证命令。

GitHub 协作模板已经放在 `.github/ISSUE_TEMPLATE/` 和 `.github/pull_request_template.md`。

## 支持与反馈

- 功能与工作流反馈最好附带可复现步骤。
- 性能问题如果能附带 `scripts/run_full_scan_stress.py` 的结果会更有帮助。
- 安全问题请优先遵循 `SECURITY.zh-CN.md` 中的说明，不建议先公开披露。

## 版本记录

- 项目变更记录：`CHANGELOG.md`
- 版本号与发布策略：`docs/VERSIONING_AND_RELEASE_POLICY.zh-CN.md`

## 近期公开准备重点

1. 持续让 README 与实际产品状态保持同步。
2. 继续加强大规模全盘扫描树的性能与回归覆盖。
3. 继续完善安装包、签名与公开发布流程。
