# 参与 RPE Redux

RPE Redux 是一个面向 Windows 和 Linux 的 RPE 谱面桌面编辑器，由 React、TypeScript、Tauri 和本地 Go/SQLite 服务组成。欢迎在保持产品聚焦和谱面兼容性的前提下提交贡献。

[English](CONTRIBUTING.md)、简体中文

## 开始之前

请先阅读：

- [AGENTS.md](AGENTS.md)：归属、验证和约定。
- [架构说明](docs/architecture.md)：分层、运行时组合和功能归属。
- [开发说明](docs/development.md)：本地流程和命令。
- [测试说明](docs/testing.md)：测试套件、fixture 和测试放置位置。
- 修改谱面序列化或内置资源前阅读[兼容性](docs/compatibility.md)。

## 环境

浏览器开发循环需要 Node.js 22.18+ 和 Go 1.25.3+。桌面开发循环还需要 Windows 10/11 及 WebView2 运行时，或带 WebKitGTK 4.1 的 Linux；Rust stable 与平台 C++ 工具链（Windows 用 MSVC，Linux 用 `build-essential`）。

```powershell
npm ci
npm run dev
```

`npm run dev` 会同时启动 Go 服务和 Vite，为每个工作树保留一组固定端口，并在浏览器中打开支持热更新的编辑器。需要原生宿主能力时运行 `npm run dev:desktop`，它会准备原生依赖并启动 Tauri 窗口。

## 流程

1. 从 `main` 创建聚焦的分支。
2. 在拥有该行为的模块中修改，再通过现有贡献注册表注册功能。
3. 同时在 `src/i18n/` 中补充英文和中文文案。
4. 在行为附近补充或更新测试；[测试说明](docs/testing.md) 说明了改动应落在哪个套件。
5. 提交 PR 前运行源码检查和桌面检查。
6. 发布时在 release notes 中记录用户可见变化。

提交信息使用常见前缀，例如 `feat(editor): add curve handles` 或 `fix(desktop): restore window geometry`。标题使用祈使句，正文只描述契约和验证。

## 验证

在仓库根目录运行：

```powershell
npm run check
npm run verify
npm run build
npm run build -- --debug
npm run smoke
```

`npm run check` 覆盖 TypeScript、ESLint、样式规则、文档链接、图标检查、SDK 类型检查、Extension 方法注册表检查、TypeScript 单元测试和 Go 测试；`npm run verify` 额外检查格式。`npm run build -- --debug` 生成 `npm run smoke` 使用的可执行文件，smoke 套件覆盖 P0 桌面路径。各套件的单独命令见[测试说明](docs/testing.md)。

修改 Rust 时运行 `npm run check:native`；修改 Go 服务或联机房间时运行 `npm run test:server`。

## 代码归属

| 区域                         | 归属                                                    |
| ---------------------------- | ------------------------------------------------------- |
| 谱面规则、时值、序列化、资源 | `src/core/global/chart/`                                |
| 编辑会话、操作、事务         | `src/core/edit/`                                        |
| 文档生命周期与谱面库         | `src/core/global/document/`、`src/core/global/library/` |
| 共享视觉原语与 token         | `src/design/`                                           |
| 可见产品界面                 | `src/frontend/screens/`                                 |
| 宿主桥与平台适配             | `src/core/platform/`、`src/frontend/platform/`          |
| 桌面窗口、文件、更新         | `src-tauri/`                                            |
| 本地 HTTP 服务与 SQLite      | `src/backend/`                                          |
| Extension 作者契约           | `sdk/`、`src/core/api/sdk.ts`                           |

`core/` 保持与宿主无关；`design/` 不导入产品领域类型；`frontend/` 可以直接导入 core 实现模块。谱面规则不导入 React、Tauri、存储或网络。

## 代码与文档

- 每个源文件以简短的英文头注释说明它拥有什么、为什么存在。
- 在声明旁记录导出的函数、类、方法和不明显的约束；签名已经清楚时，一句话即可。
- 注释描述当前契约：用途、参数、返回值和约束。历史决策和未完成问题放在 issue 跟踪器中，不写进源码。
- 用户可见文案统一走 `src/i18n/`；诊断信息保持英文，只在 UI 边界翻译。
- 文档说明一个区域的用途和当前工作方式。英文文档使用普通文件名，中文文档使用 `-zh.md` 后缀。
- 目录或公开契约变化时，更新对应的 README 或归属文档。

## 资源、许可与兼容性

- 保留 `LICENSE`、`NOTICE`、资源 manifest 和兼容性敏感的谱面序列化。
- 新增第三方资源需要兼容的许可，并补充 NOTICE。
- 谱面与 PEZ 往返必须保留未知字段、数组顺序、未改动的 beat 字符串和资源引用。
- 不要提交 `dist/`、`src-tauri/target/` 或 `release/` 下的构建产物。

## Pull request

每个 PR 都以 squash 方式合入：一个 PR 在 `main` 上只产生一个提交，PR 标题就是该提交的标题。仓库已关闭 merge commit 与 rebase merge，所以标题请写成祈使句的 conventional commit 形式，例如 `feat(editor): add curve handles`，契约与验证细节写进正文。

PR 应说明：

- 改变了什么用户可见行为或公开契约？
- 哪个模块拥有这个变化，通过哪个注册表注册？
- 运行了哪些检查？
- 是否影响谱面序列化、资源、许可或兼容性？

保持 diff 聚焦，不要混入无关格式化、生成文件或本地实验。UI 变化请附截图或短录屏。

## 许可

RPE Redux 使用 [PolyForm Noncommercial License 1.0.0](LICENSE) 分发。提交贡献即表示同意以同一许可分发；商业用途需要另行取得版权持有人授权。
