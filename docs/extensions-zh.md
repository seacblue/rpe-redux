# Extension 平台

Extension 在独立的 iframe 沙箱中运行，用于添加快捷键、工具栏动作、面板、通知和谱面配方。代码无法直接访问宿主 DOM、Tauri IPC 或网络；capability 控制的是宿主暴露给沙箱的消息桥。扩展设置页可从 GitHub 安装包或浏览 JSON 插件市场目录；帮助页可打开生成的扩展开发文档站。English guide: [Extensions](extensions.md)。

先从[最小扩展入门](extensions-quickstart-zh.md)开始，需要其他能力时再查阅本参考。

## 目录

- [包结构](#包结构)
- [Manifest](#manifest)
- [从 GitHub 安装](#从-github-安装)
- [插件市场](#插件市场)
- [Capabilities](#capabilities)
- [方法登记表](#方法登记表)
- [脚本与上下文](#脚本与上下文)
- [脚本参数与快捷键](#脚本参数与快捷键)
- [声明式步骤](#声明式步骤)
- [叠加层与声明式面板](#叠加层与声明式面板)
- [设计 token、侧栏导航与 JSON 存储](#设计-token侧栏导航与-json-存储)
- [事务](#事务)
- [信任](#信任)
- [预览几何](#预览几何)
- [布局锚点](#布局锚点)
- [SDK](#sdk)

## 包结构

```text
<extension>/
  manifest.json
  index.js
  i18n.json
```

带 `entry` 的包是可执行代码；没有 `entry` 的 manifest 是 data-only 包。内置包位于 `src/assets/extensions/`，外部包从配置的资源目录发现。包内路径保持相对路径。一个包可以注册任意数量的脚本，代码包和数据型包都一样。从 GitHub 或插件市场安装的包写入 `user-data/extensions/`，来源显示为 `installed`；移除时会删除该目录。

## Manifest

`manifest.json` 声明 `id`、`version`、可选的 `kind`、`name`、`author`、`license`、可选的来源 URL、`engines`、`entry`、`i18n` 和 `capabilities`。`kind` 的 `"extension"` 与已弃用的 `"mod"` 别名对两种包形态都有效；`"data-only"` 要求声明 `scripts` 且没有 `entry`，`"script"` 要求有 `entry`。声明未知 `kind` 返回 `invalidKind`，与实际包形态不一致返回 `kindMismatch`。数据型包不写 `entry`，改为声明 `scripts` 数组；每项有包内唯一的 `id`、可选的标签/描述、可选参数 schema 和 steps。宿主会校验字段形状、宿主版本声明和 provenance，并拒绝无效声明。旧 data-only manifest 如果漏写 `scripts` capability 仍可加载：宿主会补上隐式授权并写弃用警告，因为运行时本来就在启用时要求它。

`engines["rpe-redux"]` 可以使用旧版整数主版本，也可以使用针对完整宿主版本的semver 范围。范围支持精确/部分版本、`x`/`*` 通配符、`^`、`~`、比较运算符、连字符范围、空格 AND 和 `||` OR：

```json
{ "engines": { "rpe-redux": ">=1.0.0-a1 <2.0.0" } }
```

注册前会检查范围。格式错误的范围返回 `invalidHostVersionRange`；格式正确但当前宿主不满足时返回 `incompatibleHostVersion`，并同时给出声明范围和运行版本。

## 从 GitHub 安装

扩展设置页接受仓库链接、raw 链接或 `owner/repo` 简写。`/tree/<ref>/<path>` 链接用于选择 monorepo 中的单个包。仓库链接会使用默认分支解析；如果找到多个 manifest，会返回 `manifestMultiple` 并列出候选路径。

检查链接时只下载 `manifest.json`、声明的 `entry` 以及声明或约定的 `i18n.json`。审阅对话框会显示包名、作者、描述、版本、宿主版本范围、能力、来源提交和文件列表。确认后，宿主把完全相同的字节写入 `user-data/extensions/<id>`，并在不重启的情况下启用。安装失败会返回稳定错误码和失败阶段（`input`、`marketplace`、`resolve`、`download`、`validate`、`persist`、 `load` 或 `enable`），同时显示请求 URL、HTTP 状态、技术细节、底层原因和恢复建议。检查和安装只在桌面应用中可用，浏览器预览无法读取仓库或写入托管目录。

## 插件市场

在 **扩展 → 插件市场目录 URL** 填入 raw HTTPS JSON 文档地址。页面打开时会读取目录并列出扩展包；安装条目会打开与粘贴链接相同的 GitHub 审阅对话框。目录只是数据，不能执行代码；兼容性和能力仍由 manifest 决定。

```json
{
  "schemaVersion": 1,
  "name": "Example marketplace",
  "updatedAt": "2026-11-02",
  "extensions": [
    {
      "id": "example.distribute",
      "name": "Distribute",
      "author": "Example author",
      "description": "Distribute selected notes across lines.",
      "source": "https://github.com/owner/repo/tree/main/extensions/distribute",
      "version": "1.2.0",
      "ref": "main",
      "path": "extensions/distribute",
      "homepage": "https://example.com/distribute",
      "license": "MIT",
      "tags": ["notes", "distribution"]
    }
  ]
}
```

`source`（或 `repository`/`repo`）是 GitHub 链接或 `owner/repo`；`ref` 和 `path` 可以覆盖其中的选择。`id`、`name`、`description` 必填，id 必须唯一，最多 500 条。无效目录会返回 `marketplaceInvalid`、`marketplaceSchema` 或 `marketplaceEntry`，并指出出错的 JSON 路径。

## Capabilities

Capability 控制谱面读写、工具栏/面板/侧栏 UI、舞台或窗口叠加层（`ui.overlay`）、播放、预览/布局读取、选择、文档与谱面库访问、设置、values、只读事件、服务、样式、计时器、诊断和通知。每个 handle 提供 `availability()`；调用方检查它，而不是从版本号推断能力。缺少能力时返回 unavailable 结果。

| 区域 | Capabilities |
| --- | --- |
| 脚本 | `scripts` |
| 谱面 | `chart.read`, `chart.write` |
| 选择 | `selection.read`, `selection.write` |
| 文档 | `document.read`, `document.write` |
| 谱面库 | `library.read`, `library.write`, `assets.write` |
| 播放 | `playback.read`, `playback.control` |
| UI | `ui.notice`, `ui.dialog`, `ui.panel`, `ui.sidebar`, `ui.overlay`, `ui.toolbar`, `ui.contextMenu` |
| 宿主服务 | `shortcuts`, `shortcuts.read`, `settings`, `hooks`, `values`, `storage`, `events`, `services`, `styles`, `timers`, `diagnostics` |
| 预览与布局 | `preview.read` |
| 宿主专用 gate | `host.patch`（已弃用；不授予任何能力） |

词汇表共 32 项，其中 31 项可授予。`capabilityCatalog.ts` 的 consent 目录覆盖全部 32 项；`CAPABILITY_CONSENT_ROWS` 不包含 `host.patch`，因为它不会进入安装对话框。

Capability 检查作用在 iframe 与宿主之间的每次桥接调用上。iframe 使用不透明源，其文档策略禁止网络、Worker、子框架和顶层导航，因此无法访问宿主 DOM、Tauri IPC 或 `window.redux`。受限的 `values` 只能写入本包声明过的值（以及同时持有 `shortcuts` capability 时的快捷键绑定）。工具栏只暴露本包注册的动作；没有可按 id 调用的宿主命令分发器。

### 能力与载荷规则

- `values.byId.snapshot()` 与 `subscribeAll()` 按 owner 过滤：只返回/通知本包声明的值。按 id 的 `get`/`subscribe` 仍可读已知值，但写入宿主值或其他包的值会以 `capabilityDenied` 拒绝。枚举注册表不能用来发现宿主或同级的私有状态。
- `events` 只保证事件事实。可订阅的事件名来自固定 allowlist： `extension:callback-error`、`document:opened`、`document:created`、 `document:restored`、`document:saved`、`document:closed`、 `selection:after-paste`。其他名称会在注册订阅前以稳定错误码 `eventNotAllowed` 拒绝；新增宿主事件必须显式加入 `EXTENSION_EVENT_NAMES` 并同步文档，否则不会暴露给包。`document:*` 载荷在未声明 `chart.read` 时携带 `chart: null`。`selection:after-paste` 在未声明 `selection.read` 时省略 request 和选择引用，未声明 `chart.read` 时省略谱面指纹。
- `ui.contextMenu` 与 `ui.toolbar` 的 action runner 收到投影后的 `ContextMenuTarget`：`noteIds` 和事件 `refs` 需要 `selection.read`； `beat`、`chartSeconds` 和 notes target 的 `lineIndex` 需要 `chart.read`。两者都没有时仍保留 `surface`，动作可以继续运行。
- `ui.toolbar.bindings(action)` 与 `shortcutText(action)` 只回答本包拥有的 id。宿主 id 还需要 `shortcuts.read`；其他包的 `extension.<owner>.*` id 永远不可读。
- 脚本的 `defaultShortcuts` 需要 `shortcuts` capability。未声明时绑定会被忽略，宿主写入 warning，而不是静默注册全局快捷键。
- `host.patch` 是保留给已安装 manifest 的弃用宿主 gate 名；宿主在物化 manifest 时会移除它，因此它不暴露 handle，也不授予任何功能。
- `shortcuts.read` 是增量能力，只供工具栏快捷键 helper 使用；它本身不会授予 `api.shortcuts`。

这些规则只收紧载荷和枚举面；现有注册、菜单行、工具栏动作与 UI 渲染行为保持不变。宿主在 `src/core/extensions/extensionApi.ts` 维护按 owner 的能力使用账本 `extensionCapabilityUsage()`，仅供测试和审计使用，不属于包 API。

## 方法登记表

`context.api` 可达的每个方法都登记在 `src/core/extensions/methodRegistry.ts`，包含授予它的 capability、consent 风险档位，以及它是否写入宿主状态。沙箱把 `api.call` 路径解析为 facade handle 和方法名，调用前先查这张表。未登记的路径会以稳定错误码 `methodNotRegistered` 和点分路径拒绝；它独立于 `capabilityDenied`，因此宿主漏登记不会被计入包的failure budget。`ui.notice`、`events.on` 等 `context.*` 方法不经过这条路径，仍由各自的 runner 检查 capability。

`npm run check:extensions`（也包含在 `npm run check` 中）校验登记表的 handle 集合与 `capabilityGate.ts` 允许的 handle 完全一致；consent 目录也从同一张表读取方法示例。

## 设置与值

`settings.registerSetting` 和 `settings.registerNavigation` 接受包内本地 key。owner 注册会存为 `extension.<owner>.<key>`；已在该命名空间内的 key 原样接受，其他 `extension.*`/`mod.*` key 会被拒绝，包不能占用宿主或其他包的设置。包应通过 `settings.registerNavigation` 注册自己的设置导航页，也可以让设置行显式指向已注册的宿主页（例如 `help`）；裸导航引用在包页存在时解析到包页。

包可见的 `values.define` 只接受 `{ id, initial }`，值始终写入 `values` 偏好区； `persist`、`storageKey` 和 `legacyStorageKey` 会被忽略。因此包不能选择偏好区、采纳宿主值，也不能迁移或删除宿主持久偏好键；包配置请使用 `context.storage` 或设置行。

`values.byId` 和 `values.getHandle` 既接受 owner 限定 id，也接受本地 id。本地 id 在对应值已注册时解析为 `extension.<owner>.<id>`，否则保留原 id：读取已发布的宿主值仍然可用，但写入宿主或其他包的值仍返回 `capabilityDenied`。`byId.snapshot` 和 `byId.subscribeAll` 保持 owner 过滤。

## 工具栏条目

工具栏注册是结构化描述。`kind` 必须是 `action`、`control`、`field`、`divider` 或 `spacer`；`field` 必须有非空 `value` id，`control` 必须使用宿主渲染的 `controlId` （`playback`、`audition`、`extensions` 或 `noiseRendering`）。畸形条目在进入注册表前以 `invalid_request` 拒绝，不能拖垮工具栏渲染或挤掉其他贡献。

## 脚本与上下文

代码包通过入口里的 `context.scripts.register` 注册任意数量的脚本。脚本收到声明过的异步 handle 上下文：`api.chart`、`api.document`、`api.selection`、 `api.playback`、`api.settings`、`api.preview`、 `api.layout` 以及 Extension UI helper。所有桥接调用都返回 Promise。包级 `events` 订阅和公开 `hooks` 位于 context 上；沙箱不提供宿主 DOM `listeners`。上下文不会暴露编辑器 session、timeline、canvas 或 React state。

声明 `hooks` capability 的扩展可以发布和调用带命名空间的 Hook。每个 Hook 都要发布字段 schema，宿主会在调用前以及每个处理器返回后检查必填字段和基础类型。Hook 名称必须使用提供者扩展 id 作为命名空间；处理器先按 priority 从高到低执行，同优先级按注册顺序执行。处理器返回的 JSON 对象会浅合并到载荷，返回 `{ cancel: true }` 会停止后续处理并设置 `result.cancelled`。未知名称、非法载荷、取消、超时和处理器错误都会返回稳定的 `PublicHookError` code；扩展禁用或卸载时，注册会随激活生命周期自动移除。

### Provider 数据与 epoch

当扩展之间共享的是一个计算结果时，使用 `provideData`：提供者拥有快照，每次更新都会推进 epoch。

```ts
const stop = context.services.provideData({
  id: "example.summary",
  version: "1.0.0",
  initial: { count: 0 },
});

await context.services.updateData("example.summary", { count: 1 });
```

消费者读取快照并订阅变化：

```ts
const current = await context.services.readData<{ count: number }>("example.summary", "1.0.0");
const off = context.services.onDataChange("example.summary", (next) => {
  if (!next) return; // 提供者暂时不可用。
  console.log(next.epoch, next.value.count);
});
```

首个快照的 epoch 为 `0`，每次更新都会加一。提供者被替换、禁用、卸载或重载时，epoch 会继续推进，订阅者在新的兼容提供者出现前收到 `null`。消费者应在计算开始时记录 epoch；如果结果返回时 epoch 已变化，就丢弃旧结果并重新计算。值会经过 JSON 克隆，并遵守消息桥的深度、节点数和字节上限。

`document.save` 一律走宿主保存流程。capability gate 会丢弃扩展传入的 `path`，包不能在自己选择的目录创建或覆盖文件；宿主会保存到库或它自己的当前/原生目标。P0 不提供扩展“导出到指定路径”的操作；开发、自动化和 smoke 通过 `window.redux` 或内部 document API 时仍可显式指定目标。

## 脚本参数与快捷键

脚本可以声明参数 schema 和默认快捷键。共享参数对话框会在带参数的脚本运行前渲染 schema；注册默认快捷键需要 `shortcuts` capability，未声明时脚本仍可运行，但默认绑定会被忽略并写宿主 warning。快捷键以包的命名空间 id 注册，并携带直接的 `run` 回调。脚本面板和快捷键编辑器是列出它们的界面，不需要单独的命令目录。

`judgeLine` 参数向脚本传递判定线整数索引；`count` 大于 1 或声明 `multiple` 时传递有序数组。`count` 固定脚本需要的判定线数量；没有 `count` 的 `multiple` 接受任意长度的精确列表。数量已知时，每个字段都有自己的精确、范围、全局开关：精确保留写出的判定线与顺序，范围从候选线中随机抽取所需数量，全局忽略写出的线并从谱面所有判定线中抽取；不限数量的列表只提供精确模式。列表沿用工具栏的紧凑写法（`1,3:5`）。“分配空闲判定线”操作优先复用没有音符、事件、父子线关系的判定线，只有所有候选都被占用时才追加一条脚本线，并把该线加入列表字段。对话框创建但最终取消的脚本线会被移除；之后的对话框会在它仍为空时继续复用它。

## 声明式步骤

数据型包和脚本定义可以使用以下步骤操作：

| 操作          | 契约                                                 |
| ------------- | ---------------------------------------------------- |
| `batch`       | 按声明的参数对 `notes` 或 `events` 执行 multi-edit。 |
| `transaction` | 通过事务所有者应用一个 `ChartTransactionRequest`。   |
| `select`      | 从前面的步骤中选择 `original` 或 `changed` 对象。    |
| `notice`      | 发出一条本地化通知。                                 |

步骤值可以是字面量、校验过的参数引用（`{ "parameter": "name" }` 或 `{ "expression": "..." }`）、数组或记录。没有任意代码步骤。

## 叠加层与声明式面板

`ui.registerOverlay` 会在编辑画布之上、外壳通知之下挂载一个元素。叠加层默认只有舞台大小；传入 `scope: "window"` 后会覆盖整个应用窗口，因此也可以把内容放到工具栏或检查器上。窗口叠加层位于模态遮罩之下。宿主层默认不接收指针事件；需要交互时在声明树的样式中设置 `pointer-events: auto`。`registerPanel` 使用同样的声明树；交互节点带稳定 id，通过消息桥上报点击和输入。节点不会拿到宿主 DOM、React 组件或文件句柄，全部由宿主渲染。内置 `builtin.preview-pet` 使用这些接口：它在预览或整个窗口上绘制实时宠物，并把图片保存在扩展设置中，侧栏面板可以调整图片、大小和阴影。请在 **设置 → 扩展** 中启用它。

扩展 UI 只拥有自己的面板、叠加层、侧栏路由和工具栏条目。它不能替换宿主标题栏、应用菜单、工具栏框架、检查器框架、窗口按钮或窗口布局；这些是宿主拥有的表现契约。需要完整窗口皮肤时，扩展应附带一个纯数据主题包，由用户在外观设置中单独安装并确认自定义 UI。 `styles` capability 只作用于扩展自己的面板与叠加层挂载点；选择器无法触达宿主 chrome。样式表会按挂载点上的 owner 属性包进 `@scope`，因此 `.redux-titlebar` 这类规则在包外匹配不到任何元素。文档级 at-rule（`@keyframes`、`@font-face`、`@property`、 `@counter-style`、`@page`）会被拒绝，因为它们的名字不受挂载点作用域限制； `@import`、`@namespace` 和嵌套 `@scope` 同样被拒绝。

```js
const marker = ui.registerOverlay({
  id: "marker",
  tree: {
    kind: "element",
    tag: "div",
    style: { position: "absolute", width: "8px", height: "8px", background: "red" },
  },
});
// marker.update(nextTree) 替换声明树；marker.dispose() 移除它。
```

## 设计 token、侧栏导航与 JSON 存储

这三组接口构成扩展的设计套件（Design Kit）：扩展读取当前设计系统，并在菜单、工具栏动作和面板里复用宿主的导航与存储路径。

### `api.theme.tokens()` 与 `api.theme.subscribe(listener)`

读取宿主当前应用的设计 token，并在主题或密度变化时收到回调。

```ts
api.theme.tokens(): Promise<ExtensionThemeTokens>;
api.theme.subscribe(listener: () => void): Promise<void>;
```

```js
// 读取一次活动主题 token，再用它构建声明树。
const tokens = await api.theme.tokens();
const card = context.ui.registerPanel({
  id: "theme-card",
  tree: {
    kind: "element",
    tag: "div",
    style: {
      color: tokens.colors.foreground,
      background: tokens.colors.panel,
      border: `1px solid ${tokens.colors.border}`,
      borderRadius: tokens.radii.control,
      padding: tokens.spacing["3"],
      fontFamily: tokens.fonts.family,
    },
    text: `${tokens.theme.name}，${tokens.theme.appearance}`,
  },
});

// 主题变化后重新读取 token，并重绘一次。
context.api.theme.subscribe(() => {
  void context.api.theme.tokens().then((next) => {
    card.update({
      kind: "element",
      tag: "div",
      style: { color: next.colors.foreground, padding: next.spacing["2"] },
      text: `${next.theme.name}，${next.theme.appearance}`,
    });
  });
});
```

快照包含 `theme`（`id`、`name`、`appearance`）、语义颜色 `colors` （`foreground`、`background`、`panel`、`border`、`accent`、`danger`、`warning`、 `success`、`muted`）、`radii`、`spacing`、`fonts`（`family`、`monoFamily`、`sizes`）、 `shadows` 和 `motion`（`durations`、`easings`）。每个叶子值都是从文档实际应用 token 读出的字符串。扩展自己的声明树和样式使用这些字段即可跟随活动主题。

**权限与上限：** 需要 `styles`，与 `context.styles` 共用同一个 capability。主题监听器与事件订阅共用 128 条预算，并随激活一起释放；`subscribe` 没有取消 hook。监听器抛错会计入包的 failure budget，但不会中断其他监听器。

**失败行为：** 未声明 `styles` 时访问 `api.theme` 会抛 `capabilityDenied`；宿主 token 表面不可用时 `tokens()` 会 reject。没有单独的主题错误码。

**相关接口：** `context.styles.add`、声明式面板/浮层树、`ui.registerPanel` / `ui.registerOverlay`。

### `api.sidebar.open(id)` 与 `api.sidebar.close(id)`

打开或关闭本包拥有的一个侧栏路由。

```ts
api.sidebar.open(id: string): Promise<boolean>;
api.sidebar.close(id: string): Promise<boolean>;
```

```js
// 路由此前已经注册：
// context.ui.registerSidebar({ id: "inspector", panelId: "panel", icon: {...} });
const opened = await api.sidebar.open("inspector");
if (!opened) {
  context.ui.notice({ key: "notice.sidebarMissing" }, { level: "warning" });
}

// 当前是其他面板时，close 不会关闭任何东西。
const closed = await api.sidebar.close("inspector");
```

包内本地 id 会解析到本包的 `api.sidebar` 注册或 `context.ui.registerSidebar` 路由。两个方法在 id 不存在或指向分隔线时返回 `false`。`open` 走路由正常的激活路径；`close` 只在该路由对应的面板正是当前检查器面板时请求关闭。

**权限与上限：** 需要 `ui.sidebar`，并带 owner 校验。其他包注册的 id 或宿主条目会以 `capabilityDenied` 拒绝；打开或关闭其他路由不会改变那些路由的状态。

**失败行为：** 其他 owner 的 id 抛 `capabilityDenied`；未知 id 或非 item 条目返回 `false`。

**相关接口：** `api.sidebar.register`、`context.ui.registerSidebar`、 `api.contextMenu` 与 `api.toolbar` 的 action runner。

### `context.storage.getJSON(key)` 与 `context.storage.setJSON(key, value)`

禁用或卸载运行时记录会保留存储；卸载扩展包会清除该扩展的存储。

通过本包 owner 限定的存储条目保存和读取纯 JSON。

```ts
context.storage.getJSON<T = unknown>(key: string): Promise<T | null>;
context.storage.setJSON(key: string, value: unknown): Promise<void>;
```

```js
// 键不存在或文本无法解析时返回 null，默认值仍然可用。
const previous = (await context.storage.getJSON("recent-opens")) ?? [];
await context.storage.setJSON(
  "recent-opens",
  [Date.now(), ...(Array.isArray(previous) ? previous : [])].slice(0, 10),
);

const history = await context.storage.getJSON("recent-opens");
console.log(history);
```

`setJSON` 接受对象、数组、字符串、有限数字、布尔值和 null，序列化一次后写入 `context.storage.set` 使用的同一个 owner 限定字符串条目；`getJSON` 再把它解析回来。

**权限与上限：** 需要 `storage`；key 长度为 1-128 字符，编码后的值上限为 256,000 字节。key 按包隔离，无法访问其他包的条目。

**失败行为：** `getJSON` 在键不存在、JSON 损坏或条目超过大小上限时返回 `null`。 `setJSON` 收到非 JSON 值时抛 `storageValueNotJson`；编码后超过 256,000 字节时抛 `storageValueTooLarge`。两种失败都不会改动原有条目。

**相关接口：** `context.storage.get`、`set`、`delete`、`clear`。

## 版本化设计组件

沙箱通过 `context.ui` 暴露宿主拥有的设计组件目录。目录列出可用 slot 和版本化原语；第一版提供 `text`、`button`、`stack`，可放入 `inspector.panel` 与 `editor.drawer`。

```ts
const catalog = await context.ui.designCatalog();
const dispose = context.ui.registerDesignPanel({
  id: "summary",
  slot: "inspector.panel",
  component: {
    type: "button",
    version: 1,
    props: { id: "refresh", label: "Refresh", variant: "solid" },
  },
  onEvent(event) {
    if (event.nodeId === "refresh" && event.kind === "click") {
      // 更新扩展自己的状态。
    }
  },
});
```

宿主在渲染前检查 slot、组件版本、封闭 props schema、树深度、子节点数和总节点数。组件最终使用宿主设计原语；扩展不能通过此契约传入 React、DOM、CSS、URL 或产品领域对象。返回的 disposer 会移除注册，扩展禁用或卸载时也会自动清理。

提供者/消费者、公开 Hook 和设计 slot 的完整组合示例见 [`sdk/examples/composition.ts`](../sdk/examples/composition.ts)，该文件会使用发布的 SDK 类型进行检查。

## 谱面操作

谱面写入是一个原子 `transaction` 请求，需要 `chart.write`。先用 `api.chart` 或 `api.selection` 读取，再组装请求并调用 `api.transaction.preview` 或 `api.transaction.apply`。不要直接修改读取快照；用快照里的 id 和值组装事务。

```js
const lines = await api.chart.lines();
if (lines.ok && lines.value.length > 0) {
  const result = await api.transaction.apply({
    label: "添加 Tap",
    notes: {
      insert: [
        {
          lineIndex: 0,
          note: { type: 1, startTime: [0, 0, 1], endTime: [0, 0, 1], positionX: 0, above: 1 },
        },
      ],
    },
  });
  if (result.ok && result.value.status === "committed") {
    ui.notice("Tap 已插入。", { level: "success" });
  }
}
```

请求可以更新谱面 `metadata`、通过 `timing.bpmList` 替换速度表、插入或更新判定线，以及按 id 插入、更新或删除音符和事件。音符和事件时间是约分后的拍三元组，不是秒。`lines` 没有删除操作。

`preview(request)` 先做 dry-run 校验，只有状态为 `previewed` 时才返回 preview id；把 id 传给 `apply(previewId)`，或用 `cancel(previewId)` 丢弃。`apply` 的状态是 `committed`、`unchanged`、`rejected`、`conflict` 或 `unavailable`，`value` 里包含 issues、受影响对象 id 和撤销历史。分页 `chart.read` 用旧游标时返回 `stale_read`；提交前谱面变化时 `apply` 返回 `conflict`。这时应重新读取并重建请求，不要盲目重试。

公开的[谱面操作](../docs-sdk/zh/place-note.md)指南包含完整插件、选中音符更新、事件和结果处理。

## 信任

`author`、`license` 和来源 URL 只是元数据。信任由宿主根据包的字节和绑定到当前指纹的用户确认计算。包内容变化后会变成 pending 或 blocked，直到再次确认。

内置来源的规则更窄：只有 `id`、版本、manifest、翻译和入口字节都与随构建打包的包规范化摘要一致时，才会被标记为内置。可写的 resource / portable 目录不能占用 `builtin.*` 标识，portable 包也不能覆盖随应用安装的包。内置入口先注册延迟加载器，只有在启用后才会执行；两个纯脚本内置包仅首次启动时自动启用，用户显式关闭后不会因更新重新打开。

沙箱不提供可改写宿主输入的同步 `hooks`。需要修改谱面的扩展必须通过显式事务或公开 API 完成；只读事件通过 `context.events` 订阅。脚本默认快捷键使用 `extension.<owner>.script.<local>`（旧的 `mod.<owner>.script.*` 绑定会在首次加载时迁移）；显式的快捷键、工具栏和 values 注册使用 `extension.<owner>.<local>`；扩展只能写入自己声明过的值。

完整的 `window.redux` facade 只用于开发和 smoke 测试。正式构建不会安装它，因此包代码无法通过全局句柄绕过 capability 控制的 context。管理操作留在设置页，包内订阅必须走 capability 控制 context。

iframe 沙箱是运行时边界；启用确认仍是本地信任决定，因为包仍可调用它声明过的全部 capability。正式构建不会把宿主 facade 暴露给沙箱，桥接只返回纯数据：布局读取返回矩形和标签，不会暴露 DOM 节点或输入值。内置包与外部包使用同一套沙箱。

## 安全模式

安全模式会在本次启动中跳过所有扩展代码。宿主仍会注册 manifest 并读取包内文本，但不会执行入口，也不会自动启用内置包，因此“设置 → 扩展”仍然可用，可以停用或移除导致上次启动失败的扩展。

启动 URL 使用 `extensions=off`（或旧写法 `mods=off`）、桌面宿主带 `--extensions-off` 启动、看门狗发现上次激活没有完成，或用户在启动失败界面选择“以安全模式启动”时，都会进入安全模式。最后一种请求只生效一次，并在下次启动读取后清除，之后的正常启动会恢复扩展加载。

## 预览几何

上下文包含 `api.preview`，用于读取实时预览上一帧中可见的音符、长按和判定线。`frame(request)` 按谱面秒数或拍数在离屏预览中渲染指定帧，返回编码后的 data URL；它不会跳转播放位置，也不会修改实时预览。每条边默认 960×540、允许 16–1920 像素，总面积上限为 1,000,000 像素，支持 `png`、`jpeg` 和 `webp`。

```js
const result = await api.preview.snapshot();
if (result.ok) {
  const { bounds, objects } = result.value;
  for (const object of objects) {
    console.log(object.id, object.kind, object.client.head);
  }
}

const stop = await api.preview.subscribe((snapshot) => {
  if (!snapshot) return; // 文档已关闭或预览已隐藏
  // snapshot.objects 是刚刚绘制的那一帧
});
```

每个对象都有稳定 id 和两个坐标系：`client` 相对于应用窗口，`surface` 相对于预览画布左上角。`bounds` 是画布在窗口中的矩形，`viewport` 是画布内实际绘制的预览画面，`rotation` 是顺时针角度。订阅会跟随每个绘制帧，且不会额外触发一次渲染；`snapshot()` 只读取当前帧一次。需要拾取用的碰撞几何时使用 `await api.hitTest.geometry()`。

`subscribe` 只在预览绘制时报告帧。自主动画的消费者（例如桌宠）应通过 `timers` capability 运行自己的时钟，并在两次绘制之间复用最近的快照，这样暂停播放不会让消费者停住。

## 布局锚点

`api.layout.anchors()` 返回当前可见的宿主区域（`workspace`、`toolbar`、 `inspector`、`sidebar`）和可见表单控件。每项包含 id、kind、宿主标签和窗口坐标矩形。输入值、文本内容和 DOM 节点不会暴露。列表按需采样；请从消费者自己的动画循环里调用，而不是在启动时只读一次。

```js
const layout = await api.layout.anchors();
if (layout.ok) {
  for (const anchor of layout.value) {
    if (anchor.kind === "control") {
      console.log(anchor.label, anchor.client);
    }
  }
}
```

## SDK

`sdk/index.d.ts` 是 types-only 作者接口，转发 `src/core/api/sdk.ts` 中集中维护的公开类型；`npm run check` 会类型检查该入口和示例。SDK 只在仓库内分发，没有运行时。
