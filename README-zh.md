<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/public/assets/redux/brand/redux-lockup-on-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="src/public/assets/redux/brand/redux-lockup-on-light.png">
    <img src="src/public/assets/redux/brand/redux-lockup-on-light.png" alt="RPE Redux" width="200">
  </picture>
</p>

<h3 align="center">面向 Phigros 自制谱面的现代编辑器</h3>

<p align="center">
  <img alt="平台：Windows 10/11、Linux x64" src="https://img.shields.io/badge/Platform-Windows%2010%2F11%20%7C%20Linux%20x64-4fd0df?style=flat-square">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24c8db?style=flat-square">
  <img alt="React + TypeScript" src="https://img.shields.io/badge/React%20%2B%20TypeScript-087ea4?style=flat-square">
  <img alt="Go 1.25+" src="https://img.shields.io/badge/Go-1.25%2B-00add8?style=flat-square">
  <img alt="许可：PolyForm Noncommercial" src="https://img.shields.io/badge/License-PolyForm%20Noncommercial-8b5cf6?style=flat-square">
</p>

<p align="center">
  <sub><a href="README.md">English</a>、简体中文</sub>
</p>

## 项目简介

RPE Redux 是一款面向 Phigros 自制谱面的编辑器。

项目延续自 [`rpe-next`](https://github.com/kclg-YSJ/rpe-next) 代码库，重建了 React 界面、Tauri 2 桌面宿主和本地 Go/SQLite 服务，适合希望长期维护谱面、重视稳定性与兼容性的谱师。

## 快速开始

1. 从仓库的 Releases 页面下载对应平台的安装包并安装。Windows 提供 x64、x86 和 ARM64 的 NSIS 安装包；Linux 提供 deb、rpm 和 AppImage 包。
2. 打开 RPE Redux，首屏是谱面库。
3. 新建谱面、导入谱面（JSON、PEZ、Phigros 官方格式或 PhiEdit），或在「更多」菜单中从现有 RPE 安装迁移。
4. `Ctrl+S` 把修订保存进谱面库；**文件 → 导出谱面**写出 PEZ 或转换后的谱面文件，侧栏的**渲染谱面**可导出视频或音频。

[快速上手](docs/getting-started.md)（英文）覆盖第一张谱面、工作区布局、保存与导出格式、设置、更新以及数据存放位置。默认按键见[键盘](docs/keyboard.md)。

## 构建

**环境要求：** Windows 10/11 及 WebView2 运行时，或带 WebKitGTK 4.1 的 Linux；Node.js 22.18+、Go 1.25.3+、Rust stable 及平台 C++ 工具链（Windows 用 MSVC，Linux 用 `build-essential`）。Debian/Ubuntu 上可用 `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf` 安装桌面依赖。

```powershell
npm ci
npm run dev           # 浏览器开发循环，支持热更新
npm run dev:desktop   # 原生 Tauri 窗口
npm run build         # Windows 生成 NSIS 安装包；Linux 生成 deb、rpm 和 AppImage
```

`npm run dev` 会同时启动 Go 服务和 Vite，然后在默认浏览器中打开编辑器。它只需要 Node.js 和 Go，不需要 Rust 或平台 WebView，开发数据保存在 `.scratch/dev/`。需要原生文件对话框、窗口行为或打包运行时时使用 `npm run dev:desktop`。`npm run build -- --portable` 只生成便携版。首次桌面构建会准备 FFmpeg、Cloudflared 和 Go sidecar，在缓存不存在时需要联网。

> Windows 提供 x64、x86 和 ARM64 的 NSIS 安装包。Linux 提供 x64 的 deb、rpm 和 AppImage 包。只有 AppImage 能通过应用内更新替换自身；deb 和 rpm 用户通过包管理器升级。

## 开发

`npm run dev` 是浏览器开发循环：同时启动 Go 服务和 Vite，每个工作树使用一组固定端口，源码修改后页面热更新。需要原生宿主能力时使用 `npm run dev:desktop` 打开 Tauri 窗口。先读[开发说明](docs/development.md)（工作流、命令、仓库导览）和[测试说明 ](docs/testing.md)（测试套件、fixture、新测试放哪里）。归属规则、贡献方式和代码约定见 [AGENTS.md](AGENTS.md) 与[贡献指南](CONTRIBUTING-zh.md)。

提交 PR 前请运行：

```powershell
npm run verify
npm run build -- --debug
npm run smoke
```

`npm run verify` 覆盖类型、Lint、样式、文档链接、图标、SDK、单元测试、Go 测试和格式检查。Debug 构建与 smoke 套件负责验证桌面交互。

## 许可与来源

RPE Redux 使用 [PolyForm Noncommercial License 1.0.0](LICENSE) 分发，派生自 [`rpe-next`](https://github.com/kclg-YSJ/rpe-next)，上游版权与资源声明保留在 [NOTICE](NOTICE) 中。

## 文档

[文档索引](docs/README.md)、[快速上手](docs/getting-started.md)、[架构说明](docs/architecture.md)、[开发说明](docs/development.md)、[测试说明](docs/testing.md)、[兼容性](docs/compatibility.md)、[桌面运行时](docs/desktop.md)、[键盘](docs/keyboard.md)、[Extension 平台](docs/extensions-zh.md)
