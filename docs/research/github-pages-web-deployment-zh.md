# GitHub Pages 静态部署与浏览器端 SQLite 调研

本文是只读调研，不改产品代码。基线为 `c2921a2`（2026-11-10），目标回答三个问题：

1. 在普通浏览器中如何识别宿主、去掉最小化/最大化/关闭按钮，并隐藏分辨率、全屏等只对桌面窗口有意义的设置。
2. 部署到 GitHub Pages 后，如何继续使用 SQLite，而不是退化成 IndexedDB。
3. 纯静态部署下，数据持久化到底能保证到什么程度。

## 结论摘要

| 问题 | 结论 |
| --- | --- |
| 环境识别 | 现有的 `isDesktop()`（检测 `__TAURI_INTERNALS__`）已经足够，不要用 User-Agent。普通浏览器标签页和 PWA 独立窗口都按 Web 宿主处理。 |
| 窗口按钮 | 在 Web 宿主不渲染 `WindowControls`，并把标题栏右侧预留给窗口按钮的 138px 槽位归零。桌面构建保持不变。 |
| 分辨率/全屏设置 | 给设置 schema 增加宿主能力字段（`hosts` 或 `requires`），在 `settingsFields()` 和 `searchSettings()` 两处过滤。只隐藏 `window-display-mode`、`window-resolution` 不够，更新、文件、运行时端口、扩展安装等桌面项也应一起审计。 |
| 后端选型 | 不选 IndexedDB。用 SQLite 官方 WASM 构建（`@sqlite.org/sqlite-wasm`）+ OPFS `opfs-sahpool` VFS，在专用 Worker 中运行；跨标签页用 Web Locks 选主。需要把 Go 的 store 层和 HTTP 门面移植成 TypeScript 的 `LibraryBackend`，约 4–6 周。最小验证已通过，且第一版 `BrowserLibrary` 已落地，见第 7、8 节。 |
| 持久化 | OPFS + `navigator.storage.persist()` + 定期备份/导出，是“尽力而为”的持久化；静态托管无法给出硬保证。硬保证只有两种：服务端 SQLite，或用户自己持有的 `.sqlite` 文件。 |
| GitHub Pages | 现有构建已经具备条件：`base: "./"`、生成 `.nojekyll`、`dist` 约 30 MB。加一个 Pages workflow 即可。不能设置 COOP/COEP，所以不要用需要 `SharedArrayBuffer` 的 `opfs` VFS。 |

一个重要的产品判断：如果 Web 版只是公开演示或轻量编辑，浏览器 SQLite 够用；如果它是用户长期存放谱面的主编辑器，建议优先考虑“GitHub Pages 只放界面 + 本地 Go/SQLite 伴随服务”或“远端 Go/SQLite 服务”。原因见第 3 节。

## 当前代码事实

### 宿主识别

- [`src/core/platform/environment.ts`](../../src/core/platform/environment.ts) 的 `isDesktop()` 读取 `globalThis.__TAURI_INTERNALS__`。普通浏览器里为 `false`，Tauri 桌面/移动宿主里为 `true`。这是可靠的运行时能力检测，不依赖 UA。
- 名字叫 `isDesktop`，但 Tauri 移动宿主也会暴露这个全局对象。若以后要区分移动端，建议改名为 `isTauriHost()` 并增加单独的宿主种类。

### 窗口 chrome 与设置

- [`src/frontend/app/App.tsx`](../../src/frontend/app/App.tsx) 无条件渲染 `<WindowControls />`，位置在启动边界之外。
- [`src/frontend/chrome/topbar/windowControls/windowControls.ts`](../../src/frontend/chrome/topbar/windowControls/windowControls.ts) 的所有窗口动作在非桌面宿主已经是 no-op，但按钮本身仍然会显示。
- [`src/frontend/chrome/topbar/titleBar.less`](../../src/frontend/chrome/topbar/titleBar.less) 用 `--window-controls-reserved` 给右侧按钮预留了默认 138px 的槽位；只隐藏按钮会留下一条空白。
- [`src/frontend/chrome/topbar/useTitleBarWindowDrag.ts`](../../src/frontend/chrome/topbar/useTitleBarWindowDrag.ts) 在非桌面宿主不会真正移动窗口，但仍会安装一套指针手势。它不影响功能，只是没有意义。
- [`src/frontend/chrome/WindowResizeHandles.tsx`](../../src/frontend/chrome/WindowResizeHandles.tsx) 只在 Linux 桌面宿主渲染，浏览器里 `hostPlatform()` 返回空字符串，已经是 no-op。
- [`src/core/settings/features/generalInterface.ts`](../../src/core/settings/features/generalInterface.ts) 注册了 `window-display-mode`（windowed/fullscreen/exclusive）和 `window-resolution`（auto 及若干分辨率）。
- 设置行目前只有 `visibleWhen`、`enabledWhen`、`disabledWhen`，它们都依赖另一个设置值，不依赖宿主；见 [`src/core/settings/types.ts`](../../src/core/settings/types.ts) 和 [`src/frontend/screens/settings/useSetting.ts`](../../src/frontend/screens/settings/useSetting.ts)。

### 数据路径

- 前端唯一的谱面库数据通道是 [`src/core/global/library/client.ts`](../../src/core/global/library/client.ts) 里的 `LocalLibrary`，它把 `src/backend/internal/httpapi/api.go` 的路由表映射成 HTTP 方法。
- [`src/core/global/library/service.ts`](../../src/core/global/library/service.ts) 的 `localService()` 默认探测 `http://127.0.0.1:47821`，失败三次后返回 `null`。静态页面没有这个服务，所以首页谱面库、保存、修订、资源、占用锁都会失败。
- [`src/frontend/app/App.tsx`](../../src/frontend/app/App.tsx) 在启动时仍然会先探测本地服务，再 `preferences.attach()`；Web 构建会白白等待探测和退避。
- Go 侧 schema 很小，只有 `projects`、`revisions`、`preferences`、`assets`、`project_assets`、`revision_assets` 六张表，见 [`src/backend/internal/store/store.go`](../../src/backend/internal/store/store.go)。图表和资源都以 TEXT/BLOB 存在 SQLite 里，资源按 SHA-256 内容寻址。这个 schema 可以原样移植到 SQLite WASM。
- 设置已经有 localStorage 同步镜像：[`src/core/platform/browser/preferenceMirror.ts`](../../src/core/platform/browser/preferenceMirror.ts) 和 [`src/core/state/preferences.ts`](../../src/core/state/preferences.ts)。在 Web 宿主里，即使没有可写后端，设置也能在同一个浏览器里保留。
- 浏览器已经能打开本地谱面文件：`openDocument()` 在无桌面 store 时走隐藏 `<input type=file>`，见 [`src/frontend/screens/editor/workspace/document/lifecycle/service.ts`](../../src/frontend/screens/editor/workspace/document/lifecycle/service.ts) 和 [`chartFiles.ts`](../../src/frontend/screens/editor/workspace/document/open/chartFiles.ts)。
- 导出已经有浏览器下载路径：`exportPrompt.ts` 在 `currentDocumentStore()` 为空时使用 [`download.ts`](../../src/frontend/platform/download.ts)。
- 真正缺的是“保存到谱面库”和“从谱面库恢复”，它们都依赖 `LocalLibrary`；见 [`save.ts`](../../src/core/global/library/save.ts) 和 [`editorHome.ts`](../../src/frontend/screens/welcome/editorHome.ts)。

### 构建与部署

- [`package.json`](../../package.json) 已有 `build:web`（`vite build`）。
- [`vite.config.ts`](../../vite.config.ts) 已设置 `base: "./"`，并在构建结束写出 `dist/.nojekyll`。`dist` 当前约 30 MB，远低于 GitHub Pages 的 1 GB 站点限制。
- 没有客户端路由；只有性能 HUD 用查询参数区分窗口。因此不需要 SPA 404 回退。
- 内置主题通过 `import.meta.glob` 打进 bundle；内置皮肤从 `skins/` 相对路径读取；内置扩展在 Web 宿主被跳过。静态资源路径整体是相对 `document.baseURI` 的，适配 GitHub Pages 的项目子路径。

## 1. 环境检测与界面裁剪

### 1.1 检测什么

建议把宿主分成三类，而不是一个布尔值：

```ts
type HostKind = "desktop" | "web-dev" | "web-standalone";
```

- `desktop`：`isDesktop()` 为真。使用 Go sidecar + 原生窗口。
- `web-dev`：普通浏览器，但页面注入了 `__REDUX_DEV_RUNTIME__`（`npm run dev` 的 Vite 页面）。继续使用本地 Go 服务，保留开发循环。
- `web-standalone`：普通浏览器且没有开发运行时（`npm run dev:web` 或 GitHub Pages）。使用浏览器内 SQLite。

这样 `npm run dev` 不会被浏览器 SQLite 打断，`npm run dev:web` 和 Pages 则走纯静态路径。`browserDevRuntime()` 已经能区分是否注入了开发运行时，见 [`devRuntime.ts`](../../src/core/platform/browser/devRuntime.ts)。

不要用 `navigator.userAgent` 判断“是不是系统浏览器”。UA 可以伪造，也会把 PWA、Electron、移动 WebView 混在一起。宿主能力应该按 API 检测：

- 原生窗口：`__TAURI_INTERNALS__`
- 本地服务：`browserDevRuntime() !== null` 或 `isDesktop()`
- OPFS：`navigator.storage?.getDirectory` + Worker 里的 `createSyncAccessHandle`
- 持久化申请：`navigator.storage?.persist`

### 1.2 去掉右上角窗口按钮

最小改动：

1. [`App.tsx`](../../src/frontend/app/App.tsx) 改成 `{isDesktop() && <WindowControls />}`。
2. `WindowControls` 内部再加一个 `if (!isDesktop()) return null;` 作为防御，避免以后有人直接挂载它。
3. 在根元素写宿主标记，例如 `document.documentElement.dataset.host = isDesktop() ? "desktop" : "web"`，然后加一条 CSS：

```less
:root[data-host="web"] .redux-titlebar {
  --window-controls-reserved: 0px;
}
```

第 3 步不能省。只隐藏按钮，标题栏仍会保留 138px 的右侧空白；主题的 compact/capsule 变体还会改变预留宽度。用宿主标记覆盖变量，比在每个主题里写特例更稳。

可选清理：

- `useTitleBarWindowDrag` 在 Web 宿主直接不安装。现在它不会移动窗口，但会拦截标题栏的按下事件并可能吞掉拖拽后的 click。
- 隐藏 `UpdateBadge`（更新只在桌面可用）。`ImportBadge` 可以保留，因为 Web 仍能导入文件。
- 如果以后做 PWA 独立窗口，仍按 `web` 处理；PWA 的窗口按钮属于操作系统/浏览器，不属于应用。

### 1.3 去掉分辨率和全屏设置

推荐给设置 schema 增加宿主能力字段，而不是在组件里按 key 特判：

```ts
type HostKind = "desktop" | "web";

interface SettingDefinitionBase {
  // ...
  /** 缺省表示桌面和 Web 都可用。 */
  hosts?: readonly HostKind[];
}
```

然后在两个入口过滤：

- [`settingsCatalog.ts`](../../src/frontend/screens/settings/settingsCatalog.ts) 的 `settingsFields(navigation)`：只返回当前宿主可用的行。
- 同文件的 `searchSettings(query)`：搜索结果也必须过滤，否则搜“分辨率”仍会命中隐藏行。
- 导航项 `SettingsNavigation` 也应支持同样的字段，用来隐藏整页只在桌面存在的设置（例如更新页）。

只给 `window-display-mode` 和 `window-resolution` 标 `hosts: ["desktop"]`。保留 key 的注册和默认值，这样：

- 用户从桌面切到 Web 再切回桌面时，原来的值还在。
- `useSetting("window-display-mode", "windowed")` 在 Web 仍有 fallback，不会因为 key 不存在而报错。
- 设置值的迁移、重置、搜索索引都不需要第二套逻辑。

如果不想扩 schema，也可以在 `generalInterface.ts` 里按 `isDesktop()` 过滤数组。但这会把宿主判断散落到每个 feature 文件，后续每加一个桌面项都要重复一次，不如集中到 schema。

### 1.4 还需要审计的桌面专用项

用户只点名了分辨率和全屏，但一个真正能用的 Web 版不应该留下大量点了没反应的入口。建议按“隐藏 / 保留 / 改造”分类：

| 区域 | 现状 | Web 建议 |
| --- | --- | --- |
| 设置 → 更新 | Tauri updater、签名清单、安装包替换 | 隐藏整页或整个分组 |
| 设置 → 文件/自动保存/恢复 | 依赖 Tauri document store 和 `user-data/redux.db` 的 recovery 表 | 首版隐藏；浏览器 SQLite 落地后可改为 OPFS 自动保存 |
| 设置 → 运行时端口 / Code Cell | 依赖本地 Go 服务和 loopback WebSocket | 隐藏 |
| 设置 → 扩展安装/更新 | 依赖 Tauri 文件写入、GitHub 安装器和沙箱宿主 | 隐藏安装/更新；内置扩展可保留只读展示 |
| 设置 → 自定义背景/外部皮肤/主题文件夹 | 桌面会扫描 `themes/`、`skins/` 目录 | 隐藏“打开文件夹”类动作；内置主题/皮肤保留 |
| 帮助 → 文档 | 桌面打开本地 sidecar 的 `/docs/` | 改成静态文档站 URL 或隐藏 |
| 菜单 → 另存为 / 在资源管理器中显示 / 导入 RPE 文件夹 | 原生文件系统 | 隐藏或替换为浏览器文件选择/下载 |
| 菜单 → 检查更新 | Tauri updater | 隐藏 |
| 开发者 → 性能 HUD / 诊断包 | 部分依赖 Tauri 窗口和文件 | 保留浏览器可用的部分，隐藏原生命令 |
| 录制/导出视频 | WebCodecs 可能可用，但保存依赖 Tauri | 首版隐藏“保存到磁盘”，或改成下载 |

这张表不是要求一次做完，而是提醒：`window-display-mode` 只是最显眼的两行。设置页和菜单如果留着大量死入口，Web 版会被认为“坏了”。

### 1.5 验收标准

- 在 Chrome/Edge/Firefox/Safari 打开 `https://<owner>.github.io/<repo>/`，标题栏右上角没有最小化、最大化、关闭。
- 标题栏内容延伸到右侧正常内边距，没有 138px 空槽。
- 设置 → 通用 → 界面只有主题、渲染帧率等 Web 可用项；搜索“分辨率”“全屏”没有结果。
- `npm run dev:desktop` 的桌面窗口保持现有三个按钮、全屏模式和分辨率设置。
- `npm run dev` 的浏览器页面也不显示窗口按钮（它就是普通浏览器），但仍连接 Go 服务。

## 2. 后端选型：静态页面里的 SQLite

### 2.1 静态托管的硬约束

GitHub Pages 只提供静态文件：

- 不能运行 Go 进程，也不能启动 sidecar。
- 不能写服务器文件系统。
- 不能设置自定义响应头（包括 COOP/COEP）。
- 页面只能通过浏览器 API 存储数据。

因此，“继续用 SQLite”只有三条路：

1. 把 SQLite 编译成 WebAssembly，在浏览器里运行，数据放在 OPFS。
2. 把 Go/SQLite 服务放到远端，GitHub Pages 只做 UI。
3. 让用户在本机运行一个伴随服务，GitHub Pages 连接 `127.0.0.1`。

第 1 条是纯静态方案，也是本文重点。

### 2.2 为什么不是 IndexedDB

IndexedDB 是浏览器的对象存储，不是 SQL 引擎。要用它“存 SQLite”，实际上有两种做法：

- 用 `absurd-sql` / `wa-sqlite` 的 `IDBBatchAtomicVFS` 把 SQLite 的页读写映射到 IndexedDB。
- 放弃 SQLite，直接用 IndexedDB 写一套对象模型。

两者都不符合“不要退化”的目标：

- 第一种仍然是 SQLite，但 IndexedDB 在小库上还行，库到 100 MB 以上性能会明显下降；这是 PowerSync 在生产中的观察。
- 第二种要重写项目、修订、资源去重、乐观并发等所有规则，失去和桌面 `redux.db` 的格式兼容。
- IndexedDB 和 OPFS 一样是 best-effort 存储，同样会被清理、受配额限制；它并没有比 OPFS 更强的持久化保证。

所以 IndexedDB 只适合作为“OPFS 不可用时的显式降级”，例如 Safari 无痕模式。默认路径应该是 OPFS。

### 2.3 浏览器存储底座对比

| 底座 | 形态 | 性能 | 浏览器 | 适合 |
| --- | --- | --- | --- | --- |
| OPFS | 源私有文件系统，支持同步访问句柄 | 高，接近本地文件随机读写 | Chrome 86+/Firefox 111+/Safari 15.2+；同步句柄需要专用 Worker | SQLite 主存储 |
| IndexedDB | 对象/键值存储 | 小库可以，大库下降 | 广泛 | 显式降级或非 SQL 数据 |
| localStorage | 字符串键值，5–10 MB | 低 | 广泛 | 设置镜像，不适合谱面库 |
| Cache API | HTTP 响应缓存 | 中 | 广泛 | 静态资源离线缓存 |
| File System Access API | 用户可见文件/目录 | 中，写入走安全检查和临时文件 | 主要 Chromium | 备份/导出，不适合作为 SQLite 热路径 |
| 远端数据库 | 服务端 | 网络延迟 | 任意 | 跨设备、硬持久化 |

OPFS 的关键优势是“文件语义”：SQLite 看到一个可随机读写的文件，而不是一堆对象。官方 `opfs-sahpool` 和 wa-sqlite 的 `OPFSCoopSyncVFS` 都建立在这个基础上。

### 2.4 SQLite WASM 的 VFS 选型

当前（2026-11）主流选项：

| 方案 | 存储 | 需要 COOP/COEP | 多标签页 | 说明 |
| --- | --- | --- | --- | --- |
| `@sqlite.org/sqlite-wasm` + `opfs` | OPFS | 是（`SharedArrayBuffer`） | 支持多连接，单事务 | GitHub Pages 不能设头，除非用 service worker 伪造，不推荐 |
| `@sqlite.org/sqlite-wasm` + `opfs-sahpool` | OPFS | 否 | 单连接，需要应用层选主 | 官方 VFS，性能最好，推荐 |
| `@sqlite.org/sqlite-wasm` + `opfs-wl` | OPFS | 否 | Web Locks 协调 | 3.53 新增，依赖 `Atomics.waitAsync`，可移植性略差 |
| `wa-sqlite` + `OPFSCoopSyncVFS` | OPFS | 否 | 多连接，单事务，`SQLITE_BUSY` 重试 | PowerSync 生产使用，文件透明 |
| `wa-sqlite` + `AccessHandlePoolVFS` | OPFS | 否 | 单连接 | 类似 `opfs-sahpool` |
| `wa-sqlite` + `IDBBatchAtomicVFS` | IndexedDB | 否 | 可并发读 | 无 OPFS 时的降级，不是首选 |
| `sql.js` | 内存 | 否 | 无 | 手动导入/导出整个数据库，不适合自动保存 |
| `SQLocal` | OPFS | 是（其文档要求） | 取决于底层 VFS | 封装 sqlite-wasm；Pages 上需要 `coi-serviceworker`，多一个变量 |

推荐：**官方 `@sqlite.org/sqlite-wasm` + `opfs-sahpool`**。

理由：

- 官方维护，VFS 行为有文档；`opfs-sahpool` 明确不要求 COOP/COEP，正好适配 GitHub Pages。
- 单连接、单写者，和 Go 服务现在的 `db.SetMaxOpenConns(1)` 语义一致，事务模型简单。
- 官方提供 `installOpfsSAHPoolVfs()`、`OpfsSAHPoolDb`、`exportFile()`、`importDb()`、`pauseVfs()`/`unpauseVfs()`，备份和迁移路径完整。
- 缺点是多标签页需要自己选主。这个成本可以用 Web Locks 控制在几百行内。

如果多标签页是硬需求，且不想写选主逻辑，可以选 `wa-sqlite` 的 `OPFSCoopSyncVFS`。它允许同一源下多个连接，SQLite 层用 `SQLITE_BUSY` 重试；代价是要接受一个第三方示例 VFS 的维护风险，以及事务中途 `SQLITE_BUSY` 的错误处理。对谱面编辑器这种写事务短、频率中等的应用，两种都可行。

不建议：

- `opfs` VFS + `coi-serviceworker`。它能在 Pages 上工作，但首次加载需要 service worker 接管并刷新，跨源资源、缓存和调试都会变复杂；`opfs-sahpool` 已经不需要这些。
- `sql.js` 作为主存储。它只在内存里，必须手动导出整个文件；崩溃会丢失未导出的修改。
- 静默回退到 IndexedDB。用户明确不想要这个；如果 OPFS 不可用，应该显示“临时会话”横幅并要求导出，而不是悄悄换存储。

### 2.5 推荐架构

```text
React 主线程
  └── BrowserLibrary（实现 LibraryBackend）
        └── MessagePort / BroadcastChannel
              └── 选主后的专用 DB Worker
                    ├── sqlite3 WASM
                    └── opfs-sahpool VFS
```

关键点：

1. **专用 Worker 持有 SQLite 连接。** OPFS 的同步访问句柄只在专用 Worker 里可用；主线程和 SharedWorker 都不行。
2. **Web Locks 选主。** 所有标签页竞争 `navigator.locks.request("rpe-redux-db", { mode: "exclusive" }, ...)`。拿到锁的标签页启动 DB Worker 并持有锁；其他标签页通过 `BroadcastChannel` 把请求转发给主标签页。主标签页关闭或崩溃时锁自动释放，下一个标签页接管并重新打开数据库。
3. **主标签页保持一个 Web Lock。** Chrome/Edge 会挂起长时间不活跃的标签页；PowerSync 的做法是让主标签页持有一个 Web Lock，防止承载数据库的 Worker 被挂起。
4. **所有调用串行化。** 一个 Worker 一个连接，所有读写排队执行。事务保持短小，避免长时间持有 OPFS 句柄。
5. **资源字节用 Transferable。** `stageAsset` / `asset` 传 `ArrayBuffer`，避免 structured clone 再复制一份 256 MB 的音乐。follower 标签页不要用 BroadcastChannel 传大字节（它不支持 transfer list）；正式实现应在建链时交换 `MessagePort`，让大资源走带 transfer 的通道。
6. **同一个 v1 schema。** `projects`、`revisions`、`preferences`、`assets`、`project_assets`、`revision_assets` 原样建表；用 `PRAGMA user_version` 记录 schema 版本，后续迁移在事务里做。
7. **`journal_mode` 不要用 WAL。** 在没有 COOP/COEP 的 WASM 环境里没有共享内存，WAL 需要 `locking_mode=EXCLUSIVE`，在 OPFS 上没有并发收益。用默认的回滚日志，`synchronous=FULL` 保证提交落盘；批量导入资源时可以临时 `NORMAL`，提交后再恢复。
8. **`opfs-sahpool` 容量。** 默认池容量只够一两个库；至少要覆盖主库、journal、临时文件和备份。建议 `initialCapacity: 10`，并用 `reserveMinimumCapacity()` 兜底。每次升级 SQLite 前验证池容量和 `exportFile` 行为。
9. **数据库路径。** 用绝对路径，例如 `/rpe-redux/redux.db`。`opfs-sahpool` 的文件名是虚拟的，不直接对应 OPFS 里的文件名；备份用 `exportFile()`，不要直接去 OPFS 目录里找。
10. **错误码复用。** `LocalLibraryError` 的 `not_found`、`revision_conflict`、`occupied` 等 code 保持不变；新增 `storage_full`、`opfs_unavailable`、`database_busy`，UI 只按 code 分支。

### 2.6 需要改哪些代码

最小可行拆分：

1. **抽出 `LibraryBackend` 接口。** 从 `LocalLibrary` 的公开方法抽出接口，`LocalLibrary` 实现 HTTP 版；新增 `BrowserLibrary` 实现 Worker RPC 版。`localService()` 返回 `LibraryBackend`，调用方不需要知道底层是 HTTP 还是 SQLite。
2. **改 `localService()` 选择逻辑。** 桌面 → 启动 sidecar + HTTP；`web-dev` → HTTP；`web-standalone` → `BrowserLibrary.open()`。启动时不要对静态页面做三次 loopback 探测。
3. **移植 store 语义。** Go 的 store 约 1,500 行、30 个方法；HTTP 门面约 30 个 handler。TS 侧重点：
   - 项目列表的搜索、分组、排序、分页；
   - `commit` 的 `baseRevision` 乐观并发检查；
   - 资源 SHA-256 去重、staging lease、未引用资源 GC；
   - 修订创建/列表/读取/删除；
   - 复制项目；
   - 偏好读写和 JSON 校验；
   - `VACUUM INTO` 备份。
4. **资源 URL 改成异步。** 现在 `LocalLibrary.assetUrl(id, name)` 同步返回 HTTP URL，调用点包括 [`document.ts`](../../src/core/global/library/document.ts)、[`homeProjectCards.ts`](../../src/frontend/screens/welcome/homeProjectCards.ts)、[`coverBackdropUrl.ts`](../../src/frontend/app/coverBackdropUrl.ts)。浏览器没有稳定的 HTTP 资源地址，只能：
   - 先从 SQLite 读字节，`URL.createObjectURL()` 生成 blob URL；
   - 缓存 blob URL，项目关闭或资源变化时 revoke；
   - 把接口改成 `Promise<string>`，或在 `LibraryAssetMap` 里预取。

   首页封面列表要懒加载，不能为了 500 张卡片一次性读出所有封面。

5. **偏好客户端。** `createDesktopPreferenceClient()` 读 Tauri token 文件；Web 用 `BrowserLibrary.savePreferences()`，不需要 token。`PreferenceStore` 的 localStorage 镜像继续保留，作为首屏同步缓存；SQLite 是持久层。
6. **占用锁。** `documentLease` 现在调用 `occupancyAcquire` 等 HTTP 方法。Web 版可以在主 Worker 里用 `navigator.locks` 按 `documentKey` 加锁：`library:<id>` 或 `bytes:<name>`。锁随标签页关闭自动释放，比心跳表更适合浏览器。
7. **跳过桌面子系统。** `instances`、`intake/classify`、Code Cell、协作房间、docs、shutdown 在静态 Web 版没有意义。保留接口但返回 `unsupported`，或在启动时直接不注册。
8. **启动与失败 UI。** `StartupBoundary` 现在展示后端失败；Web 版要能展示“OPFS 不可用”“存储已满”“数据库被另一个标签页占用”等状态，并给出导出/重试/临时会话选项。

### 2.7 其他方案

#### 方案 B：GitHub Pages UI + 本地伴随服务

页面仍部署在 Pages，但连接用户本机的 Go/SQLite 服务（`127.0.0.1:47821`）。数据是真正的磁盘文件，持久化最强，移植量最小。

需要解决：

- CORS 允许 `https://<owner>.github.io`；生产 sidecar 现在只信任桌面和开发源，见 [`cors.go`](../../src/backend/internal/httpapi/cors.go)。
- Chrome 的 Private Network Access：公网页面访问 loopback 可能触发预检，需要 `Access-Control-Allow-Private-Network: true`。
- HTTPS 页面访问 `http://127.0.0.1` 的混合内容/可信源规则；不同浏览器行为不完全一致。
- 用户必须安装并运行服务；版本要和页面匹配；更新是两套。
- 安全：任何被允许的来源都能读写本地库；需要配对 token 或用户确认，不能只靠 CORS。

适合“我自己用，数据最重要”的场景，不适合公开访问。

#### 方案 C：远端 Go/SQLite

把 sidecar 部署到 VPS/Fly.io/Render，前面加 TLS 和认证；GitHub Pages 只做 UI。数据在服务端 SQLite，天然跨设备。

需要新增：用户账号、每用户数据库、认证/授权、CORS、限流、备份、监控。当前 schema 没有 `user_id`，sidecar 也没有认证；不能把现在的 loopback 服务直接暴露到公网。

如果接受换托管商，Cloudflare Pages + D1 或 Turso/libSQL 也是 SQLite 系方案，但这已经不再是“GitHub Pages 静态部署”。

#### 方案 D：Go 编译成 WASM

理论上可以把 Go service 编译成 `GOOS=js GOARCH=wasm` 或 `wasip1`，在浏览器里跑。实际障碍：

- `net/http` 的监听在浏览器里不存在；要把 HTTP 门面换成 RPC。
- `os` 文件系统在 js/wasm 里不存在；wasip1 需要 WASI 运行时和预打开目录，浏览器不提供。
- `modernc.org/sqlite` 需要自定义 VFS 才能落到 OPFS，Go↔JS 调用开销和调试复杂度都高。
- sidecar 还依赖 `os/exec`、Cloudflare tunnel、固定端口等桌面能力。

结论：不推荐。把 store 语义移植到 TypeScript 更可控，Go 代码保留为桌面实现和契约参考。

### 2.8 工作量与风险

粗估（一名熟悉该仓库的工程师）：

| 阶段 | 内容                                              | 估算   |
| ---- | ------------------------------------------------- | ------ |
| 0    | 宿主分类、窗口按钮/设置裁剪、Pages workflow       | 2–3 天 |
| 1    | `LibraryBackend` 接口 + Worker/SQLite 骨架 + 选主 | 3–5 天 |
| 2    | 项目/修订/资源/偏好 store 移植                    | 5–8 天 |
| 3    | 资源 URL、首页封面、保存流程适配                  | 2–4 天 |
| 4    | 持久化 UI、备份/恢复、配额/损坏处理               | 3–5 天 |
| 5    | 跨标签页占用、自动保存、崩溃恢复                  | 3–5 天 |
| 6    | 跨浏览器测试、Pages 冒烟、文档                    | 2–3 天 |

合计约 4–6 周。风险集中在：

- **资源 URL**：同步 HTTP URL 改成 blob URL 会牵动首页、编辑器、导出。
- **多标签页**：选主、接管、进行中请求失败重试。
- **大资源内存**：256 MB 音乐在 `postMessage` + WASM 里可能峰值过高，首版应限制浏览器单资源大小，或做分块 BLOB I/O。
- **跨浏览器差异**：Safari 无痕模式没有 OPFS；Chrome 无痕约 100 MB 限制；Firefox 配额策略不同。

## 3. 可持久化

### 3.1 OPFS 能保证什么

在正常浏览条件下：

- 同一个源、同一个浏览器配置下，OPFS 里的 SQLite 文件在刷新、关闭标签页、重启浏览器后仍然存在。
- 写入是文件级的；SQLite 的事务、回滚日志、`synchronous` 语义仍然生效。
- 用 `VACUUM INTO` 或 `exportFile()` 可以导出标准 SQLite 文件；桌面版和 Web 版可以互相导入。

这就是“SQLite 在网页里”的真实含义：引擎是 SQLite，文件在浏览器的源私有文件系统里，格式仍是 SQLite。

### 3.2 OPFS 不能保证什么

- **不是用户可见文件。** 用户无法在资源管理器里找到它；清理浏览器数据、重装浏览器、重置配置文件都会删除。它也不是加密存储，敏感数据依赖设备磁盘加密。
- **不是硬持久化。** 默认是 best-effort；存储压力下浏览器可以按 LRU 清理整个源的数据。`navigator.storage.persist()` 可以申请 persistent 模式，降低被清理的概率，但不是绝对保证。
- **源绑定。** `https://<owner>.github.io` 是一个源，该账号下所有项目站点共享同一个 OPFS 命名空间。换个账号、换自定义域名、换浏览器配置，就是另一个数据库。
- **无痕模式。** 通常在会话结束时清空；Safari 的无痕模式可能根本不支持 OPFS。
- **配额。** Chrome 约为磁盘的 60%；Firefox best-effort 取磁盘 10% 与 10 GiB 组上限中较小者，persistent 最高 50%/8 TiB；Safari 浏览器应用约 60%，嵌入式 WebView 约 15%。超限会抛 `QuotaExceededError`，在 SQLite 层可能表现为泛化的 I/O 错误。
- **Safari 的 ITP 清理。** 长时间没有用户交互的源可能被主动清理；persistent 模式会被排除，但仍建议定期打开和备份。
- **多标签页。** `opfs-sahpool` 只允许一个连接；第二个标签页直接打开会失败，必须选主或显式提示。

结论：静态托管 + 浏览器存储只能做到“尽力而为”。如果用户把谱面库当作唯一副本，这不是一个可接受的保证。

### 3.3 推荐的持久化策略

1. **首次保存时申请 persistent。** 在用户点击“保存”的手势里调用：

   ```ts
   const already = await navigator.storage.persisted();
   const granted = already || (await navigator.storage.persist());
   ```

   不要在页面加载时弹权限。Chrome/Edge 会按站点参与度自动批准/拒绝；Firefox 会提示；Safari 按启发式（例如是否添加到主屏幕）批准。

2. **设置页显示存储状态。** 显示 `navigator.storage.estimate()` 的 usage/quota、是否 persistent、上次备份时间、当前数据库大小。提供“申请持久化”“立即备份”“导出数据库”按钮。

3. **自动备份到 OPFS。** 每次启动或每天一次：

   ```sql
   VACUUM INTO '/rpe-redux/backups/redux-2026-11-10.db';
   ```

   保留最近 3 份；启动时对最新备份跑 `PRAGMA integrity_check`。备份也占配额，要纳入容量计算。

4. **手动下载 `.sqlite`。** 用 `pool.exportFile()` 读出备份文件，`download()` 成 `redux-<date>.db`。这是用户真正能带走、能在桌面版打开、能放进网盘的副本。

5. **恢复要校验。** 用户选择 `.sqlite` 后：
   - 检查 SQLite 文件头；
   - 打开后检查 `user_version` 和必需表；
   - 跑 `PRAGMA integrity_check`；
   - 先把当前库导出成 OPFS 里的 `.bak`，再 `importDb()` 导入；
   - 失败则重新导入 `.bak`。

6. **迁移前先备份。** schema 升级在一个事务里执行；升级前生成一份 OPFS 备份；失败时回滚并保留旧库。

7. **提交要落盘。** 谱面提交用 `synchronous=FULL`；批量资源 staging 可以用 `NORMAL`，但最终 commit 前要保证资源已写入。不要把长事务跨用户操作保持打开。

8. **崩溃/关闭前处理。** `visibilitychange`/`pagehide` 时请求一次 checkpoint；不要依赖 `beforeunload` 做异步保存。未提交的编辑由现有的自动保存/恢复流程处理（Web 版需要单独的 OPFS 草稿表，或把桌面的 `recovery_*` 表纳入 Web schema）。

9. **配额错误要可见。** 把 `QuotaExceededError` / SQLite I/O 错误映射成“存储已满”，提供删除旧修订、清理未引用资源、导出后重置的选项；绝不静默丢数据。

10. **不要静默降级。** OPFS 不可用时显示“临时会话，关闭后会丢失”，并只允许导出；不要悄悄切到 IndexedDB 或内存。

### 3.4 备份与恢复的边界

- OPFS 备份只能防止“数据库损坏/误删项目”，不能防止“用户清理站点数据/换设备/换浏览器”。
- 下载到磁盘的 `.sqlite` 是强得多的保证，但需要用户主动做。
- 桌面版和 Web 版共用 schema 时，Web 导出的库可以直接给桌面版；桌面版的 `redux.db` 要先 `VACUUM INTO` 成单文件，再给 Web 版导入（仅 checkpoint 不够，WAL 的 `-wal`/`-shm` 不能单独拷贝）。
- 版本兼容性：升级 schema 前备份；旧版 Web 打开新版数据库要拒绝并提示升级，而不是尝试降级写入。

### 3.5 跨设备

纯静态方案没有跨设备同步。可选路径：

- 用户手动导出/导入 `.sqlite`；
- 网盘同步导出的文件（仍是手动）；
- 远端 Go/SQLite 或 Turso/libSQL（需要服务器/账号）；
- 未来做端到端加密的同步服务（工作量大，另立项）。

如果“换电脑还能继续编辑”是硬需求，应该直接选远端方案，而不是在 OPFS 上叠同步。

## 4. GitHub Pages 部署

### 4.1 构建产物

- `npm run build:web` 输出 `dist/`，当前约 30 MB。
- `vite.config.ts` 已经设置 `base: "./"`，并把 `.nojekyll` 写进 `dist/`。
- `dist` 里的 `assets/`、`themes/`、`skins/`、`extensions/` 都是相对路径可访问的；不要新增以 `/` 开头的运行时 URL。
- 如果 Help 需要静态文档，当前 `build:web` 不会把 `docs-site-dist` 复制进 `dist`；需要额外复制到 `dist/docs`，或让 Help 链接到独立文档站。

### 4.2 工作流

```yaml
name: Pages
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build:docs
      - run: npm run build:web
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

这只是骨架；仓库已有的 `check.yml` 可以继续做质量门禁。Pages 的构建超时是 10 分钟，`npm ci` + Vite 构建通常够用；如果不够，缓存 `node_modules`/Vite 缓存。

### 4.3 子路径、WASM 与 Worker

GitHub Pages 项目站点部署在 `https://<owner>.github.io/<repo>/`，不是根路径。以下规则必须遵守：

- Worker 用 `new Worker(new URL("./db.worker.ts", import.meta.url), { type: "module" })`，让 Vite 生成相对路径。
- `sqlite3.wasm` 用 Vite 的 `?url` 导入或 `new URL(..., import.meta.url)`，不要写死 `/assets/sqlite3.wasm`。
- 如果 SQLite 的 Emscripten 加载器支持 `locateFile`，返回 Vite 解析后的 URL。
- `WebAssembly.instantiateStreaming` 失败时要有 `fetch` + `instantiate` 的回退；GitHub Pages 现在通常以 `application/wasm` 提供 `.wasm`，但回退成本很低。
- 任何 `fetch("/api/...")` 在 Pages 上都会 404；Web 版必须走 `BrowserLibrary`，不能保留对 sidecar 的绝对路径调用。

### 4.4 响应头与 COOP/COEP

GitHub Pages 不支持自定义响应头。因此：

- 不要依赖 `SharedArrayBuffer`；不要用需要 COOP/COEP 的 `opfs` VFS。
- `opfs-sahpool` 和 `OPFSCoopSyncVFS` 都不需要这些头。
- `coi-serviceworker` 可以通过 service worker 伪造 COOP/COEP，但首次加载要接管并刷新，且会影响跨源资源；除非确实需要多线程 WASM 或 `opfs` VFS，否则不建议。
- CSP 只能用 `<meta http-equiv="Content-Security-Policy">`。如果加，记得允许 `wasm-unsafe-eval`、`blob:` worker 和 `data:` 字体；不加也能运行，因为静态站点没有服务端注入点。

### 4.5 缓存、带宽与路由

- 30 MB 的冷启动对谱面编辑器偏大。`themes/`、`skins/`、`help/` 里的大图可以按需加载；主题包和皮肤包不必在首屏全部下载。
- GitHub Pages 的带宽软限制是 100 GB/月；按 30 MB/次计算，约 3,300 次冷启动就会接近上限。公开推广前要考虑 CDN 或 Git LFS/Release 资源。
- Vite 生成的带 hash 资源可以长期缓存；`index.html` 不要设长缓存。
- 没有客户端路由，所以不需要 404 回退。以后若加路由，优先 hash 路由，或把 `404.html` 复制为 `index.html`。

### 4.6 安全

- 静态 bundle 里不能放任何密钥；Web 版没有偏好写 token，也不需要。
- 不要把本地 sidecar 直接暴露到公网。它没有认证，CORS 是唯一边界，偏好 token 只是防跨进程写入，不是用户认证。
- 如果做“本地伴随服务”，只允许明确的 Pages 源，并加配对 token/PNA 预检；不要让任意网页访问 `127.0.0.1:47821`。
- `github.io` 同账号下的项目共享源，OPFS 也共享。若数据敏感，使用独立自定义域名；至少把数据库放在应用专属目录，并知道同源的其他页面理论上可以读到它。
- 扩展/Code Cell 在 Web 版默认关闭；它们是本地代码执行面，不应该在静态公开站默认开启。
- GitHub Pages 的 usage limits 明确不适用于商业 SaaS；项目站/演示站可以，商业托管要另选服务。

## 5. 实施计划

建议先做一个 3–5 天的技术验证，再决定是否投入完整移植：

### 阶段 0：宿主裁剪（可独立上线）

- 增加 `HostKind` / `isWebHost()`，在根元素写 `data-host`。
- 条件渲染 `WindowControls`，重置标题栏预留宽度。
- 设置 schema 增加 `hosts`，过滤 `settingsFields` 和 `searchSettings`。
- 隐藏更新、文件、运行时端口、扩展安装等桌面项；审计菜单命令。
- 加 Pages workflow，先部署一个只读/文件导入导出可用的 Web 版。
- 验收：桌面无回归；Web 无死按钮；`npm run check` 通过。

### 阶段 1：SQLite 技术验证

> 这一阶段已用一次性 spike 验证，结果见第 7 节；正式落地时仍需在仓库内补自动化测试。

- 在独立分支加 `@sqlite.org/sqlite-wasm`。
- 一个专用 Worker：`installOpfsSAHPoolVfs()` + 建 v1 schema + 插入/读取/删除。
- 一个最小 `BrowserLibrary`：`list/get/create/commit` 四个方法。
- 刷新页面验证数据还在；导出 `.sqlite` 用桌面版或 `sqlite3` CLI 打开验证。
- Web Locks 选主：两个标签页同时打开，第二个转发请求；关闭主标签页后第二个接管。
- 在 Chrome/Edge/Firefox/Safari（含无痕）记录行为。

### 阶段 2：完整库移植

- 抽出 `LibraryBackend` 接口，桌面 HTTP 版保持不变。
- 移植项目、修订、资源、偏好、复制、GC、乐观并发。
- 资源 URL 异步化；首页封面懒加载；编辑器媒体加载适配 blob URL。
- 用 Go 的测试 fixture 做 TS/Go 双实现对比，至少覆盖：创建、提交、冲突、资源去重、修订、删除、偏好校验。

### 阶段 3：持久化与恢复

- 存储状态面板、persist 申请、配额显示。
- OPFS 自动备份、下载/恢复、完整性校验、迁移前备份。
- 无痕/OPFS 不可用/配额满的明确 UI。
- 自动保存和崩溃恢复。

### 阶段 4：跨标签页与占用

- Web Locks 文档占用；第二个标签页打开同一项目时提示。
- 主标签页接管、进行中请求重试。
- 关闭标签页时的 lease 释放和 session 保存。

### 阶段 5：发布

- Pages workflow、缓存策略、跨浏览器冒烟。
- 文档：Web 版数据位置、备份/恢复、限制。
- 版本兼容：Web 导出的 `.sqlite` 与桌面版互开。

## 6. 待确认的产品决策

1. **Web 版的定位**：公开演示/轻量编辑，还是用户长期使用的主编辑器？前者可以接受 best-effort；后者应优先考虑伴随服务或远端服务。
2. **是否必须跨设备**？如果是，OPFS 不够，需要服务端。
3. **是否接受用户安装本地伴随服务**？如果可以，方案 B 的持久化最强、移植量最小。
4. **是否能使用独立自定义域名**？能，则 OPFS 源隔离更好，也避免 `github.io` 同账号项目共享源。
5. **浏览器范围**：是否必须支持 Safari 和移动端？Safari 无痕没有 OPFS；移动端的大谱面编辑体验也要单独评估。
6. **协作/扩展/Code Cell 是否要在 Web 版保留**？这些是桌面 sidecar 的能力，Web 版首版建议关闭。
7. **数据规模**：典型谱面的音乐/背景有多大？这决定是否需要分块 BLOB I/O 和更低的浏览器上限。

## 7. 实测记录（2026-11-10）

这一节记录的是一次性技术验证，不是产品集成。验证代码放在仓库外的临时目录，未纳入提交。

### 7.1 环境

| 项          | 值                                                    |
| ----------- | ----------------------------------------------------- |
| OS          | Windows 11                                            |
| 浏览器      | Microsoft Edge（Chromium，Playwright 启动，headless） |
| Node        | 25.2.1                                                |
| SQLite WASM | `@sqlite.org/sqlite-wasm` 3.54.1-build1               |
| Go          | 1.25.3                                                |
| 静态服务器  | 自写 Node HTTP server，不发送 COOP/COEP               |

### 7.2 已验证

| 验证 | 结果 |
| --- | --- |
| 无 COOP/COEP | `crossOriginIsolated === false`，`typeof SharedArrayBuffer === "undefined"`；`opfs-sahpool` 正常打开数据库 |
| v1 schema | `PRAGMA user_version = 1`；projects/revisions/preferences/assets 等表创建成功 |
| CRUD | create/list/get/commit 正常；`baseRevision` 过期时返回 `revision_conflict` |
| 完整性 | `PRAGMA integrity_check` 返回 `ok` |
| 刷新 | 页面 reload 后项目仍存在，revision 保留 |
| 浏览器重启 | 关闭并重新启动同一 profile 后数据仍在 |
| 多标签页 | 第二个标签页作为 follower 通过 BroadcastChannel 调用 leader；关闭 leader 后 follower 在 Web Lock 释放后接管 |
| 子路径 | 在 `/repo/` 路径下加载，Worker、`sqlite3.wasm`、模块导入全部走相对路径 |
| 导出 | `VACUUM INTO` + `pool.exportFile()` 生成 139,264 字节文件；SQLite header 正确 |
| 桌面兼容 | 导出的 `.sqlite` 被 Go sidecar 通过 `/api/projects` 读取，项目和 chart 内容完整；sidecar 的 additive schema 升级也能直接应用到该文件 |
| 存储 API | `navigator.storage.estimate()` 返回约 10 GB quota；headless 下 `persist()` 返回 false |

### 7.3 当前 Web 构建的基线探针

把现有 `dist` 以 `/repo/` 子路径静态托管（没有本地服务），用同一浏览器加载：

- 页面能挂载，首页显示 “The chart library is unavailable / The local service is not running”。
- 右上角仍有 3 个窗口按钮（最小化/最大化/关闭），容器宽 138px，标题栏右内边距 150px。
- 设置 → General → Interface 仍显示 `window-display-mode` 和 `window-resolution`；搜索能命中。
- 首次运行会弹出 onboarding 选择对话框；关闭后界面可交互。

这验证了第 1 节的判断：当前 Web 构建缺的不是“能不能渲染”，而是宿主裁剪和谱面库后端。

### 7.4 没有验证

- Firefox、Safari、移动端。
- 大资源：没有测试 256 MB 音乐/背景的内存峰值和 BLOB 分块。
- 崩溃/强杀：只测了正常关闭标签页，没有测事务中途杀进程。
- 配额耗尽、无痕模式、Safari ITP 清理。
- 真实 GitHub Pages 部署；只用了本地静态服务器和 `/repo/` 子路径模拟。
- 生产集成：没有把 spike 接进 `LocalLibrary`，也没有改产品代码。

### 7.5 复现方式

验证目录（一次性，未提交）：

```text
C:\Users\Administrator\AppData\Local\Temp\opencode\sqlite-pages-spike
```

关键文件：

- `public/db.worker.mjs`：`opfs-sahpool` + v1 schema + CRUD/导出 RPC。
- `public/main.mjs`：Web Locks 选主 + BroadcastChannel 转发。
- `server.mjs`：无 COOP/COEP 的静态服务器，支持子路径。
- `test-solo.mjs`、`test-multi.mjs`、`test-subpath.mjs`：Playwright 验证。
- `spike-export.db`：导出的 SQLite 文件。

运行：

```powershell
cd C:\Users\Administrator\AppData\Local\Temp\opencode\sqlite-pages-spike
node test-solo.mjs
node test-multi.mjs
node test-subpath.mjs
```

依赖：`@sqlite.org/sqlite-wasm`、`playwright-core`，浏览器使用本机 Edge。

## 8. 当前实现状态（分支 `research/github-pages`）

这一节记录已经落地的代码，不是完整 Web 版的验收结论。

### 8.1 已落地

- 依赖：`@sqlite.org/sqlite-wasm@3.54.1-build1`。
- [`src/core/platform/browser/library/db.worker.ts`](../../src/core/platform/browser/library/db.worker.ts)：`opfs-sahpool`、v2 schema（`application_id`、`user_version=2`、`revisions.chart_hash`、`library_meta`）、v0/v1 增量迁移、迁移前 OPFS 副本、项目/资源/修订/偏好、`baseRevision` 冲突检查、`VACUUM INTO` 导出；以及同一对象格式的 OPFS 快照存储、20 秒去抖 + 120 秒最大延迟的自动快照、手动快照/恢复/校验/压缩、损坏 live DB 时的恢复模式。
- [`src/backend/internal/librarybackup/`](../../src/backend/internal/librarybackup/)：桌面和远程 Go 服务的同一套对象/提交/ref、快照、事务恢复、校验、保留/GC 和自动快照循环；HTTP 路由在 [`src/backend/internal/httpapi/backup_api.go`](../../src/backend/internal/httpapi/backup_api.go)。
- [`src/core/settings/features/libraryBackup.ts`](../../src/core/settings/features/libraryBackup.ts)：设置 → 通用 → “谱面库备份”里的自动快照开关和 30–3600 秒间隔；关闭开关会禁用间隔并停止后台计时器。
- [`src/core/platform/browser/library/browserLibrary.ts`](../../src/core/platform/browser/library/browserLibrary.ts)：`LocalLibrary` 子类、Web Locks 选主 + BroadcastChannel follower 转发、串行 Worker RPC、资源 blob URL 缓存、浏览器内 instance/occupancy 的 no-op 实现。浏览器 worker 没有 chart stream/line 端点，`supportsChartStream()` 返回 false，首页打开和会话恢复直接读整包项目。
- [`src/core/global/library/service.ts`](../../src/core/global/library/service.ts)：Web standalone 打开 `BrowserLibrary`；桌面和 `npm run dev` 继续走 HTTP。
- [`src/core/global/library/assetUrlCache.ts`](../../src/core/global/library/assetUrlCache.ts)：浏览器资源 blob URL 的注册、查询和释放；`projectAssetUrl` 先查缓存。
- [`src/frontend/screens/welcome/homeProjectCards.ts`](../../src/frontend/screens/welcome/homeProjectCards.ts)：没有可用 URL 时不生成空封面/音频 URL。
- [`src/frontend/screens/settings/web/WebStorageSettings.tsx`](../../src/frontend/screens/settings/web/WebStorageSettings.tsx)：Web-only 的“浏览器存储”页，显示配额和持久化状态，支持申请 persistent、下载 `.sqlite` 备份，以及从备份恢复（恢复前先保存当前库，失败会回滚）。
- [`src/frontend/screens/editor/workspace/document/save/saver.ts`](../../src/frontend/screens/editor/workspace/document/save/saver.ts) 与 [`PlaybackProvider.tsx`](../../src/frontend/screens/editor/workspace/runtime/providers/PlaybackProvider.tsx)：桌面自动保存继续写 native recovery 表；Web 自动保存改为向当前谱面库提交一个安静的后台修订，不显示保存 toast、不清除未保存标记，成功后仍可手动保存。
- [`src/frontend/screens/editor/workspace/collaboration/RoomPanel.tsx`](../../src/frontend/screens/editor/workspace/collaboration/RoomPanel.tsx)：Web 宿主建房时显示“服务器地址”，不再显示只适用于桌面的 Tunnel/LAN 选项；Web 邀请链接生成当前页面 URL（`?join=1&server=…&invite=…&room=…`），浏览器可直接打开。
- `.github/workflows/pages.yml`：`npm run build:web` 后把 `dist/` 发布到 GitHub Pages。
- 第 1 节的宿主裁剪：窗口按钮、设置行、设置页、更新徽标和标题栏拖拽都已按宿主隐藏或禁用。

### 8.2 已验证

- Vite dev 的 `window.redux.library`：create、addAsset、assets、asset 字节、update、duplicate（含资源）、createRevision、revisions、revision、removeRevision、remove、list 全部通过。
- 导出的 1×1 PNG 资源通过 `asset` 读回，PNG header 正确；`background` 自动从 `cover.png` 推导。
- 刷新页面后项目仍在；`revision`、`group`、`background` 保留。
- 构建后的 `dist` 以 `/repo/` 子路径托管、没有 sidecar 时：首页谱面库可用；New chart 创建并保存 “Untitled chart”；返回首页能看到项目；刷新后项目仍在，并恢复编辑器会话。
- 两个标签页：只有一个标签页持有 `db.worker`；follower 能读取 leader 写入的项目；关闭 leader 后 follower 获得 Web Lock、启动自己的 worker、继续创建并保存项目。
- 备份/恢复：下载空库备份 → 创建 “Untitled chart” → 从空库备份恢复 → 刷新后谱面库回到空状态；备份文件通过 SQLite integrity check。
- schema 迁移：把 v1 `.sqlite`（`user_version=1`、无 `application_id`、无 `chart_hash`）从浏览器存储页恢复；迁移后 `application_id=1380992338`、`user_version=2`、`revisions.chart_hash` 和 `library_meta` 存在，项目和修订保留。
- 浏览器自动备份：创建谱面后等待去抖，OPFS `library-history/` 出现 ref/commit/objects；第二次修改后 ref 递增；提交对象是 gzip 封装的合法快照。
- 浏览器手动快照/恢复：两个命名谱面各写一个手动快照，校验无缺失对象，恢复到旧快照后首页只保留旧谱面；压缩后只保留最新提交。
- 浏览器快照设置：关闭“自动快照”后间隔输入被禁用、后台不再写入 ref；重新开启并设为 30 秒后，ref 恢复增长。
- 浏览器自动保存：把 `autosave-seconds` 设为 1 秒后编辑谱面，出现“Automatic backup saved”，未保存标记仍为真，刷新后编辑内容恢复；不再出现“仅桌面版支持自动备份”。
- Web 协作：两个独立 Chrome 配置连接本地 room server；Web 宿主填写服务器地址并建房，访客打开 `?join=1…` 邀请链接、确认身份并加入，收到同一谱面；访客放置 note 后宿主侧计数同步增加。
- Go 自动备份：20 秒去抖 + 120 秒最大延迟的策略在持续编辑测试中按最大延迟触发；快照、资产去重、偏好过滤、恢复、recovery 表保留、校验、压缩测试通过。
- `npm run check` 通过（1393 个单元/契约测试 + Go 测试）。

### 8.3 已知限制

- **follower 大资源走 BroadcastChannel。** 选主已经可用，但 follower 的请求和资源字节仍通过 BroadcastChannel 复制；大音乐会有额外拷贝。正式版应交换 `MessagePort` 并使用 transfer。
- **接管期间的在途请求没有自动重试。** leader 关闭时，follower 的未完成请求会等到 15 秒超时；调用方需要重试。
- **资源全量预取。** `BrowserLibrary.assets()` 为了给 `assets.uri` 提供同步值，会把项目里的所有资源读成 blob URL；大音乐会有内存峰值。正式版应改为按需解析或分块 BLOB I/O。
- **首页封面延迟。** 只有打开过一次的项目才会在本次页面里缓存封面；刷新后首页卡片暂时没有封面 URL。可以在 `list()` 里限量预取，或把封面加载改成异步。
- **持久化仍缺运维层。** 已有 `navigator.storage.persist()`、容量显示、`.sqlite` 下载/恢复、恢复失败回滚、迁移前原始副本、自动快照和自动快照开关；还没有库历史列表页、自动轮换/空间阈值、配额错误提示和完整的损坏检测入口。
- **Web 建房需要外部 room server。** Pages 只托管静态文件，不提供 WebSocket；建房时必须填写可达的 `ws://`/`wss://` 地址，且服务端要把 Pages 源加入 `REDUX_COLLAB_ALLOWED_ORIGINS`。加入别人房间不受此限制，只需邀请链接里的服务器可达。
- **未引用资源不回收。** 删除项目或提交新 manifest 后，孤立 BLOB 仍留在 SQLite 里；后续需要 GC 和 staging lease。
- **迁移器只覆盖 v0/v1 → v2。** 当前是加法迁移；后续 schema 需要继续追加步骤，并保持旧应用可读。
- **没有自动化 Store 测试。** 本文的 Playwright 验证仍在仓库外的临时目录，尚未转成 `src/test/` 下的回归用例；Go store 和 Rust 备份已有迁移测试。
- **浏览器覆盖有限。** 只在 Edge/Chromium 验证；Firefox/Safari 无痕模式、配额和大资源仍未测。
- **`serverOrigin()` 语义变化。** Web standalone 下返回 `opfs://rpe-redux`；任何假定它一定是 HTTP URL 的新代码都需要检查。
- **同源页面可访问浏览器库。** OPFS 和 BroadcastChannel 都以源为边界；`github.io` 同账号下的其他项目页可以读取 OPFS，也可以加入 leader 通道发 RPC。不要把不可信页面放在同一账号下；需要隔离时使用独立自定义域名。

### 8.4 下一步

1. 把 follower 资源传输改成 `MessagePort` + transferable，并给接管期间的请求加重试。
2. 补齐持久化运维：库历史设置页、自动轮换/空间阈值、配额错误提示和损坏检测。
3. 按需资源 URL：只预取图片，音乐走字节/分块；首页封面限量预取。
4. 把 Playwright 验证迁成仓库内回归测试，并补更多跨版本迁移回归。
5. 真实 GitHub Pages 部署和 Firefox/Safari 手测。

跨宿主的自动备份对象存储、squash、崩溃恢复、gzip 和迁移设计见 [谱面库自动备份：跨宿主快照存储与迁移设计](library-backup-snapshots-zh.md)。

## 9. 来源

### 仓库

- [`src/core/platform/environment.ts`](../../src/core/platform/environment.ts)
- [`src/frontend/app/App.tsx`](../../src/frontend/app/App.tsx)
- [`src/frontend/chrome/topbar/WindowControls.tsx`](../../src/frontend/chrome/topbar/windowControls/WindowControls.tsx)
- [`src/frontend/chrome/topbar/titleBar.less`](../../src/frontend/chrome/topbar/titleBar.less)
- [`src/core/settings/features/generalInterface.ts`](../../src/core/settings/features/generalInterface.ts)
- [`src/frontend/screens/settings/settingsCatalog.ts`](../../src/frontend/screens/settings/settingsCatalog.ts)
- [`src/core/global/library/client.ts`](../../src/core/global/library/client.ts)
- [`src/core/global/library/service.ts`](../../src/core/global/library/service.ts)
- [`src/backend/internal/store/store.go`](../../src/backend/internal/store/store.go)
- [`src/backend/internal/httpapi/api.go`](../../src/backend/internal/httpapi/api.go)
- [`vite.config.ts`](../../vite.config.ts)

### SQLite WASM / OPFS

- [SQLite WASM: Persistent Storage Options](https://sqlite.org/wasm/doc/trunk/persistence.md)
- [SQLite WASM: OPFS SyncAccessHandle Pool VFS](https://sqlite.org/wasm/doc/trunk/persistence.md#vfs-opfs-sahpool)
- [SQLite WASM: npm package](https://sqlite.org/wasm/doc/trunk/npm.md)
- [SQLite WASM: oo1 API](https://sqlite.org/wasm/doc/trunk/api-oo1.md)
- [wa-sqlite](https://github.com/rhashimoto/wa-sqlite)
- [SQLocal](https://sqlocal.dev/)
- [The Current State of SQLite Persistence on the Web (2026-05 update)](https://powersync.com/blog/sqlite-persistence-on-the-web)

### 浏览器存储

- [MDN: Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [MDN: StorageManager.persist()](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)
- [WebKit: Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [web.dev: Persistent storage](https://web.dev/articles/persistent-storage)

### GitHub Pages

- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)
- [Setting COOP/COEP on static hosting](https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/)
