# Welcome page 左上角“三个点”菜单调查

调查日期：2026-11-14

调查范围：welcome page 左上角的“三个点”按钮、菜单组合、注册/挂载入口、可见文案、样式和测试。

明确排除：没有跟进 RPE 导入模态框及其解析、预览、确认流程；这里只记录菜单项到 `openWelcomeImportDialog` 的调用边界。

## 结论摘要

- 按钮组件是 `src/frontend/screens/welcome/WelcomeMoreMenu.tsx:28-116` 导出的 `WelcomeMoreMenu`，内部使用 `IconButton` 和共享的 `ContextMenuPopup`。
- 它不是通过 `contextMenu.register(...)` 注册的菜单贡献。`moreMenu` 是该文件内的本地 `createContextMenuState`（`WelcomeMoreMenu.tsx:25`），菜单项在点击时组装后直接写入这个 store（`WelcomeMoreMenu.tsx:33-78`）。
- welcome page 的直接挂载链是 `Shell -> WelcomePage -> WelcomeMoreMenu`：`Shell.tsx:15,43-70` 挂载 `WelcomePage`；`WelcomePage.tsx:18-20,95-103` 在 header 的 actions 容器中挂载按钮，顺序为设置、三个点。
- 菜单默认有三类 site-local action：桌面端的“从 RPE 导入…”、桌面端的“打开应用数据文件夹”、以及始终存在的“关于 RPE Redux”。非桌面构建只组装最后一项（`WelcomeMoreMenu.tsx:40-77`）。
- 当前没有命中 `WelcomeMoreMenu`、`.redux-welcome-more`、`workspace.welcome.more` 或 `home-rpe` 的专门测试；现有测试只覆盖共享 context-menu 行为或 welcome/home 的间接 shell/e2e 契约。

## 1. 组件和挂载/注册入口

### 1.1 页面组合

`Shell` 是应用窗口壳，直接导入并渲染 `WelcomePage`：

- `src/frontend/app/Shell.tsx:15`：导入 `WelcomePage`。
- `src/frontend/app/Shell.tsx:43-70`：`Shell` 在 `.shell-content` 中并列挂载 `Workbench` 和 `WelcomePage`；welcome 是否可见由 `editorVisibility.atHome` 决定。

`WelcomePage` 负责 header 的局部组合：

- `src/frontend/screens/welcome/WelcomePage.tsx:18-23`：导入 `WelcomeSettings`、`WelcomeJoin`、`WelcomeMoreMenu`，以及其他 welcome surface。
- `src/frontend/screens/welcome/WelcomePage.tsx:95-103`：渲染 `.redux-welcome-header > .redux-welcome-actions`；先渲染 `<WelcomeSettings />`，再渲染 `<WelcomeMoreMenu />`。

因此，移除左上角菜单的产品入口首先是 `WelcomePage.tsx:101`，而不是某个独立的菜单 registry 条目。

### 1.2 菜单自身的状态和共享弹层

- `src/frontend/screens/welcome/WelcomeMoreMenu.tsx:25`：创建文件私有的 `moreMenu` store。
- `src/frontend/screens/welcome/WelcomeMoreMenu.tsx:28-30`：`WelcomeMoreMenu` 订阅这个 store。
- `src/frontend/screens/welcome/WelcomeMoreMenu.tsx:63-78`：点击后把 owner、坐标、对齐方式和 site-local `actions` 写入 store。
- `src/frontend/screens/welcome/WelcomeMoreMenu.tsx:109-115`：使用共享 `ContextMenuPopup` 和 `ContextMenuRows` 渲染弹层；没有传 `surface`，所以这里不会自动收集 `contextMenu` registry 或 toolbar surface 的贡献，只绘制本菜单传入的 actions。
- `src/frontend/overlays/contextMenu/ContextMenuPopup.tsx:190-214,359-386`：共享弹层使用 `popover="auto"`、`role="menu"`、隐藏的 `aria-labelledby`，并从 store snapshot 渲染内容。
- `src/frontend/overlays/contextMenu/ContextMenuRows.tsx:116-139`：site-local action 被转成 `MenuItem`；点击时先关闭菜单、记录 diagnostic action，再调用 action 的 `run()`。

### 1.3 相关的“注册”入口

这里有三个容易混淆的注册点：

1. **按钮本身不是 registry contribution。** `WelcomeMoreMenu` 由 `WelcomePage` 直接 JSX 挂载；没有找到对应的 `contextMenu.register` 或 `toolbar.register`。
2. **新手引导 anchor 是单独注册的。** `WelcomeMoreMenu.tsx:84` 给按钮绑定 `onboardingAnchorRef("home-rpe")`；`src/frontend/onboarding/anchors.ts:22-36` 负责将节点放入 anchor map；`src/frontend/onboarding/steps.ts:107-114` 在无文档且选择 RPE 流程时把 `home-rpe` 作为引导目标。这是引导定位注册，不是菜单 action 注册。
3. **“打开应用数据文件夹”依赖 toolbar action。** 菜单在 `WelcomeMoreMenu.tsx:50-62` 通过 `toolbar.node("files.openAppData")` 查找并调用 action；该 action 在 `src/frontend/screens/settings/files/fileSettingsActions.ts:12-40` 注册，且由 `src/frontend/chrome/topbar/registerBuiltins.ts:25-45` 的 `registerBuiltins()` 纳入启动注册批次。它是菜单内部的间接依赖，菜单本身仍不是 toolbar 注册项。

“关于”则直接调用设置窗口控制器：`WelcomeMoreMenu.tsx:71-76` 调用 `openSettings("about")`；`src/frontend/screens/settings/settingsWindowController.ts:37-40` 通过 `OPEN_SETTINGS_EVENT` 请求打开指定分类。

## 2. 按钮、菜单行为和可见文案

### 2.1 左上角按钮

`src/frontend/screens/welcome/WelcomeMoreMenu.tsx:81-108` 是按钮 DOM 和交互：

- `icon="more"`：使用主题的省略号图标。
- `label={t("workspace.welcome.more")}`：按钮的可访问名称和默认 tooltip 文案。
- `className="redux-welcome-more"`：产品侧 class；当前没有对应的独立 welcome 样式规则，尺寸由 header 内的通用 `.redux-icon-button` 规则控制。
- `aria-haspopup="menu"`、`aria-expanded={menu !== null}`：反映菜单状态。
- `onClickCapture`、`onPointerDown`：处理 native popover light-dismiss 与再次点击关闭的竞态；`onClick={openMenu}` 负责首次打开。

`IconButton` 会把 label 同时写入 `aria-label` 和（默认开启的）`data-tip-title`，并放入 visually-hidden span：`src/design/components/button/IconButton.tsx:9-18,26-59`。

图标来源：

- `src/design/components/icon/iconAssets.ts:82`：`more` 映射到 `icons/ellipsis.png`。
- `src/assets/themes/light/package.json:168`、`src/assets/themes/dark/package.json:168`：两个内置主题都把 `more` 映射到 `icons/ellipsis.png`。

### 2.2 菜单项

菜单在 `WelcomeMoreMenu.tsx:40-77` 点击时按环境组装：

| 条件 | action id | 文案 key / 当前可见文案 | 图标 | 行为边界 |
| --- | --- | --- | --- | --- |
| 桌面端 | `welcome.import-rpe` | `workspace.welcome.importRpe` / EN `Import from RPE…`；ZH `从 RPE 导入…` | `folder` | `run: openWelcomeImportDialog`（调查到此为止，未跟进导入模态框） |
| 桌面端 | `welcome.open-data-folder` | `settings.field.open-data-folder.label` / EN `Open application data folder`；ZH `打开应用数据文件夹` | `open` | 查找并运行 toolbar action `files.openAppData` |
| 所有环境 | `welcome.about` | `chrome.menu.help.about` / EN `About RPE Redux`；ZH `关于 RPE Redux` | `star` | `openSettings("about")` |

逐项来源：

- `src/frontend/screens/welcome/WelcomeMoreMenu.tsx:42-48`：RPE action。
- `src/frontend/screens/welcome/WelcomeMoreMenu.tsx:50-62`：应用数据文件夹 action。
- `src/frontend/screens/welcome/WelcomeMoreMenu.tsx:68-77`：About action。
- `src/frontend/overlays/contextMenu/ContextMenuRows.tsx:122-137`：这些 action 的 label/icon 如何变成菜单行，以及点击后的关闭和执行顺序。

按钮和弹层的共享/本地文案 key：

- `src/i18n/messages/en/workspace.ts:162-165`：`Settings`、`More`、`More actions`、`Import from RPE…`。
- `src/i18n/messages/zh/workspace.ts:143-146`：`设置`、`更多`、`更多操作`、`从 RPE 导入…`。
- `src/i18n/messages/en/settings.ts:516-518`、`src/i18n/messages/zh/settings.ts:443-444`：应用数据文件夹文案及描述。
- `src/i18n/messages/en/chrome.ts:112-113`、`src/i18n/messages/zh/chrome.ts:97-98`：About 文案及其 hint。

弹层的无障碍名称来自 `label={t("workspace.welcome.moreMenu")}`（`WelcomeMoreMenu.tsx:109-112`），即 EN `More actions` / ZH `更多操作`；它不是按钮上显示的可见文字，而是弹层的隐藏 label。

## 3. 相关样式

### 3.1 Welcome 专属样式

`src/frontend/screens/welcome/welcomePage.less` 中与该控件直接相关的规则：

- `:38-50`：`.redux-welcome-header` 绝对定位在页面左上角，使用 `z-index: var(--z-content-overlay)`、`inset-block-start: calc(var(--space-1-5) + var(--space-1) / 2)`、`inset-inline-start: var(--space-3)`。
- `:52-70`：welcome actions 下的 icon button 使用主题 toolbar cell 作为方形尺寸，清零 padding，并在 hover 时提升 foreground 颜色。
- `:135-140`：`.redux-welcome-actions` 是横向 flex，间距来自 `--theme-toolbar-gap` / `--space-1`。
- `:142-146`：`.redux-welcome-more-menu` 只有 `inline-flex`、`flex: none`、`min-width: 0`，没有自己的颜色、弹层、边框或动画规则。

welcome 和共享菜单的样式 manifest 入口是 `src/frontend/app/appStyles.less:18,40`，分别导入 `welcomePage.less` 和 `contextMenu.less`。按钮基础样式来自 `src/design/components/button/iconButton.less:3-13,41-47`。

### 3.2 共享弹层样式

`src/frontend/overlays/contextMenu/contextMenu.less` 提供 `redux-welcome-more-popup` 所继承的通用 `.redux-menu-popup` 样式：

- `:4-24`：fixed top-layer popup、popover surface/border/shadow、304px 宽度、圆角、入场动画和可见溢出。
- `:38-48`：内部 `.redux-menu-scroll` 的最大高度、纵向滚动和 overscroll containment。
- `:107-124`：菜单入场 keyframe 及 reduced-motion 处理。

结论是：删除菜单时，welcome 侧主要相关样式是 header/actions/more wrapper；真正的 popup 外观属于共享 context-menu 样式，不应误删。

## 4. 测试现状

### 4.1 没有直接的 WelcomeMoreMenu 测试

在 `src/test` 中检索 `WelcomeMoreMenu`、`.redux-welcome-more`、`workspace.welcome.more`、`home-rpe` 和 `更多操作`，没有发现针对该按钮打开/关闭、三项 action、桌面端条件或文案的专门测试。因此，当前没有一个测试会直接锁定“左上角三个点菜单必须存在”。

### 4.2 可关联但不等价的覆盖

- `src/test/api/context-menu/contextMenuRows.test.mjs:1-119`：覆盖共享 row model 的 visibility/enabled 规则，以及 registry row 的选择行为；不挂载 `WelcomeMoreMenu`，也不验证 welcome 的三项 action。
- `src/test/api/context-menu/contextMenuApi.test.mjs:37-243`：覆盖 context-menu registry 的排序、surface 过滤、重复 id、注销和 capability gate；同样不验证这个 welcome-local store。
- `src/test/e2e/experienceJourneys.mjs:448-557`：从 home screen 点击 `.redux-welcome-settings` 并验证设置窗口打开、关闭和重开；没有点击 `.redux-welcome-more`。
- `src/test/e2e/experienceJourneys.mjs:559-562`：上述 experience journeys 都声明 `startsAtHome = true`，所以能间接保证 home surface 可用，但不保证三个点菜单。
- `src/test/e2e/journeySupport.mjs:156-188` 和 `src/test/e2e/runner.mjs:177-186`：验证 home screen 的挂载、可见性、布局和启动等待条件；不验证菜单 DOM 或 action。

如果主任务要移除该菜单，最容易漏掉的测试清理/补充点是：当前并不存在直接回归测试；需要根据最终产品意图决定是否增加“菜单不再挂载”的 e2e/DOM 契约，或同步调整现有 onboarding `home-rpe` 目标（其来源见上文 `anchors.ts` / `steps.ts`）。

## 5. 可能的变更边界（仅供主任务参考）

本调查没有修改产品代码。按依赖关系，主任务若删除整个 welcome 三点菜单，候选检查面是：

1. `src/frontend/screens/welcome/WelcomePage.tsx:20,101`：移除导入和 header 挂载。
2. `src/frontend/screens/welcome/WelcomeMoreMenu.tsx`：若不再有其他调用点，可删除组件及其本地 store；其中的 RPE callback 不应被本笔记视为导入模态框调查结果。
3. `src/frontend/screens/welcome/welcomePage.less:142-146`：确认 `.redux-welcome-more-menu` 是否只服务该组件；header/actions 规则仍被设置按钮使用，不能整体删除。
4. `src/i18n/messages/en/workspace.ts:164-165`、`src/i18n/messages/zh/workspace.ts:144-146`：按最终是否同时移除 RPE 入口来决定清理哪些 key；不要因为删除按钮而未经确认删除其他 welcome/import 文案。
5. `src/frontend/onboarding/steps.ts:107-114`：若 RPE 新手引导不再需要该 anchor，检查 `home-rpe` 目标；这是引导契约，不属于菜单 registry。
6. 共享 `ContextMenuPopup`、`ContextMenuRows`、`contextMenu.less` 和 `files.openAppData` 注册不应因本地菜单删除而整体移除，它们仍有其他消费者。

## 6. 导入模态框与 RPE 导入链

这里的“导入 RPE 模态框”应区分为两个层次：`WelcomeImportDialog` 是入口选择器，`RpeImportReviewDialog` 是扫描安装目录后的内容确认器。前者可以从 welcome 入口移除；后者仍被 RPE/PhiEditer 的导入流程共同使用，不能仅凭“移除左上角三个点”推断为同一对象。

### 6.1 入口选择器 `WelcomeImportDialog`

- `src/frontend/screens/welcome/WelcomePage.tsx:21-22,140-141` 同时挂载 `WelcomeImportDialog` 和 `RpeImportReviewDialog`。
- `src/frontend/screens/welcome/welcomeImportDialog.ts:10-24` 保存一个布尔 open store，并导出 `openWelcomeImportDialog` / `closeWelcomeImportDialog`。
- `src/frontend/screens/welcome/WelcomeImportDialog.tsx:26-104` 是一个 `Modal`，标题为“导入谱面”，按钮分别请求其它谱面、PhiEditer 文件夹和 RPE 文件夹；同时把窗口拖放状态映射为弹窗中的 drop zone。
- `openWelcomeImportDialog` 只有两个产品调用点：`src/frontend/screens/welcome/WelcomeMoreMenu.tsx:23,47` 和 `src/frontend/onboarding/OnboardingHost.tsx:53,312-313`。因此只删除菜单 JSX 会留下首次运行引导打开一个已不存在的弹窗入口。
- 弹窗的 late-bound 请求通过 `externalImportService.ts:12-21`、`peImportService.ts:12-21`、`rpeImportService.ts:12-21` 连接到 `EditorAssembly.ts:651-653` 的 `ProjectHome` 方法；这些连接不是弹窗专属的 RPE 业务实现。

### 6.2 首次运行引导依赖

- `src/frontend/onboarding/state.ts:16-25` 的 `OnboardingLaunch.openImportDialog` 是一个显式启动选项。
- `src/frontend/onboarding/OnboardingHost.tsx:298-315` 在 RPE 选择且该选项为真时调用 `openWelcomeImportDialog()`；`OnboardingHost.tsx:326` 首次选择 RPE 时传入 `openImportDialog: next === "rpe"`。
- `src/frontend/onboarding/steps.ts:107-115` 同时把 RPE 引导目标设为 `home-rpe`，而该 anchor 来自 `WelcomeMoreMenu.tsx:84`。若整个三个点入口被移除，RPE 引导需要改成现有的 `home-import` 或其它仍然存在的目标；否则会出现引导找不到目标，且还会继续尝试打开已删除弹窗的问题。
- 英文和中文 onboarding 文案仍明确要求点击 More 菜单并通过对话框导入：`src/i18n/messages/en/workspace.ts:757-759`、`src/i18n/messages/zh/workspace.ts:684-686`。这不是普通未使用文案，而是要随产品入口决定同步改写或删除的用户可见契约。

### 6.3 移除入口后的现有替代路径

- welcome library 的常规导入按钮仍在 `src/frontend/screens/welcome/library/LibraryActions.tsx:38-52`，调用 `documents.openDocument()`，其桌面路径在 `src/frontend/screens/editor/workspace/document/lifecycle/service.ts:170-183` 直接进入原生图表文件选择器；该路径支持 `.json,.pez,.zip`（`src/frontend/screens/editor/workspace/document/open/chartFiles.ts:25`），不是 `WelcomeImportDialog`。
- 窗口拖放仍由 `src/frontend/platform/desktopLifecycle.ts:127-143` 广播并交给 `EditorAssembly.ts:1183-1205` 的 `home.importPaths`；`projectLibrary.ts:216` 起按分类路由 RPE、PhiEditer、外部谱面、扩展和皮肤。因此删除入口弹窗不会自动删除拖放导入能力。
- RPE 的安装目录 review 由 `src/frontend/screens/welcome/rpeImport.ts:307-324` 调用 `requestRpeImportReview`，再由 `src/frontend/screens/welcome/RpeImportReviewDialog.tsx:24-39,110-133` 展示选择设置和谱面的确认弹窗。PhiEditer 流程也复用同一 review store（`src/frontend/screens/welcome/peImport.ts:37,257-266`）。如果需求只针对 welcome 入口选择器，这些 review 和迁移模块应保留。

### 6.4 对应的文案和样式清理面

- `src/i18n/messages/en/workspace.ts:162-172`、`src/i18n/messages/zh/workspace.ts:143-153` 含按钮/菜单 label、RPE action 和入口弹窗标题、拖放说明、按钮文案；其中 `workspace.welcome.importDialog.pe` 位于 `src/i18n/messages/en/welcomeReview.ts:35` 与 `src/i18n/messages/zh/welcomeReview.ts:33`。
- 入口弹窗专属样式是 `src/frontend/screens/welcome/welcomePage.less:148-191`；删除 `WelcomeImportDialog` 后可评估一并移除，但 `welcomePage.less:135-140` 的 actions 容器仍服务设置按钮，不能连带删除。

## 7. 建议的产品范围判断

按现有调用图，最小且语义一致的解释是：删除 `WelcomeMoreMenu` 整个组件及其三项 site-local action；删除 `WelcomeImportDialog` 入口选择器及首次运行引导对它的直接调用；保留 `RpeImportReviewDialog`、RPE/PhiEditer 迁移服务、拖放路由和常规“导入谱面”文件选择器。若“整个导入 RPE 模态框”实际指连 review confirmation 也要删除，则需要额外定义 RPE/PhiEditer 安装目录扫描后的默认选择策略，因为当前 `rpeImport.ts` 和 `peImport.ts` 都会等待该 review Promise 的答案。
