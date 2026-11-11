# 常见问题

## 怎么添加或修改音符？

先用 `context.api.chart` 读谱面，再提交一个 `context.api.transaction` 请求。当前契约没有 `chart.placeNote`，也不允许直接修改读取到的对象。[谱面操作](place-note.md)里有完整插件、选中音符更新和结果处理。

## 为什么 `document` / `window` 是未定义？

扩展运行在不透明源的 iframe 里，没有宿主 DOM。用声明式树注册界面，用 `context.api` 读写数据，用 `context.ui` 显示通知和对话框。任何 `document.querySelector`、`innerHTML` 或事件监听器都不属于扩展契约。

## 为什么 `context.api` 的调用都要 `await`？

桥接是异步的。即使宿主方法本身是同步的，沙箱 facade 也返回 Promise，结果被克隆成普通数据。忘记 `await` 会拿到 Promise，而不是状态对象。

## 为什么按钮看起来和我的样式不一样？

声明式 `<button>` 由宿主渲染成官方 `Button`，默认 `outlined`；`<input>`、`<select>` 和 `<input type="range">` 也分别走官方控件，背景、边框和焦点环随主题。需要主操作时，一个面板最多加一个 `redux-button-solid`；其余保持默认。

## 为什么我的 CSS 没生效？

样式表被包进所有者作用域的 `@scope`，只能命中本包面板或覆盖层。检查：

- 选择器是否以本包类名为根，而不是 `:root`、`body` 或 `*`。
- 是否用了 `url()`、`@import`、`@keyframes` 等被拒绝的构造。
- 整张表是否因为花括号不平衡而被丢弃。
- 是否把颜色/字号/圆角写成了原始值；即使生效，也会在主题切换时出问题。

## 如何从工具栏或右键菜单打开面板？

侧栏图标是最稳妥的入口：注册 `panelId`，用户点击图标时宿主打开面板。后台动作可以运行同一个侧栏激活：

```js
await context.api.sidebar.open("open-main");
await context.api.sidebar.close("open-main");
```

使用当前已发布的 `context.api.sidebar.open(id)` / `context.api.sidebar.close(id)`。`api.ui.panel.open/close` 和 `api.ui.sidebar.open/close` 不是当前契约的一部分；不要根据旧草稿猜测方法，直接以左侧 **API** 树和当前版本的自动方法表为准。

## 为什么会得到 `methodNotRegistered`？

宿主 facade 上有这个方法，但 `methodRegistry.ts` 没有登记。它是宿主发布缺陷，不是权限问题，也不会被重试修复。用文档里的自动方法表核对目标版本；如果是自己开发宿主，补登记并运行 `node scripts/checkExtensionMethods.mjs`。

## 为什么 `capabilityDenied` 一直出现？

清单没有声明该能力，或用户没有授予。检查 `manifest.json` 的 `capabilities`，确认没有把 `ui.panel` 和 `ui.sidebar` 混为一谈，也没有在数据包里声明 `ui.*`。补能力后需要重新确认，不能只重载入口。

## 应该把配置存在哪里？

用户可配置项用 `api.settings.registerSetting` 声明设置行，再用 `api.values.byId` 读写；包私有草稿和版本标记用 `context.storage`；大文件、图片和音频走 library/package 资产。`values.define` 的 `persist` 或 `storageKey` 会被忽略，配置模型使用设置行和 storage。

## 为什么 `context.storage.set` 报值太大？

值必须是字符串，UTF-8 字节数不超过 256 KB；key 最长 128 字符。把结构裁剪成摘要，或把二进制放到资产通道。`JSON.stringify` 后的字节数才是上限判断依据。

## 为什么扩展突然被停用？

回调失败在 30 秒窗口内达到 5 次会触发失败预算。检查扩展列表的最近错误，去掉递归重试、短间隔轮询和未捕获的异步异常。`activate` 只做注册，把重活放到用户动作里。

## 图标名从哪里查？

读 `src/design/components/icon/iconAssets.ts` 的 `ICON_ASSETS` 键，或运行 `npm run icons:check`。未知名称会回退到 `help`。声明式面板里没有图标节点；图标只用于脚本、侧栏、设置导航、工具栏和右键菜单的描述符。

## 可以 `import` npm 包或使用 React 吗？

入口是沙箱里的单文件模块，没有 npm 解析、网络或宿主 React。把代码打包成自包含的单文件，使用声明式树和 `context.api`；宿主组件和 DOM 库留在宿主侧。

## 如何本地调试？

把包放进 `user-data/extensions/<id>/`，在设置 → 扩展中启用或重新加载；用 `ui.notice` 输出小范围状态，用 `api.diagnostics.snapshot()` 检查运行时，用扩展列表的最近错误定位失败。沙箱中的 `console` 不作为唯一日志通道。

## 为什么面板更新后输入框值没变？

普通 `update(tree)` 会替换树，但输入控件可能保留本地草稿；需要恢复模型值时调用 `update(tree, { replace: true })` 重新挂载。复选框和选择框也应把最新状态写进新树。

## 能把样式应用到宿主标题栏吗？

不能。扩展样式被 `@scope` 限制在自己的挂载点；主题包是另一套前端呈现契约，扩展不能替代标题栏、应用菜单、工具栏框架、检查器框架或窗口控制。
