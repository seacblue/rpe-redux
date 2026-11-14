# RPE Redux 错误层研究

## 结论

RPE Redux **不存在贯穿前端、Go 后端和 SQLite 的统一错误层**。仓库中存在几条质量不错、但彼此未合并的局部 seam：

1. Go HTTP API 使用 `error.code/message` 包络，前端使用 `LocalLibraryError(status/code/details)` 接收它。
2. `src/core/io/failures.ts` 提供本地持久化失败分类；它不负责用户文案或呈现。
3. 编辑器的 `createEditorFeedback().reportError()` 是最接近统一 UI 错误策略的入口，但只覆盖传入它的调用链。
4. `diagnosticCapture`、交互日志、backend trace 和诊断文件日志构成独立的观测链，不等于用户反馈链。
5. 原生文档读写另有 `DocumentError` + i18n 映射；它没有和 Go/SQLite 错误模型合并。

因此当前架构更准确的描述是：

```text
SQLite/Go 错误 -> Go 局部 HTTP 包络 -> LocalLibraryError -> 各调用方自行决定
                                      \\-> saver 的局部文案 / reportError / 直接 toast / inline

React 异常、Tauri 启动异常、原生文档异常、浏览器 SQLite 异常各有自己的局部路径
```

最小统一边界应放在“跨 host 的错误归一化 + 前端呈现策略”之间，而不是让 Go 直接依赖 React/i18n，也不是把 UI 错误处理放进 `core/global/chart`。

## 研究范围与证据规则

- 研究对象：`C:\\Users\\Administrator\\.codex\\worktrees\\error-layer-research\\RPE-Redux`。
- 证据：仓库源代码、仓库文档和仓库测试；没有使用外部资料，也没有把运行时猜测当作事实。
- 本次只读检查未运行会修改项目状态的开发/构建命令；仅新增本报告，不改产品源代码。
- 行号以本 worktree 当前文件为准。

## 1. 前端错误呈现盘点

### 1.1 Toast：有集中 host，没有集中策略

`src/design/patterns/ToastHost.tsx:126-130` 持有全局 toast store，`278-306` 导出 `showToast`，另有 `showStickyToast`（`389-408`）和 `showProgressToast`（`418-425`）。`191-227` 创建 toast，`209` 仅按调用方提供的 `key` 查找现有项；`269-276` 明确规定：没有 key 的相同通知会产生多行，有 key 才会合并。`481` 的 `setToastPolicy` 是全局准入钩子。

实际 producer 分散在多个产品层，典型错误/失败调用点如下：

| 领域 | 实际调用点 | 当前策略 |
| --- | --- | --- |
| 编辑器统一反馈 | `src/frontend/screens/editor/workspace/runtime/session/feedback.ts:94-99` | `reportError` 发送 error toast，随后发送 notice modal；没有 toast key |
| 协作 | `src/frontend/screens/editor/workspace/collaboration/collaborationRuntime.tsx:912,1401,1916,1977,2032,2317,2389,2509,2539,2571,2585` | 直接发送 error toast，通常自行决定 i18n 文案；不经过 `reportError`，多数不传 key |
| 历史/检查器 | `src/frontend/screens/editor/workspace/history/HistoryPanel.tsx:155-157`；`src/frontend/screens/editor/workspace/inspector/curveEvents/CurveEventsInspector.tsx:117,122,127,132,170` | 直接 toast；局部处理冲突/校验失败 |
| 欢迎页/导入 | `src/frontend/screens/welcome/externalImport.ts:418,432,453,462`；`editorHome.ts:99,105,168,296,394`；`peImport.ts:205,240,272,281`；`rpeImport.ts:107,235,330,339` | 直接 toast；导入链部分再由上层 `reportError` 处理异常 |
| 设置/皮肤/扩展 | `src/frontend/screens/settings/skin/SkinWorkbench.tsx:291,306,313,471`；`SkinSettings.tsx:146,153,208,221,227`；`CodeCellAccessControl.tsx:85,91`；`help/UpdateVerifyControl.tsx:34,40,46,48`；`SettingControl.tsx:275`；`help/DocsOpenControl.tsx:29`；`help/DeveloperSettings.tsx:226,232,250` | 直接 toast；`SkinWorkbench` 的导入流程使用 `key: "skin-workbench-import"`，是少数显式去重例子 |
| 保存/播放 | `src/frontend/screens/editor/workspace/document/save/saver.ts:113-119`；`PlaybackProvider.tsx:254`；`DocumentProvider.tsx:485,656,1251` | 进度 toast 由任务 owner 管理，失败时再由 owner 或调用方决定是否升级为错误反馈 |
| 状态栏/顶部栏/其他 | `src/frontend/chrome/statusbar/StatusBar.tsx:37`；`src/frontend/chrome/topbar/actions/helpActions.ts:21`；`src/frontend/screens/editor/workspace/stage/noteSource/noteSourceToastController.ts:82`；`SamplingInspector.tsx:89` | 直接调用，未共享错误分类或去重规则 |

`feedback.ts:23-28` 创建 editor feedback 时调用 `setToastPolicy({allowed:()=>true})`，这只是让该 feedback 的 toast 放行，不是全局重复提示策略。仓库中没有看到一个把所有上述 producer 约束到 `reportError` 的入口。

### 1.2 Modal：队列统一，错误语义不统一

`src/frontend/overlays/modals/modalQueue.ts:1-5` 把队列描述为有序、单 active modal 的共享队列；`34-64` 按 priority/arrival 排序，`47-64` 的同 id 替换是队列条目级别的行为。`src/frontend/overlays/modals/ModalHost.tsx:1-16` 是 shell 的统一 host。

但 `src/frontend/overlays/modals/prompts.ts:1-5`、`43-49`、`301-330` 的 `showNotice`/`requestChoice` 每次调用都会创建新的 identity 并 enqueue；它们知道“提示/选择”，不知道“同一个错误事件”。所以队列负责顺序，不负责错误去重、严重性归一化或重复 toast/modal 折叠。

实际错误/失败相关 modal 调用点包括：

- 编辑器反馈：`src/frontend/screens/editor/workspace/runtime/session/feedback.ts:65` 的存储失败备份选择；`78-89` 的备份成功/失败 notice；`95-99` 的通用失败 notice。
- 协作：`src/frontend/screens/editor/workspace/collaboration/collaborationRuntime.tsx:827,836,1567,1614,1669,1672,1678,1692,1701,1715,1753,1758,1802,1830,1848,1863,2227`，覆盖 session busy、冲突、连接、资源和锁状态等；调用点各自决定何时 showNotice/requestChoice。
- 外部资源/设置：`src/frontend/overlays/SessionPrompts.tsx:69`；`src/frontend/screens/settings/skin/SkinSettings.tsx:184`。

还有一条不经过 queue 的持久加载错误卡：`src/frontend/screens/editor/workspace/document/loading/ChartLoading.tsx:14-18` 直接使用 `Modal`。因此“单一 ModalHost”并不等于所有错误 modal 都走同一条策略。

### 1.3 Inline：组件集中，状态和文案分散

`src/design/components/alert/InlineAlert.tsx:1-8` 定义 panel/form/modal 可复用 primitive；`11-20` 接收 `tone/title/action`，`22-43` 对 danger 使用 `role=alert`，其他 tone 使用 status。它没有接入 toast severity、modal priority 或诊断 recorder。

实际使用点分布如下：

- 对话框/表单：`src/frontend/screens/editor/workspace/timingDetection/TimingDetectionDialog.tsx:58-60,74,88-90,191`、`chrome/transport/JumpToTimeDialog.tsx:186`、`editor/workspace/recording/RecordingPanel.tsx:654`。
- 协作：`editor/workspace/collaboration/RoomProgressDialog.tsx:217-219`、`collaboration/RoomPanel.tsx:363,559`。
- 检查器：`editor/inspector/events/shader/ShaderInspectorView.tsx:387-395`、`curveNotes/CurveFieldsView.tsx:251`、`inspector/bpm/BpmPanel.tsx:117-127,427,501`、`inspector/multiEdit/MultiEditForm.tsx:268-274`。
- 全局/设置：`global/sections/timing/GlobalTimingWorkspace.tsx:245`、`global/sections/assets/AssetsPanel.tsx:54-63`、`settings/files/FilesDataBackup.tsx:123-125,148`、`settings/extensions/ExtensionListView.tsx:309-311,317`、`ExtensionManager.tsx:33-35`、`settings/skin/SkinWorkbench.tsx:659-661,711`、`SkinSettings.tsx:328-330`。
- 共享 prompt shell：`src/frontend/overlays/modals/QueuedPrompt.tsx:113-157` 在 modal 内渲染 `InlineAlert`。

这些调用方自己保存 error state 和用户文案；同一失败若已在 inline 展示，其他路径仍可能再 toast 或 modal。没有跨 surface 的“已展示”状态。

### 1.4 ErrorBoundary/启动失败：是隔离屏，不是统一 error reporter

- `src/frontend/screens/editor/workspace/runtime/composition/EditorProviderTree.tsx:29-55` 的 `ProviderErrorBoundary` 把异常转成 `String(error)`，`componentDidCatch` 通过 `onError` 回传 stack，`136-148` 的 provider 构造失败也只是调用同一回调；`170-194` 将它包在 provider subtree 外。
- `src/frontend/screens/startup/StartupBoundary.tsx:14-33` 在 `getDerivedStateFromError`/`componentDidCatch` 中使用 `diagnosticText` 和 React component stack，之后在 `35-49` 渲染 `StartupView` 和 retry。
- `src/frontend/app/App.tsx:217-259` 的 backend 启动/准备失败进入 `StartupView(error, source, retry)`；`335-379` 将 `ModalHost`、`ChartLoading`、`ToastHost` 挂到 app tree。

两个 boundary 都有恢复/隔离作用，但没有把异常归一化成 `ErrorEnvelope`，也没有调用 editor `reportError`。因此 startup、provider render failure 与编辑器异步失败的用户文案、诊断、去重不一致。

### 1.5 静默 log 与诊断：有观测链，缺少呈现归属

`src/frontend/platform/diagnosticCapture.ts:17-26` 安装 `window.error` 和 `unhandledrejection` 记录，`46-55` 包装 `console.warn/error`，统一调用 `recordDiagnosticIssue` 后再保留原 console 行为。`src/core/diagnostics/interactionLog.ts:83` 是有界、脱敏的 issue 记录入口。`src/core/diagnostics/backendTrace.ts:70,106,142` 提供 backend operation trace；`src/core/global/library/http.ts:64,83-84,114-129` 记录 transport/HTTP trace。

但是下列失败仍直接 console/log，通常没有用户反馈：

- `src/frontend/platform/diagnosticLog.ts:31,45`：诊断日志写入/打开失败只再记录 issue 和 `console.error`。
- `src/frontend/app/App.tsx:238,319,324`、`src/frontend/screens/settings/SettingControl.tsx:112,324`、`src/frontend/screens/welcome/editorHome.ts:340`：局部 warn/error。
- 预览/扩展路径：`src/core/api/preview.ts:155`、`src/frontend/screens/editor/workspace/preview/scene/preview.ts:463`、`noiseFieldPipeline.ts:250,368,765`、`src/core/extensions/runtime.ts:14,22`、`extensionRuntime.ts:530,581,635,670,775,816,1000,1113,1269,1356`、`extensionLoader.ts:214,265,357,425,439,492,523,556,574,838,840,863,913`。
- 编辑器/平台底层：`src/core/edit/session/history.ts:493`、`src/core/edit/preview/api.ts:128`、`src/frontend/screens/editor/workspace/runtime/providers/PreviewProvider.tsx:280`、`src/frontend/screens/editor/workspace/runtime/composition/EditorAssembly.ts:646`、`src/frontend/screens/editor/workspace/session/workspaceSessionRuntime.ts:216`。

捕获 console 使其中一部分能进入诊断日志，但“被观察”不等于“已向用户解释”或“已经由错误策略去重”。

## 2. `reportError` 与重复提示

### 2.1 `reportError` 的实际策略

`src/frontend/screens/editor/workspace/runtime/session/feedback.ts:23-28` 创建反馈对象；`30-31` 从 `Error.message` 或 `String(error)` 得到 message；`41-49` 的 `reportError` 先忽略 `AbortError`，再调用 `recordDiagnosticIssue("error", "frontend", error, "editor.feedback")`。

之后有两条分支：

- 存储失败：现在发送左下角 error toast；“导出备份”作为 toast action 提供，导出成功/失败继续以 toast 呈现。
- 普通失败：发送一个带稳定 key 的 error/warning toast，不再额外发送 `showNotice` modal；stack 只进入诊断日志。

所以 `reportError` 现在是一条单主表面策略：错误统一走 toast，只有显式声明 inline owner 的进度/表单场景才由 inline surface 接管。

### 2.2 `alreadyOnLoadingCard` 的覆盖边界

`feedback.ts:33-39` 的 `alreadyOnLoadingCard(message)` 只在 `loadingProgress.getSnapshot()` 的 status 为 `"error"` 且 loading card 的 `state.error === message` 时返回 true。`41-49` 在记录 diagnostic issue 之后检查它；命中时不再写诊断文件、不再 toast、不再 notice。

这只去重一种具体链：加载任务已经由 `src/core/global/document/loading.ts:112-135` 发布失败，`src/frontend/screens/editor/workspace/document/loading/ChartLoading.tsx:38-85` 正在显示同一字符串，随后上层又把同一异常交给 `reportError`。它不去重：

- 同一个非加载操作产生的 toast + modal；
- 同 code 但不同英文/中文/装饰文本的异常；
- 不同 producer 对同一 backend operation 的重复报告；
- 已经在 `InlineAlert` 中显示的失败；
- storage 分支自身的重复 toast；现在由稳定 key 合并，备份导出也不再创建 choice modal。

### 2.3 Toast/modal 自身的去重

- Toast：`ToastHost.tsx:209` 只按稳定 `key` 合并；`269-276` 明确无 key 会留下多个 row。`reportError` 使用字符串形式的 `showToast`，不提供 key。直接 producer 大多也不提供 key；`SkinWorkbench` 的 `"skin-workbench-import"` 是可见例外。
- Modal：`modalQueue.ts:47-64` 的同 id 替换不是语义错误去重；`prompts.ts:43-49,301-330` 每次新建 identity，因此重复 `showNotice/requestChoice` 通常会排队。
- 保存：`saver.ts:113-119` 先创建进度 toast，`329-347` 失败时让它 fail 并 rethrow；若调用方随后调用 `reportError`，就会同时存在任务失败 toast 与通用错误 toast/modal。这不是 `alreadyOnLoadingCard` 能覆盖的场景。

结论是：当前有“加载卡字符串去重”和“调用方显式 toast key 合并”，没有按 `operation + normalized code + resource` 的统一错误事件去重。

## 3. Go/SQLite 到前端的传播链

### 3.1 Go store 如何产生错误

`src/backend/internal/store/store.go:28-46` 只暴露少量稳定类型：`ErrNotFound`、library/schema 识别错误和 `RevisionConflictError`。`137-179` 的 `Open` 配置 WAL、busy timeout、foreign keys、synchronous，ping/schema 初始化错误使用 `%w` 包上下文。大量 CRUD/事务路径（例如 `832-879`、`1053-1064`、`1182-1237`、`1450-1616`、`1943-1980`）把 SQLite 错误包成英文操作描述；除少量 `sql.ErrNoRows`/revision conflict 外，没有统一的 SQLite code/category 结果。

### 3.2 HTTP API 如何压缩 store 错误

`src/backend/internal/httpapi/api.go:266-284` 输出：

```json
{ "error": { "code": "...", "message": "..." } }
```

`286-310` 的 `writeStoreError` 只保留以下几类：

- `ErrNotFound` -> 404 `not_found`；
- `RevisionConflictError` -> 409 `revision_conflict`，附带 `currentRevision`；
- `isStorageError` -> 507 `storage_error`，文案为 `the local database could not be written`；
- 其他 -> 500 `internal_error`。

`313-328` 的 `isStorageError` 通过 lowercased `err.Error()` 匹配 `database or disk is full`、`no space left`、`disk i/o error`、`readonly database`、`unable to open database file`、`database is locked` 等字符串，而不是读取 SQLite 的稳定 typed code。结果是：Go 内部的具体操作和 SQLite 原因，大多在 HTTP 边界被压成 `internal_error` 或 `storage_error`。

流式 chart 路径另有局部映射：`src/backend/internal/httpapi/chart_stream.go:35-40` 定义 `errChartUnreadable/Changed/IndexStale`，`405-425` 映射为 `invalid_chart`、`chart_changed`、`chart_index_stale` 等；`commit_session.go:168-185,188-249,252-317` 又定义 `session_unavailable`、`invalid_chunk`、`invalid_commit` 等 session/chunk 错误。它们仍共享 JSON/frame 形状，但没有进入一个跨 operation 的统一 taxonomy。

### 3.3 桌面进程启动失败的另一条链

`src-tauri/src/services/server.rs:745-789` 将 Go stderr 接到 `<data_dir>/logs/backend.log`，readiness 失败会追加日志并返回 Rust `String`；`894-928` 在 backend 提前退出/health timeout 时返回带有 backend.log 指引的错误。

前端 `src/frontend/app/App.tsx:217-259` 捕获 `startBackend/prepareBackendInstance` 失败，保存 `diagnosticText(failure)` 并在 `StartupView` 展示。该启动错误不经过 HTTP `error.code`、`LocalLibraryError` 或 editor `reportError`，因此是跨层统一的明显断点。Go 侧也有只写日志、不回传 UI 的路径，例如 `src/backend/internal/collab/collab_persist.go:154-155` 和 `src/backend/internal/librarybackup/service.go:409-410`。

### 3.4 前端 HTTP transport 如何接收

`src/core/global/library/http.ts:27-52` 定义 `LocalLibraryError extends Error`，保留 `status/code/details`；`55-63` 统一 request 入口，`82-89` 把 transport failure 转成可达性错误，`90-110` 处理非 JSON/坏响应，`112-129` 读取 backend `error.code/message`。

其中只有 `storage_error` 被转换为 `t("system.library.storageError")`；其他 code 使用后端 message 或 `system.library.requestFailed` fallback。也就是说 `LocalLibraryError` 是结构化 transport error，不是完整的用户文案/呈现 error layer。

`src/core/global/library/client.ts:745-802` 的 asset fetch 和 `928-982` 的 commit stream 还有手写的 response/error 解码；这些路径会再次构造 `LocalLibraryError`，因此 transport 规范在 client 内存在重复实现。

保存链可具体追踪为：

```text
store.go CRUD/Commit
  -> httpapi/api.go:writeStoreError 或 chart/session 局部 writer
  -> core/global/library/http.ts:performRequest
  -> LocalLibraryError(status, code, details)
  -> core/global/library/save.ts:47-125（失败 rethrow，并清理 partial project）
  -> document/save/saver.ts:329-347（revision_conflict 有专门 i18n，其余多取 Error.message）
  -> DocumentProvider/EditorAssembly 的调用方
  -> 可能进入 feedback.ts:reportError，也可能只 fail progress toast 或直接显示本地错误
```

`saver.ts:165-180` 只特别处理 stale id 的 404，`329-347` 特别识别 `revision_conflict`；其他服务 code 没有中心化 code -> i18n key 映射。

### 3.5 浏览器 SQLite fallback

`src/core/platform/browser/library/db.worker.ts:320-324` 定义 worker `DbError`，`2662-2666` 序列化 `{ok:false,error:{code,message}}`；`browserLibrary.ts:63-72` 再把它变成 `LocalLibraryError` 并虚构 404/409/400 status。它与 Go HTTP 共享错误外形，却仍把 worker raw message 当主要文案。故这是 transport compatibility shim，而不是统一用户错误层。

## 4. 现有分类与 i18n 状态

### 4.1 已有的局部分类

`src/core/io/failures.ts:11-20` 定义 `StorageFailureKind`（not-found、permission、read-only、quota、unavailable、corrupt、busy、unknown），`22-29` 定义 `StorageFailure`，`31-54` 通过 code/message 表做分类，`88-143` 提供 retryable/isStorageFailure 判断。`src/core/platform/storageFailure.ts:1-14` 只是平台 re-export。

这是一个 host-independent 的存储恢复分类，能被 `feedback.ts:61-92` 使用，也被设置备份路径使用；它没有 operation、诊断 detail、用户 i18n key、呈现 intent，也不覆盖 validation/conflict/session/render 等所有错误。

原生文档则有另一套更完整的局部 seam：`src/core/platform/desktop/documentErrors.ts:8-16` 的 `DocumentError` 带 `code/solution/documentError`，`20-158` 建立 open/save code copy，`214-241` 用 `tRaw` 映射到本地化 copy；`src/core/platform/desktop/documentStore.ts:173-185` 在 open/save 边界调用它。这套 code/copy 未与 `LocalLibraryError`、Go code 或 storage taxonomy 合并。

### 4.2 i18n 和用户文案

`src/i18n/index.ts:1-12` 让 imperative/core 和 React 共用 `t()`；`80-109` 实现当前语言、英文 fallback 和 missing key fallback。`src/test/settings/i18n/i18nCatalogs.test.mjs:18-31,50-58` 检查中英文 key 与占位符 parity。

现有本地化覆盖是“按功能逐步补齐”，不是统一错误目录：

- service 基础文案在 `src/i18n/messages/en/system.ts:59-77` 以及对应中文 catalog；包括 unreachable、nonJsonResponse、requestFailed、storageError、notRunning。
- 保存/加载文案在 `src/i18n/messages/en/workspace.ts:13-26,51-79` 和 `src/i18n/messages/zh/workspace.ts:5-19,43-66`；revision conflict 有专门 key。
- native document open/save 在 `src/i18n/messages/en/documentErrors.ts:1-14` 及中文文件中维护。

但 Go API 直接发送英文 message，`http.ts:112-129` 对绝大多数 code 不做 code -> i18n 映射；`feedback.ts:30-31,94-99` 可能直接把 `Error.message` 放入 toast/modal。于是 `internal_error`、`invalid_commit`、`session_unavailable`、`chart_unreadable`、`chart_index_stale`、许多 validation/SQLite 操作错误可能把 backend/worker 英文原文显示给用户，或只得到一个通用 fallback。中英文 catalog parity 并不能弥补“错误 code 没有进入 catalog”的缺口。

## 5. 主要缺口

1. **没有共同的 machine error envelope。** Go store 的 typed/specific cause 在 HTTP writer 被少量 code 或字符串分类压缩；前端 native、browser worker、Go transport 又各自定义字段。
2. **没有共同的用户文案层。** `LocalLibraryError.code`、Go `code`、native `DocumentError.code`、storage kind 没有统一 code registry 和 i18n 映射；raw backend English message 仍可到达 UI。
3. **没有共同的呈现策略。** `reportError`、progress toast、direct toast、queued notice、loading modal、InlineAlert、startup screen 和 ErrorBoundary 各自决定 surface；ToastHost/ModalHost 只是 renderer/queue。
4. **去重粒度过窄。** `alreadyOnLoadingCard` 是 exact message + active loading state；toast key 和 modal id 依赖调用方；没有稳定 operation/resource/event key。
5. **诊断和用户反馈断开。** `recordDiagnosticIssue`/backend trace/console capture 能记录，但 direct console、Go log、startup error、boundary error 不一定得到可恢复的用户提示；反过来用户提示也不总带稳定 code/detail。
6. **错误 owner 不显式。** `quietToast`、save progress owner、caller `reportError` 的关系靠约定。保存失败可能先 fail progress toast，再被上层升级为通用 toast + modal。
7. **错误边界不完整。** React render boundary、Go 启动失败、HTTP 请求失败、SQLite worker、native document host 不是同一条链；同一类“本地数据不可用”在不同入口可得到不同 copy 和 surface。

## 6. 第一阶段实现与后续边界

本 worktree 已落地第一阶段切片：`src/core/contracts/failure.ts` 提供 host-independent 的 normalized failure record、稳定 dedupe key 和已接管呈现面的标记；`src/frontend/screens/editor/workspace/runtime/session/feedbackPolicy.ts` 将 backend/database code 映射为 i18n 文案、严重级和一个主呈现面；`feedback.ts` 保留诊断日志，存储失败的备份导出改为 toast action，并对重复反馈做短窗口去重。随后补齐了 Go HTTP envelope 的 `source/retryable` 字段、SQLite 未知错误的 `database_error` code，以及流式 library 请求对服务端错误 code 的保留；保存进度、协作进度和欢迎页导入调用也开始传递 owner/operation context。Go 启动失败、ToastHost、ModalHost、InlineAlert 和所有 `quietToast` producer 尚未整体迁移，仍需按调用点逐步接入。

后续统一层边界建议如下：

建议新增的最小抽象是一个 host-independent normalized failure record，加一个前端 policy adapter；保留现有 Toast/Modal/Inline/ChartLoading 作为渲染器：

```text
Go store / browser DB / Tauri document host / transport exception
    -> adapter: code, operation, category, retryable, safe details
    -> core normalized error record
    -> frontend i18n + presentation policy + dedupe key
    -> one chosen surface: InlineAlert | Toast | Modal | Loading card | Startup | diagnostic-only
```

边界职责应最小化为：

- `core` 只保存稳定 code/category、operation、retryability、resource identity、冲突 revision 等机器字段；不依赖 React/Tauri UI，不产生本地化文案。
- Go `store` 保留 typed SQLite/store causes；HTTP adapter 只把它们映射为稳定 code、HTTP status 和脱敏 details，不用 `err.Error()` 字符串作为主要 taxonomy。现有 `not_found`、`revision_conflict`、`storage_error` 可作为兼容初始集合。
- `src/core/global/library/http.ts`、`client.ts`、`browserLibrary.ts`、`documentErrors.ts` 都在边界上转成同一 normalized record；`StorageFailure` 作为 legacy/text fallback，而不是唯一总模型。
- 前端 adapter 将 known code 映射到 `i18n` key、solution/recovery action 和 presentation intent；unknown code 使用通用本地化文案，原始 backend message/detail 仅进诊断或显式 detail。
- `reportError`/新的 app feedback policy 负责一次选择主要 surface，并统一调用 diagnostics；调用方传入 operation/context，不再自行组合“toast + modal”。加载卡、表单 inline、进度任务、startup screen 可作为显式 owner/context。
- dedupe key 用 `operation + normalized code + resource identity`，而不是比较最终 message。`alreadyOnLoadingCard` 保留为 loading owner 的适配规则；ToastHost 的 `key` 和 modal queue 的 id 不应再承担全局语义去重。
- `quietToast` 改成显式的 presentation owner/progress surface 语义，不能表示“忽略错误”；当前普通保存失败已通过 failure marker 标记为 progress owner，静默 backup 则仍交给上层 feedback policy。

当前模型落在 `src/core/contracts/failure.ts`；后续可由 `src/core/global/library/*` 和 `src/core/platform/desktop/*` 做 transport/host adapter，再由 `src/frontend/.../feedbackPolicy.ts` 与 `feedback.ts` 做 i18n 和 surface policy。不要让 Go 依赖前端 catalog，也不要把 React 错误 policy 放到 chart rules/core global chart 中。

## 证据索引

- 编辑器 feedback 与加载去重：`src/frontend/screens/editor/workspace/runtime/session/feedback.ts`；`src/core/global/document/loading.ts`；`src/frontend/screens/editor/workspace/document/loading/ChartLoading.tsx`
- Toast：`src/design/patterns/ToastHost.tsx`
- Modal：`src/frontend/overlays/modals/modalQueue.ts`、`ModalHost.tsx`、`prompts.ts`、`QueuedPrompt.tsx`
- Inline：`src/design/components/alert/InlineAlert.tsx`
- ErrorBoundary/startup：`src/frontend/screens/startup/StartupBoundary.tsx`、`src/frontend/screens/editor/workspace/runtime/composition/EditorProviderTree.tsx`、`src/frontend/app/App.tsx`
- Go store/API：`src/backend/internal/store/store.go`、`src/backend/internal/httpapi/api.go`、`chart_stream.go`、`commit_session.go`
- 前端 local-library bridge：`src/core/global/library/http.ts`、`client.ts`、`save.ts`、`src/core/platform/browser/library/db.worker.ts`、`browserLibrary.ts`
- 分类与 native 文档：`src/core/io/failures.ts`、`src/core/platform/storageFailure.ts`、`src/core/platform/desktop/documentErrors.ts`
- i18n/诊断：`src/i18n/index.ts`、`src/i18n/messages/*`、`src/test/settings/i18n/i18nCatalogs.test.mjs`、`src/frontend/platform/diagnosticCapture.ts`、`diagnosticLog.ts`、`src/core/diagnostics/*`
