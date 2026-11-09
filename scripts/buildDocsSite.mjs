/**
 * Builds the static Extension SDK documentation site.
 *
 * The source of truth is `docs-sdk/`: locale-aware Markdown pages plus an
 * `index.json` tree and `locales.json` catalog. Generated tables are read from the runtime TypeScript
 * sources so capabilities, methods, design tokens, icons, and the declarative
 * UI contract cannot drift from the host. The output is a dependency-free SPA
 * shell with `content.json` and hand-written assets under `scripts/docsSite/`.
 */
/* eslint-disable max-lines -- parsing, rendering, validation, and the CLI stay in one dependency-free entry file. */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const DOCS_DIR = join(ROOT, "docs-sdk");
const TEMPLATE_DIR = join(ROOT, "scripts", "docsSite");
const BRAND_SOURCE = join(ROOT, "src-tauri", "icons", "128x128.png");
const DEFAULT_OUT = join(ROOT, "docs-site-dist");
const LOCALE_SOURCE = join(DOCS_DIR, "locales.json");
const DEFAULT_LOCALE = "zh";
let activeLocale = DEFAULT_LOCALE;
const CONTENT_VERSION = 3;
const DOCS_UPDATED = "2026-11-04";
const API_HANDLE_ORDER = Object.freeze([
  "chart",
  "transaction",
  "selection",
  "document",
  "library",
  "playback",
  "toolbar",
  "sidebar",
  "contextMenu",
  "settings",
  "values",
  "shortcuts",
  "diagnostics",
  "hitTest",
  "preview",
  "layout",
  "theme",
  "help",
  "ui",
  "events",
  "scripts",
  "storage",
  "timers",
  "styles",
]);
const API_HANDLE_LABELS = Object.freeze({
  chart: "谱面读取与对象定位",
  transaction: "事务写入与撤销历史",
  selection: "选区读取与修改",
  document: "文档生命周期",
  library: "曲库项目与资源",
  playback: "播放状态与预览帧",
  toolbar: "工具栏贡献",
  sidebar: "侧栏入口",
  contextMenu: "右键菜单",
  settings: "设置页贡献",
  values: "命名值与设置值",
  shortcuts: "快捷键",
  diagnostics: "诊断与跟踪",
  hitTest: "命中测试",
  preview: "预览快照",
  layout: "布局锚点",
  theme: "主题 token 快照",
  help: "帮助与教程",
  ui: "通知、对话框与表面注册",
  events: "宿主事件订阅",
  scripts: "脚本注册",
  storage: "扩展存储",
  timers: "宿主计时器",
  styles: "样式表",
});
const API_HANDLE_DESCRIPTIONS = Object.freeze({
  chart: "读取当前谱面的元数据、判定线、音符、事件和资源引用。",
  transaction: "用 preview/apply 提交批量修改，并进入撤销历史。",
  selection: "读取或替换用户当前选中的音符和事件。",
  document: "新建、打开、保存、关闭文档，以及读取文档状态。",
  library: "浏览曲库项目、资源和修订。",
  playback: "控制播放、跳转、倍速，读取预览帧和性能指标。",
  toolbar: "注册或查询工具栏动作。",
  sidebar: "注册并打开侧栏入口。",
  contextMenu: "注册对象或表面的右键菜单项。",
  settings: "注册设置页导航和设置行 schema；读写值用 values。",
  values: "声明、读取和写入包自己的可观察值。",
  shortcuts: "注册快捷键分类和命令；绑定本身通过 values 读写。",
  diagnostics: "读取诊断快照并控制跟踪开关。",
  hitTest: "对预览执行命中测试并读取几何信息。",
  preview: "读取预览快照，或订阅预览帧。",
  layout: "读取预览和面板的布局锚点，只读。",
  theme: "读取当前主题实际应用的设计 token，只读。",
  help: "打开帮助、更新日志和教程注册入口。",
});
const API_HANDLE_WHEN = Object.freeze({
  chart: "查找或展示谱面对象；不要直接改谱面，写入用 transaction。",
  transaction: "批量移动、修改或删除对象；单次放置也可先用 chart.placeNote。",
  selection: "对用户已经选中的对象做操作，或替用户建立选择。",
  document: "做文件入口、打开/保存流程，或读取当前文档身份。",
  library: "做曲库列表、导入导出和资源管理。",
  playback: "做播放控制、预览截图或播放性能测量。",
  toolbar: "给扩展添加一个常驻按钮或菜单动作。",
  sidebar: "给扩展添加一个常驻侧栏入口。",
  contextMenu: "给某类对象或表面增加右键动作。",
  settings: "让扩展出现在设置页；值本身交给 values。",
  values: "保存扩展设置、跨脚本共享状态，或订阅值变化。",
  shortcuts: "给扩展命令添加可改键的快捷方式。",
  diagnostics: "开发调试或让用户导出诊断信息。",
  hitTest: "把自定义 UI 对准预览里的音符、事件或判定线。",
  preview: "做画中画或叠加层，需要读取当前预览内容时。",
  layout: "把浮层贴到宿主面板或预览区域，不需要修改宿主 DOM。",
  theme: "让扩展颜色、圆角和间距跟随当前主题。",
  help: "从扩展里打开帮助页面或注册自己的教程。",
});
/** Common public types that have a section in the types guide. */
const TYPE_LINKS = Object.freeze({
  ChartReadCollection: "chartreadcollection",
  ChartReadPage: "chartreadpage",
  ChartReadItem: "chartreaditem",
  ChartReadMeta: "chartreadmeta",
  ChartTarget: "charttarget",
  ChartTargetPoint: "charttargetpoint",
  ChartNoteType: "chartnotetype",
  ChartObjectId: "chartobjectid",
  ChartReadLine: "chartreadline",
  ChartReadNote: "chartreadnote",
  ChartReadEvent: "chartreadevent",
  ChartReadSnapshot: "chartreadsnapshot",
  ChartReadState: "chartreadstate",
  ActionResult: "actionresult",
  ApiResult: "apiresult",
  ApiAvailability: "apiavailability",
  ExtensionThemeTokens: "extensionthemetokens",
  SettingDefinition: "settingdefinition",
});
/** Modal content for public data structures; definitions stay useful without source access. */
const TYPE_DETAILS = Object.freeze({
  chartreadcollection: {
    name: "ChartReadCollection",
    summary: "分页读取的谱面集合名称。",
    source: "src/core/api/chart.ts",
    definition: '"metadata" | "lines" | "notes" | "events"',
  },
  chartreadpage: {
    name: "ChartReadPage<T>",
    summary: "带有不透明游标的谱面分页结果。",
    source: "src/core/api/chart.ts",
    definition:
      '{ status: "ok" | "stale_read" | "invalid_request"; items: T[]; nextCursor: string | null }',
  },
  chartreaditem: {
    name: "ChartReadItem",
    summary: "分页读取结果中的谱面对象联合类型。",
    source: "src/core/api/chart.ts",
    definition: "ChartReadMeta | ChartReadLine | ChartReadNote | ChartReadEvent",
  },
  chartreadmeta: {
    name: "ChartReadMeta",
    summary: "谱面 META 的只读快照。",
    source: "src/core/api/chart.ts",
    definition:
      "{ name?: string; song?: string; composer?: string; charter?: string; level?: string; ... }",
  },
  charttarget: {
    name: "ChartTarget",
    summary: "chart.placeNote 使用的判定线与头尾拍坐标。",
    source: "src/core/api/chart.ts",
    definition:
      "{ lineIndex: number; from: ChartTargetPoint; to?: ChartTargetPoint; layer?: number; eventType?: string }",
  },
  charttargetpoint: {
    name: "ChartTargetPoint",
    summary: "以拍和横向坐标表示的谱面位置。",
    source: "src/core/api/chart.ts",
    definition: "{ beat: number; positionX: number }",
  },
  chartnotetype: {
    name: "ChartNoteType",
    summary: "放置音符时使用的稳定数字类型。",
    source: "src/core/api/chart.ts",
    definition: "1 | 2 | 3 | 4 // Tap | Hold | Flick | Drag",
  },
  chartobjectid: {
    name: "ChartObjectId",
    summary: "判定线、音符和事件的稳定字符串标识。",
    source: "src/core/api/chart.ts",
    definition: "string",
  },
  chartreadline: {
    name: "ChartReadLine",
    summary: "一条判定线及其只读音符、事件层和基础几何。",
    source: "src/core/api/chart.ts",
    definition: "{ id: ChartObjectId; index: number; notes: ChartReadNote[]; eventLayers: ... }",
  },
  chartreadnote: {
    name: "ChartReadNote",
    summary: "音符的只读快照，可用于构造 id 地址化 patch。",
    source: "src/core/api/chart.ts",
    definition:
      "{ id: ChartObjectId; type: ChartNoteType; startBeat: number; positionX: number; ... }",
  },
  chartreadevent: {
    name: "ChartReadEvent",
    summary: "事件轨道中的只读事件快照。",
    source: "src/core/api/chart.ts",
    definition:
      "{ id: ChartObjectId; lineId: ChartObjectId; eventType: string; startBeat: number; endBeat: number; ... }",
  },
  chartreadsnapshot: {
    name: "ChartReadSnapshot",
    summary: "一次性分析用的冻结谱面副本。",
    source: "src/core/api/chart.ts",
    definition: "{ fingerprint: string; metadata: ChartReadMeta; lines: ChartReadLine[]; ... }",
  },
  chartreadstate: {
    name: "ChartReadState",
    summary: "用于判断读写是否基于同一谱面修订的指纹与代数。",
    source: "src/core/api/chart.ts",
    definition: "{ chartFingerprint: string; generation: number }",
  },
  actionresult: {
    name: "ActionResult<T>",
    summary: "放置或提交动作的领域结果。",
    source: "src/core/edit/operations/result.ts",
    definition:
      '{ status: "committed" | "unchanged" | "rejected" | "unavailable"; value?: T; issues?: ... }',
  },
  apiresult: {
    name: "ApiResult<T>",
    summary: "公开 API 的成功或失败包络；先判断 ok。",
    source: "src/core/api/contract.ts",
    definition:
      "{ ok: true; value: T } | { ok: false; error: { code: string; message: string; details?: unknown } }",
  },
  apiavailability: {
    name: "ApiAvailability",
    summary: "运行时是否已挂载的结构化状态。",
    source: "src/core/api/contract.ts",
    definition:
      '{ status: "available" | "unavailable"; error?: { code: string; message: string } }',
  },
  extensionthemetokens: {
    name: "ExtensionThemeTokens",
    summary: "宿主当前实际应用的主题身份、颜色、间距、字体、阴影和动效。",
    source: "src/core/api/theme.ts",
    definition: "{ theme; colors; radii; spacing; fonts; shadows; motion }",
  },
  settingdefinition: {
    name: "SettingDefinition",
    summary: "设置页一行的 schema；值由 values handle 负责读写。",
    source: "src/core/settings/types.ts",
    definition:
      "{ key; navigation; group; label; description; control; default; min?; max?; step? }",
  },
});
/** Context helpers that are not `context.api` handles. */
const CONTEXT_GROUPS = Object.freeze([
  ["scripts", "scripts — 注册命令", "注册脚本、参数和默认快捷键。"],
  ["ui", "ui — 通知与表面", "通知、确认、输入、选择、引导、面板、侧栏和覆盖层。"],
  ["events", "events — 宿主事件", "订阅固定白名单内的宿主事件。"],
  ["hooks", "hooks — 公开语义 Hook", "发布或调用命名空间化、JSON 安全的跨扩展 Hook。"],
  ["settings", "settings — 简单设置存储", "包私有的字符串键值，不注册设置页。"],
  ["storage", "storage — JSON 存储", "包私有的 JSON 键值，适合任意缓存和迁移数据。"],
  ["timers", "timers — 计时器", "宿主计时器；沙箱不提供全局计时器。"],
  ["styles", "styles — 样式表", "添加只作用于本扩展表面的 CSS。"],
]);

const ATTRIBUTE_NAMES = new Set([
  "availability",
  "state",
  "snapshot",
  "fingerprint",
  "metadata",
  "resources",
  "lines",
  "notes",
  "events",
  "history",
  "inspect",
  "textures",
  "frames",
  "metrics",
  "tokens",
  "enabled",
  "anchors",
  "geometry",
]);
const METHOD_SUMMARY_OVERRIDES = Object.freeze({
  "theme.tokens": "返回当前主题实际应用的设计 token 快照。",
  "theme.subscribe": "订阅主题或密度变化，变化时调用监听器。",
  "storage.getJSON": "按 key 读取并解析 JSON 值。",
  "storage.setJSON": "序列化并保存 JSON 值。",
  "sidebar.open": "运行侧栏入口，并打开其 panelId 对应的面板。",
  "sidebar.close": "关闭当前由侧栏入口打开的面板。",
  "ui.registerPanel": "注册一个扩展面板。",
  "ui.registerSidebar": "注册侧栏图标或分隔线。",
  "ui.registerOverlay": "注册舞台或窗口覆盖层。",
  "chart.state": "读取谱面指纹和修订代数。",
  "chart.lines": "读取按谱面顺序排列的全部判定线。",
  "transaction.preview": "预览一次事务，返回 previewId 或拒绝原因。",
  "transaction.apply": "应用预览过的事务，并写入撤销历史。",
  "selection.state": "读取当前选中的音符和事件。",
  "document.state": "读取当前文档状态和身份。",
  "playback.state": "读取播放状态、时间和速率。",
  "library.scope": "打开一个曲库项目作用域句柄。",
  "values.byId.subscribe": "订阅一个命名值的变化。",
  "values.byId.snapshot": "读取本包命名值的快照。",
  "ui.notice": "显示一条官方通知。",
  "ui.progress": "显示可更新的长任务进度。",
  "ui.select": "显示一个官方选择框。",
});
const PARAM_RULES = Object.freeze({
  read: [["collection", "ChartReadCollection", "", "是", "要读取的集合名"]],
  line: [["id", "ChartObjectId", "", "是", "判定线 id"]],
  parentId: [["id", "ChartObjectId", "", "是", "音符、事件或判定线 id"]],
  note: [["id", "ChartObjectId", "", "是", "音符 id"]],
  event: [["id", "ChartObjectId", "", "是", "事件 id"]],
  placeNote: [
    ["type", "ChartNoteType", "", "是", "1 = Tap，2 = Hold，3 = Flick，4 = Drag"],
    ["target", "ChartTarget", "", "是", "放置目标：判定线、起点、终点和可选层级"],
  ],
  apply: [["request", "ChartTransactionRequest | string", "", "是", "事务请求或 previewId"]],
  preview: [["request", "ChartTransactionRequest", "", "是", "事务请求"]],
  cancel: [["previewId", "string", "", "是", "预览 id"]],
  paste: [["request", "SelectionPasteRequest", "", "否", "粘贴请求"]],
  "notes.select": [["request", "NoteSelectionRequest", "", "是", "音符选择请求"]],
  "notes.range": [["request", "NoteSelectionRangeRequest", "", "是", "音符范围请求"]],
  "events.select": [["request", "EventSelectionRequest", "", "是", "事件选择请求"]],
  "events.range": [["request", "EventSelectionRangeRequest", "", "是", "事件范围请求"]],
  "selection.notes.select": [["request", "NoteSelectionRequest", "", "是", "音符选择请求"]],
  "selection.notes.range": [["request", "NoteSelectionRangeRequest", "", "是", "音符范围请求"]],
  "selection.events.select": [["request", "EventSelectionRequest", "", "是", "事件选择请求"]],
  "selection.events.range": [["request", "EventSelectionRangeRequest", "", "是", "事件范围请求"]],
  create: [["options", "CreateDocumentOptions", "", "否", "新建文档选项"]],
  openPath: [
    ["path", "string", "", "是", "文档路径"],
    ["options", "DocumentActionOptions", "", "否", "打开选项"],
  ],
  openBytes: [
    ["bytes", "Uint8Array", "", "是", "文档字节"],
    ["options", "OpenBytesOptions", "", "否", "打开选项"],
  ],
  save: [["options", "SaveDocumentOptions", "", "否", "保存选项"]],
  close: [["options", "DocumentActionOptions", "", "否", "关闭选项"]],
  list: [["query", "ListQuery", "", "否", "分页和过滤条件"]],
  get: [["id", "string", "", "是", "对象 id"]],
  scope: [["id", "string", "", "是", "曲库项目 id"]],
  createRaw: [["input", "unknown", "", "是", "序列化后的项目数据"]],
  update: [["patch", "unknown", "", "是", "要修改的字段"]],
  remove: [["id", "string", "", "是", "对象 id"]],
  duplicate: [
    ["id", "string", "", "是", "源对象 id"],
    ["name", "string", "", "否", "副本名称"],
  ],
  assets: [["options", "RequestOptions", "", "否", "资源查询选项"]],
  asset: [
    ["name", "string", "", "是", "资源名"],
    ["options", "RequestOptions", "", "否", "资源选项"],
  ],
  addAsset: [
    ["name", "string", "", "是", "资源名"],
    ["bytes", "Uint8Array", "", "是", "资源字节"],
  ],
  removeAsset: [["name", "string", "", "是", "资源名"]],
  revisions: [["query", "unknown", "", "否", "修订查询"]],
  createRevision: [["input", "unknown", "", "是", "修订内容"]],
  revision: [["revisionId", "string", "", "是", "修订 id"]],
  removeRevision: [["revisionId", "string", "", "是", "修订 id"]],
  seek: [["seconds", "number", "", "是", "目标时间（秒）"]],
  seekBeat: [["beat", "number", "", "是", "目标拍"]],
  setRate: [["rate", "number", "", "是", "播放倍率"]],
  renderAt: [["time", "number", "", "是", "渲染时间（秒）"]],
  register: [["entry", "object", "", "是", "要注册的条目"]],
  unregister: [["id", "string", "", "是", "要移除的条目 id"]],
  registerDivider: [["divider", "object", "", "是", "分隔线描述"]],
  registerAll: [["entries", "readonly object[]", "", "是", "要注册的条目数组"]],
  open: [["id", "string", "", "是", "侧栏项或面板 id"]],
  subscribe: [["listener", "() => void", "", "是", "变化监听器"]],
  entry: [["id", "string", "", "是", "条目 id"]],
  available: [["action", "ToolbarAction", "", "是", "要查询的动作"]],
  bindings: [["action", "ToolbarAction", "", "是", "要查询的动作"]],
  shortcutText: [["action", "ToolbarAction", "", "是", "要查询的动作"]],
  registerNavigation: [["navigation", "SettingsNavigation", "", "是", "设置页导航"]],
  registerSetting: [["definition", "SettingDefinition", "", "是", "设置行定义"]],
  define: [["definition", "PublicValueDefinition", "", "是", "值定义"]],
  getHandle: [["id", "string", "", "是", "值 id"]],
  has: [["id", "string", "", "是", "值 id"]],
  ownerOf: [["id", "string", "", "是", "值 id"]],
  set: [
    ["id", "string", "", "是", "对象或值的 id"],
    ["value", "unknown", "", "是", "要写入的值"],
  ],
  subscribeAll: [["listener", "() => void", "", "是", "变化监听器"]],
  registerCategory: [["category", "ShortcutCategory", "", "是", "快捷键分类"]],
  registerShortcut: [["definition", "ShortcutDefinition", "", "是", "快捷键定义"]],
  "trace.setEnabled": [["enabled", "boolean", "", "是", "是否启用跟踪"]],
  "diagnostics.trace.setEnabled": [["enabled", "boolean", "", "是", "是否启用跟踪"]],
  pick: [["request", "HitTestRequest", "", "是", "命中测试请求"]],
  on: [
    ["name", "string", "", "是", "事件名"],
    ["callback", "(payload: unknown) => void", "", "是", "事件处理函数"],
    ["priority", "number", "", "否", "订阅优先级"],
  ],
  setTimeout: [
    ["callback", "() => void", "", "是", "回调"],
    ["delay", "number", "", "是", "毫秒延迟"],
  ],
  setInterval: [
    ["callback", "() => void", "", "是", "回调"],
    ["delay", "number", "", "是", "毫秒间隔"],
  ],
  requestAnimationFrame: [["callback", "FrameRequestCallback", "", "是", "帧回调"]],
  clearTimeout: [["handle", "TimerHandle", "", "是", "计时器句柄"]],
  clearInterval: [["handle", "TimerHandle", "", "是", "计时器句柄"]],
  cancelAnimationFrame: [["handle", "number", "", "是", "帧句柄"]],
  notice: [
    ["message", "ExtensionText", "", "是", "通知文本"],
    ["options", "ScriptUiNoticeOptions", "", "否", "通知选项"],
  ],
  progress: [
    ["title", "ExtensionText", "", "是", "进度标题"],
    ["totalSteps", "number", "", "否", "总步数"],
  ],
  confirm: [["message", "ExtensionText", "", "是", "确认文案"]],
  input: [["options", "ScriptUiInputOptions", "", "是", "输入框选项"]],
  select: [["options", "ScriptUiSelectOptions", "", "是", "选择框选项"]],
  guide: [["options", "ScriptUiGuideOptions", "", "是", "引导选项"]],
  registerPanel: [["definition", "SandboxPanelDefinition", "", "是", "面板定义"]],
  registerSidebar: [["definition", "SandboxSidebarDefinition", "", "是", "侧栏定义"]],
  registerOverlay: [["definition", "SandboxOverlayDefinition", "", "是", "覆盖层定义"]],
  add: [["cssText", "string", "", "是", "CSS 文本"]],
  "settings.get": [["key", "string", "", "是", "设置 key"]],
  "settings.set": [
    ["key", "string", "", "是", "设置 key"],
    ["value", "string", "", "是", "设置值"],
  ],
  "settings.delete": [["key", "string", "", "是", "设置 key"]],
  "storage.get": [["key", "string", "", "是", "存储 key"]],
  "storage.set": [
    ["key", "string", "", "是", "存储 key"],
    ["value", "string", "", "是", "字符串值"],
  ],
  "storage.delete": [["key", "string", "", "是", "存储 key"]],
  "storage.getJSON": [["key", "string", "", "是", "存储 key"]],
  "storage.setJSON": [
    ["key", "string", "", "是", "存储 key"],
    ["value", "unknown", "", "是", "JSON 值"],
  ],
  "library.update": [
    ["id", "string", "", "是", "项目 id"],
    ["patch", "ProjectPatch", "", "是", "项目补丁"],
  ],
  "contextMenu.update": [["entry", "ContextMenuItem", "", "是", "替换后的菜单行"]],
  "document.close": [["options", "DocumentActionOptions", "", "否", "关闭选项"]],
  "sidebar.close": [["id", "string", "", "是", "要关闭的侧栏项 id"]],
  "toolbar.get": [],
  "sidebar.get": [],
  "contextMenu.get": [],
  "values.byId.update": [
    ["id", "string", "", "是", "值 id"],
    ["partial", "unknown", "", "是", "部分更新内容"],
  ],
  "values.byId.set": [
    ["id", "string", "", "是", "值 id"],
    ["value", "unknown", "", "是", "新值"],
  ],
  "values.byId.subscribe": [
    ["id", "string", "", "是", "值 id"],
    ["listener", "() => void", "", "是", "变化监听器"],
  ],
});
const RETURN_RULES = Object.freeze({
  availability: "返回 `ApiAvailability`，说明运行时是否连接。",
  state: "返回当前状态对象。",
  snapshot: "返回只读快照。",
  tokens: "返回 `ExtensionThemeTokens`，包含主题、颜色、圆角、间距、字体、阴影和动效。",
  subscribe: "返回 disposer；沙箱中解析为 `() => void`。",
  getJSON: "返回解析后的 JSON 值；缺失或损坏时返回 `null`。",
  setJSON: "写入成功时解析为 `void`。",
  notice: "返回 `void`；通知由宿主挂载。",
  progress: "返回 `{ update, close }` 进度句柄。",
  confirm: "返回 `Promise<boolean>`。",
  input: "返回 `Promise<string | null>`；取消时为 `null`。",
  select: "返回 `Promise<string | null>`；取消时为 `null`。",
  guide: "返回 `Promise<{ status, values }>`。",
  "chart.state": "`value` 包含谱面指纹和修订代数。",
  "chart.read":
    "`value.status` 为 `ok` 时读 `items` 和 `nextCursor`；`stale_read` 表示读取期间谱面已变化。",
  "chart.snapshot": "`value` 是整张谱面的冻结副本；没有打开谱面时为 `null`。",
  "chart.metadata": "`value` 是元数据；没有打开谱面时为 `null`。",
  "chart.resources": "`value` 是资源引用数组。",
  "chart.lines": "`value` 是按谱面顺序排列的判定线数组。",
  "chart.line": "`value` 是判定线；id 未知时为 `null`。",
  "chart.notes": "`value` 是带所属线和索引的音符引用数组。",
  "chart.note": "`value` 是音符引用；id 未知时为 `null`。",
  "chart.events": "`value` 是带所属线和轨道的能量事件引用数组。",
  "chart.event": "`value` 是事件引用；id 未知时为 `null`。",
  "chart.placeNote":
    "`value.status` 为 `committed` 时表示音符已写入；`unchanged`、`rejected`、`unavailable` 时没有写入。",
  "transaction.preview":
    "`value.status` 为 `previewed` 时，才能把 `previewId` 交给 `transaction.apply`。",
  "transaction.apply": "`value.status` 为 `committed` 时表示已提交并进入撤销历史。",
  "values.byId.get": "直接返回值本身的快照，不包 `ApiResult`。",
  "values.byId.set": "写入成功时完成；值定义中的规则会在写入前校验。",
  "theme.tokens": "沙箱中返回 `Promise<ExtensionThemeTokens>`。",
  "theme.subscribe": "沙箱中返回 `void`；订阅随本次激活结束自动释放。",
  "layout.anchors": "`value` 是只读锚点数组，可用于定位自定义浮层。",
  "hitTest.pick": "`value` 是命中结果；没有命中时按方法说明返回空值。",
  "preview.snapshot": "`value` 是当前预览快照，没有预览时可能为 `null`。",
  "selection.state": "`value` 是当前选中的音符和事件引用。",
  "document.state": "`value` 是当前文档状态。",
});
const RETURN_TYPES = Object.freeze({
  "chart.state": "ApiResult<ChartReadState>",
  "chart.read": "ApiResult<ChartReadPage<ChartReadItem>>",
  "chart.snapshot": "ApiResult<ChartReadSnapshot | null>",
  "chart.metadata": "ApiResult<ChartReadMeta | null>",
  "chart.resources": "ApiResult<readonly ChartResourceReference[]>",
  "chart.lines": "ApiResult<readonly ChartReadLine[]>",
  "chart.line": "ApiResult<ChartReadLine | null>",
  "chart.notes": "ApiResult<readonly ChartNoteReadRef[]>",
  "chart.note": "ApiResult<ChartNoteReadRef | null>",
  "chart.events": "ApiResult<readonly ChartEventReadRef[]>",
  "chart.event": "ApiResult<ChartEventReadRef | null>",
  "chart.placeNote": "ApiResult<ActionResult<ChartReadNote>>",
  "transaction.preview": "ApiResult<ChartTransactionPreviewResult>",
  "transaction.apply": "ApiResult<ChartTransactionResult>",
  "values.byId.get": "Promise<T>",
  "values.byId.set": "Promise<void>",
  "theme.tokens": "Promise<ExtensionThemeTokens>",
  "layout.anchors": "ApiResult<readonly LayoutAnchor[]>",
  "hitTest.pick": "ApiResult<HitTestResult>",
  "preview.snapshot": "ApiResult<PreviewSnapshot | null>",
  "selection.state": "ApiResult<SelectionSnapshot>",
  "document.state": "ApiResult<DocumentState>",
});
const SAMPLE_VALUES = Object.freeze({
  id: '"item-id"',
  collection: '"lines"',
  type: "1",
  target: "{ lineIndex: 0, from: { beat: 0, positionX: 0 } }",
  request: "{}",
  previewId: '"preview-id"',
  options: "{}",
  path: '"chart.rpe"',
  bytes: "new Uint8Array()",
  query: "{}",
  input: "{}",
  patch: "{}",
  name: '"item"',
  revisionId: '"revision-id"',
  seconds: "0",
  beat: "0",
  rate: "1",
  time: "0",
  entry: "{}",
  entries: "[]",
  divider: "{}",
  listener: "() => {}",
  action: "{}",
  navigation: "{}",
  definition: "{}",
  category: "{}",
  enabled: "true",
  callback: "() => {}",
  delay: "1000",
  handle: "0",
  message: '"Hello"',
  title: '"Example"',
  totalSteps: "1",
  cssText: '""',
  key: '"config"',
  value: "value",
});

const GUIDE_PAGE_SECTIONS = Object.freeze([
  "用途",
  "签名",
  "最小示例",
  "进阶用法",
  "权限与上限",
  "错误与恢复",
  "相关接口",
]);
const GUIDE_PAGE_SLUGS = new Set([
  "ui-reference",
  "panels-and-menus",
  "persistence",
  "api-reference",
  "capabilities",
]);
const GUIDE_PAGE_SECTIONS_EN = Object.freeze([
  "Purpose",
  "Signature",
  "Minimal example",
  "Advanced use",
  "Permissions and limits",
  "Errors and recovery",
  "Related APIs",
]);

/** Host capabilities whose one-line documentation is required. */
const CAPABILITY_DESCRIPTIONS = Object.freeze({
  scripts: "注册并运行包内脚本（命令、快捷键和菜单动作）。",
  "chart.read": "读取谱面元数据、判定线、音符、事件和资源引用。",
  "chart.write": "通过事务写入谱面，不直接修改谱面对象。",
  "selection.read": "读取当前选中的音符和事件。",
  "selection.write": "修改选区（复制、剪切、删除、粘贴、范围选择）。",
  "document.read": "读取文档状态、快照和指纹。",
  "document.write": "新建、打开、保存或关闭文档（敏感）。",
  "library.read": "读取曲库项目、资源与修订。",
  "library.write": "创建、更新、删除曲库项目与修订（敏感）。",
  "assets.write": "向项目添加或移除资源（敏感）。",
  "playback.read": "读取播放状态、帧、纹理和性能指标。",
  "playback.control": "控制播放、跳转、倍速、渲染和测量。",
  "ui.notice": "显示官方通知和进度条。",
  "ui.dialog": "显示确认、输入、选择和引导对话框（敏感）。",
  "ui.guide": "打开帮助、更新日志和教程入口（敏感）。",
  "ui.panel": "注册并打开扩展自己的面板。",
  "ui.sidebar": "注册侧栏图标入口。",
  "ui.overlay": "注册舞台或窗口覆盖层。",
  "ui.toolbar": "注册工具栏条目。",
  "ui.contextMenu": "注册右键菜单行。",
  shortcuts: "注册快捷键类别与绑定。",
  "shortcuts.read": "读取宿主快捷键绑定文本（只读附加能力）。",
  settings: "注册设置页导航和设置行 schema。",
  hooks: "注册并调用带命名空间、优先级和取消语义的公开 Hook。",
  values: "声明并读写包自己的值；宿主值只读。",
  storage: "读写包私有的字符串存储。",
  events: "订阅固定白名单内的宿主事件。",
  services: "提供或消费带版本、生命周期和 epoch 的扩展服务。",
  styles: "注入所有者作用域的样式表。",
  timers: "使用宿主计时器（64 个上限，16 ms 下限）。",
  diagnostics: "读取诊断快照并控制跟踪。",
  "preview.read": "读取预览几何、命中测试和布局锚点。",
  "host.patch": "已退役，仅保留旧清单解析，不授予任何权限。",
});

/** Human labels for the three consent risk tiers. */
const RISK_LABELS = Object.freeze({
  read: "读取",
  write: "写入",
  sensitive: "敏感",
});

/** One tag in the declarative tree and its intended use. */
const TAG_DESCRIPTIONS = Object.freeze({
  div: "通用布局容器",
  span: "行内文本或标记",
  p: "段落",
  h1: "页面主标题",
  h2: "一级章节标题",
  h3: "二级章节标题",
  h4: "三级章节标题",
  section: "有语义的分组",
  label: "表单标签，包裹控件或 for 语义",
  strong: "强调文本",
  em: "语气强调",
  img: "内联图片（仅 data/blob 源）",
  button: "按钮，宿主渲染为官方 Button",
  input: "输入控件，宿主按 type 渲染官方控件",
  select: "下拉选择，宿主渲染为官方 Select",
  option: "select 的选项",
});

/** One allowed attribute and its contract. */
const ATTR_DESCRIPTIONS = Object.freeze({
  alt: "图片替代文本",
  src: "图片 data/blob 源",
  placeholder: "输入占位文本",
  min: "数字/范围最小值",
  max: "数字/范围最大值",
  step: "数字/范围步长",
  value: "输入或选项的初始值",
  checked: "复选框初始勾选状态",
  disabled: "禁用控件和焦点",
  accept: "文件选择的接受类型提示",
  role: "ARIA 角色",
  "aria-label": "控件的可访问名称",
  "aria-hidden": "从辅助技术隐藏装饰节点",
  "aria-describedby": "关联说明节点的 id",
  "data-tip-title": "官方 tooltip 短标题",
  "data-tip-desc": "官方 tooltip 说明",
  "data-tip-key": "官方 tooltip 快捷键提示",
  type: "input 的控件类型",
  action: "按钮动作；目前支持 pick-image",
  maxBytes: "图片选择的最大字节数",
});

/** Curated design-token table groups validated against the source sheets. */
const TOKEN_GROUPS = Object.freeze([
  {
    title: "颜色、表面与文字",
    tokens: [
      ["--surface", "应用和主面板底色"],
      ["--surface-raised", "卡片和浮起表面"],
      ["--surface-muted", "次级块和空态表面"],
      ["--surface-hover", "悬停填充"],
      ["--surface-sunken", "下沉区域"],
      ["--foreground", "主文字"],
      ["--foreground-muted", "次要文字和说明"],
      ["--panel-border", "面板分隔线"],
      ["--outline", "控件描边和强边界"],
      ["--border-subtle", "派生弱分隔线"],
      ["--border-strong", "派生强边界"],
    ],
  },
  {
    title: "颜色、操作与状态",
    tokens: [
      ["--accent", "强调色和选中态"],
      ["--accent-hover", "强调色悬停"],
      ["--accent-pressed", "强调色按下"],
      ["--active-accent-fill", "选中行填充"],
      ["--on-accent", "强调背景上的文字"],
      ["--danger", "危险和错误"],
      ["--on-danger", "危险背景上的文字"],
      ["--warning", "警告"],
      ["--focus-ring", "键盘焦点环"],
      ["--scrim", "模态遮罩"],
      ["--shadow-color", "阴影颜色"],
    ],
  },
  {
    title: "颜色、输入与浮层",
    tokens: [
      ["--input-surface", "输入框底色"],
      ["--input-border", "输入框边框"],
      ["--input-border-hover", "输入框悬停边框"],
      ["--input-border-focus", "输入框焦点边框"],
      ["--placeholder-text", "占位文字"],
      ["--tooltip-surface", "tooltip 背景"],
      ["--tooltip-ink", "tooltip 文字"],
      ["--tooltip-border", "tooltip 边框"],
    ],
  },
  {
    title: "圆角与间距",
    tokens: [
      ["--radius-control", "控件圆角"],
      ["--radius-panel", "面板和卡片圆角"],
      ["--design-radius-micro", "极小圆角（复选框）"],
      ["--design-radius-chip", "chip 圆角"],
      ["--design-radius-inline", "行内控件圆角"],
      ["--design-radius-overlay", "浮层圆角"],
      ["--space-1", "4px 间距"],
      ["--space-1-5", "6px 紧密间距"],
      ["--space-2", "8px 间距"],
      ["--space-2-5", "10px 紧凑间距"],
      ["--space-3", "12px 间距"],
      ["--space-4", "16px 间距"],
      ["--space-5", "20px 间距"],
      ["--space-6", "24px 间距"],
      ["--space-7", "32px 间距"],
    ],
  },
  {
    title: "字号、行高与控件高度",
    tokens: [
      ["--type-micro", "微型 chrome 文本"],
      ["--type-caption", "说明、元数据和代码"],
      ["--type-label", "控件标签和密集列表"],
      ["--type-body", "默认正文和输入"],
      ["--type-heading", "表面内章节标题"],
      ["--type-title", "面板和对话框标题"],
      ["--type-hero", "设置页标题"],
      ["--type-display", "启动页大标题"],
      ["--line-body", "正文行高"],
      ["--line-label", "标签行高"],
      ["--font-mono", "代码和快捷键等宽字体"],
      ["--control-height", "默认控件高度"],
      ["--control-height-compact", "紧凑控件高度"],
      ["--control-height-icon", "图标控件高度"],
      ["--control-height-lg", "页面级操作高度"],
    ],
  },
  {
    title: "阴影",
    tokens: [
      ["--shadow-panel", "面板和卡片阴影"],
      ["--shadow-overlay-panel", "侧边浮层阴影"],
      ["--shadow-overlay-popover", "弹出层阴影"],
      ["--shadow-overlay-tooltip", "tooltip 阴影"],
    ],
  },
]);

/** Escape text for HTML text and attribute positions. */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const CODE_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "namespace",
  "new",
  "of",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "satisfies",
  "set",
  "static",
  "switch",
  "throw",
  "try",
  "type",
  "typeof",
  "var",
  "while",
  "with",
  "yield",
]);

const CODE_LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

const CODE_TYPES = new Set([
  "any",
  "bigint",
  "boolean",
  "never",
  "number",
  "object",
  "string",
  "symbol",
  "unknown",
  "void",
  "Array",
  "Date",
  "Error",
  "JSON",
  "Map",
  "Math",
  "Promise",
  "ReadonlyArray",
  "Record",
  "Set",
  "Uint8Array",
]);

const CODE_PUNCTUATION =
  /^(?:=>|===|!==|\.\.\.|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\+\+|--|\+=|-=|\*=|\/=|[{}[\]()<>.,;:+\-*/%=!&|?~^])/u;

/** Wrap one highlighted token, escaping its text before it reaches the DOM. */
function tokenSpan(kind, text) {
  const escaped = escapeHtml(text);
  return kind ? `<span class="tok-${kind}">${escaped}</span>` : escaped;
}

/** Highlight JavaScript and TypeScript with a small, stable token set. */
function highlightScript(code) {
  let html = "";
  let index = 0;
  while (index < code.length) {
    const char = code[index];
    const rest = code.slice(index);

    if (/\s/u.test(char)) {
      let end = index + 1;
      while (end < code.length && /\s/u.test(code[end])) {
        end += 1;
      }
      html += escapeHtml(code.slice(index, end));
      index = end;
      continue;
    }

    if (rest.startsWith("//")) {
      const end = code.indexOf("\n", index);
      const stop = end === -1 ? code.length : end;
      html += tokenSpan("comment", code.slice(index, stop));
      index = stop;
      continue;
    }

    if (rest.startsWith("/*")) {
      const end = code.indexOf("*/", index + 2);
      const stop = end === -1 ? code.length : end + 2;
      html += tokenSpan("comment", code.slice(index, stop));
      index = stop;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      let cursor = index + 1;
      while (cursor < code.length) {
        if (code[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (code[cursor] === char) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      html += tokenSpan("string", code.slice(index, cursor));
      index = cursor;
      continue;
    }

    const number = /^(?:0[xX][\da-fA-F]+|0[bB][01]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(rest);
    if (number) {
      html += tokenSpan("number", number[0]);
      index += number[0].length;
      continue;
    }

    const identifier = /^[A-Za-z_$][\w$]*/u.exec(rest);
    if (identifier) {
      const word = identifier[0];
      const before = code.slice(0, index).match(/(\S)\s*$/u)?.[1] ?? "";
      const next = code.slice(index + word.length).match(/^\s*(\S)/u)?.[1] ?? "";
      let kind = "";
      if (CODE_KEYWORDS.has(word)) {
        kind = "keyword";
      } else if (CODE_LITERALS.has(word)) {
        kind = "literal";
      } else if (next === "(") {
        kind = "function";
      } else if (before === ".") {
        kind = "property";
      } else if (next === ":" && before !== "?") {
        kind = "property";
      } else if (CODE_TYPES.has(word) || /^[A-Z][\w$]*$/u.test(word)) {
        kind = "type";
      }
      html += tokenSpan(kind, word);
      index += word.length;
      continue;
    }

    const punctuation = CODE_PUNCTUATION.exec(rest);
    if (punctuation) {
      html += tokenSpan("punctuation", punctuation[0]);
      index += punctuation[0].length;
      continue;
    }

    html += tokenSpan("", char);
    index += 1;
  }
  return html;
}

/** Highlight JSON keys, strings, numbers, and literals. */
function highlightJson(code) {
  let html = "";
  let index = 0;
  while (index < code.length) {
    const char = code[index];
    const rest = code.slice(index);

    if (/\s/u.test(char)) {
      let end = index + 1;
      while (end < code.length && /\s/u.test(code[end])) {
        end += 1;
      }
      html += escapeHtml(code.slice(index, end));
      index = end;
      continue;
    }

    if (char === '"') {
      let cursor = index + 1;
      while (cursor < code.length) {
        if (code[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (code[cursor] === '"') {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      const property = /^\s*:/u.test(code.slice(cursor));
      html += tokenSpan(property ? "property" : "string", code.slice(index, cursor));
      index = cursor;
      continue;
    }

    const number = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(rest);
    if (number) {
      html += tokenSpan("number", number[0]);
      index += number[0].length;
      continue;
    }

    const literal = /^(?:true|false|null)\b/u.exec(rest);
    if (literal) {
      html += tokenSpan("literal", literal[0]);
      index += literal[0].length;
      continue;
    }

    if ("{}[],:".includes(char)) {
      html += tokenSpan("punctuation", char);
      index += 1;
      continue;
    }

    html += tokenSpan("", char);
    index += 1;
  }
  return html;
}

/** Highlight CSS comments, strings, at-rules, declarations, and numbers. */
function highlightCss(code) {
  let html = "";
  let index = 0;
  while (index < code.length) {
    const char = code[index];
    const rest = code.slice(index);

    if (/\s/u.test(char)) {
      let end = index + 1;
      while (end < code.length && /\s/u.test(code[end])) {
        end += 1;
      }
      html += escapeHtml(code.slice(index, end));
      index = end;
      continue;
    }

    if (rest.startsWith("/*")) {
      const end = code.indexOf("*/", index + 2);
      const stop = end === -1 ? code.length : end + 2;
      html += tokenSpan("comment", code.slice(index, stop));
      index = stop;
      continue;
    }

    if (char === '"' || char === "'") {
      let cursor = index + 1;
      while (cursor < code.length) {
        if (code[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (code[cursor] === char) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      html += tokenSpan("string", code.slice(index, cursor));
      index = cursor;
      continue;
    }

    const atRule = /^@[\w-]+/u.exec(rest);
    if (atRule) {
      html += tokenSpan("keyword", atRule[0]);
      index += atRule[0].length;
      continue;
    }

    const hexColor = /^#[\da-fA-F]{3,8}\b/u.exec(rest);
    if (hexColor) {
      html += tokenSpan("number", hexColor[0]);
      index += hexColor[0].length;
      continue;
    }

    const property = /^(?:--[\w-]+|[A-Za-z-]+)(?=\s*:)/u.exec(rest);
    if (property) {
      html += tokenSpan("property", property[0]);
      index += property[0].length;
      continue;
    }

    const number = /^-?(?:\d*\.)?\d+(?:%|[a-z]+)?/iu.exec(rest);
    if (number) {
      html += tokenSpan("number", number[0]);
      index += number[0].length;
      continue;
    }

    const call = /^[A-Za-z-]+(?=\()/u.exec(rest);
    if (call) {
      html += tokenSpan("function", call[0]);
      index += call[0].length;
      continue;
    }

    const selector = /^\.[\w-]+/u.exec(rest);
    if (selector) {
      html += tokenSpan("type", selector[0]);
      index += selector[0].length;
      continue;
    }

    if (/[{}[\](),:;>+~*]/u.test(char)) {
      html += tokenSpan("punctuation", char);
      index += 1;
      continue;
    }

    html += tokenSpan("", char);
    index += 1;
  }
  return html;
}

/** Render one fenced code block through the shared highlighter. */
function renderCodeBlock(code, language = "text") {
  const requested = String(language).toLowerCase();
  const normalized = ["js", "javascript", "ts", "typescript", "json", "css"].includes(requested)
    ? requested
    : "text";
  return `<pre><code class="language-${normalized}">${highlightCode(code, normalized)}</code></pre>`;
}

/** Highlight code for one of the supported languages; everything else stays plain. */
function highlightCode(code, language) {
  switch (language) {
    case "js":
    case "javascript":
    case "ts":
    case "typescript":
      return highlightScript(code);
    case "json":
      return highlightJson(code);
    case "css":
      return highlightCss(code);
    default:
      return escapeHtml(code);
  }
}

/** Escape plain documentation text and render backticked spans as code. */
function renderInlineMarkup(value) {
  return escapeHtml(value).replace(/`([^`]+)`/gu, "<code>$1</code>");
}

/** Decode the entities this renderer emits, for the search index. */
function decodeHtml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/** Turn one Markdown heading into a stable, readable anchor id. */
function headingId(text) {
  const plain = text.replaceAll("`", "").replace(/[*_~]/gu, "").trim().toLowerCase();
  return (
    plain
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
      .replace(/\s+/gu, "-")
      .replace(/-+/gu, "-")
      .replace(/^-|-$/gu, "") || "section"
  );
}

/** Strip generated token tags before converting HTML into search text. */
function stripTokenSpans(html) {
  return String(html).replace(/<span class="tok-[a-z]+">([\s\S]*?)<\/span>/gu, "$1");
}

/** Strip generated tags into the plain text used by search. */
export function htmlToText(html) {
  return decodeHtml(stripTokenSpans(html).replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

/** Reject URLs that could execute script or escape the docs root. */
export function assertSafeHref(href) {
  const value = String(href).trim();
  if (!value) {
    throw new Error("Markdown link has an empty target");
  }
  if (/^(?:javascript|data|vbscript|file):/iu.test(value) || value.startsWith("//")) {
    throw new Error(`Markdown link uses a forbidden target: ${value}`);
  }
  return value;
}

/** Render emphasis inside one plain (already escaped) segment. */
function renderEmphasis(escaped) {
  return escaped
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/gu, "$1<em>$2</em>");
}

/** Render one inline segment, protecting code, images, and links. */
function renderInline(text, state) {
  let output = "";
  let index = 0;
  let plain = "";

  const flushPlain = () => {
    if (!plain) {
      return;
    }
    output += renderEmphasis(escapeHtml(plain));
    plain = "";
  };

  while (index < text.length) {
    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end !== -1) {
        flushPlain();
        output += `<code>${escapeHtml(text.slice(index + 1, end))}</code>`;
        index = end + 1;
        continue;
      }
    }
    if (text.startsWith("![", index)) {
      const match = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/u.exec(text.slice(index));
      if (match) {
        flushPlain();
        const src = assertSafeHref(match[2]);
        if (!/^https?:\/\//iu.test(src)) {
          throw new Error(`Markdown image must be an http(s) URL: ${src}`);
        }
        output += `<img src="${escapeHtml(src)}" alt="${escapeHtml(match[1])}"${
          match[3] ? ` title="${escapeHtml(match[3])}"` : ""
        } loading="lazy" referrerpolicy="no-referrer">`;
        index += match[0].length;
        continue;
      }
    }
    if (text[index] === "[") {
      const match = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/u.exec(text.slice(index));
      if (match) {
        flushPlain();
        const href = assertSafeHref(match[2]);
        const resolved = state.resolveLink(href);
        state.links.push({ href, ...resolved });
        const external = /^(?:https?:\/\/|mailto:)/iu.test(href);
        const routeAttributes =
          resolved.internal && resolved.targetRoute
            ? ` data-route="${escapeHtml(resolved.targetRoute)}"${
                resolved.anchor ? ` data-anchor="${escapeHtml(resolved.anchor)}"` : ""
              }`
            : "";
        output += `<a href="${escapeHtml(resolved.href)}"${
          external ? ' target="_blank" rel="noopener noreferrer"' : ""
        }${routeAttributes}${match[3] ? ` title="${escapeHtml(match[3])}"` : ""}>${renderInline(
          match[1],
          state,
        )}</a>`;
        index += match[0].length;
        continue;
      }
    }
    plain += text[index];
    index += 1;
  }
  flushPlain();
  return output;
}

/** Whether a line starts a block that ends a paragraph. */
function isBlockStart(lines, index) {
  const line = lines[index];
  if (/^(?:#{1,6}\s|```|\s*>|\s*(?:[-+*]|\d+[.)])\s+|(?:---|\*\*\*|___)\s*$)/u.test(line)) {
    return true;
  }
  return isTableStart(lines, index);
}

/** Whether two lines form a pipe table. */
function isTableStart(lines, index) {
  const header = lines[index] ?? "";
  const separator = lines[index + 1] ?? "";
  return (
    header.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/u.test(separator)
  );
}

/** Split one pipe-table row, respecting escaped pipes. */
function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim().replaceAll("\\|", "|"));
}

/** Read one list item, or null when the line is not a list item. */
function listItem(line) {
  const match = /^(\s*)([-+*]|\d+[.)])\s+(.*)$/u.exec(line);
  if (!match) {
    return null;
  }
  return {
    indent: match[1].replaceAll("\t", "  ").length,
    ordered: /^\d/u.test(match[2]),
    text: match[3],
  };
}

/** Render a list and its nested children, returning HTML and the next line. */
function renderList(lines, start, state) {
  const first = listItem(lines[start]);
  const baseIndent = first.indent;
  const ordered = first.ordered;
  const items = [];
  let index = start;
  while (index < lines.length) {
    const item = listItem(lines[index]);
    if (!item || item.indent !== baseIndent || item.ordered !== ordered) {
      break;
    }
    index += 1;
    const children = [];
    while (index < lines.length) {
      const nested = listItem(lines[index]);
      if (!nested || nested.indent <= baseIndent) {
        break;
      }
      const rendered = renderList(lines, index, state);
      children.push(rendered.html);
      index = rendered.next;
    }
    items.push({ text: item.text, children });
  }
  const tag = ordered ? "ol" : "ul";
  const body = items
    .map(
      (item) =>
        `<li>${renderInline(item.text, state)}${item.children.length ? item.children.join("") : ""}</li>`,
    )
    .join("");
  return { html: `<${tag}>${body}</${tag}>`, next: index };
}

/** Render a Markdown subset into safe HTML plus headings, links, and text. */
export function renderMarkdown(markdown, options = {}) {
  const state = {
    links: [],
    headings: [],
    usedIds: new Map(),
    pageSlug: options.pageSlug ?? "page",
    fromFile: options.fromFile ?? "",
    resolveLink:
      options.resolveLink ??
      ((href) => {
        if (href.startsWith("#")) {
          return { href: `#/page/${state.pageSlug}${href}`, internal: true, anchor: href.slice(1) };
        }
        if (/^(?:https?:\/\/|mailto:)/iu.test(href)) {
          return { href, internal: false };
        }
        throw new Error(`Markdown link has no resolver: ${href}`);
      }),
  };
  const lines = String(markdown).replaceAll("\r\n", "\n").split("\n");
  const blocks = [];
  let title = "";
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^```([\w-]*)\s*$/u.exec(line);
    if (fence) {
      const language = /^[a-z0-9-]+$/iu.test(fence[1]) ? fence[1].toLowerCase() : "text";
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/u.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index >= lines.length) {
        throw new Error("Markdown code fence is not closed");
      }
      index += 1;
      blocks.push(renderCodeBlock(code.join("\n"), language));
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading) {
      const level = heading[1].length;
      const rawText = heading[2];
      const idBase = headingId(rawText.replace(/`([^`]*)`/gu, "$1"));
      const seen = state.usedIds.get(idBase) ?? 0;
      state.usedIds.set(idBase, seen + 1);
      const id = seen === 0 ? idBase : `${idBase}-${seen + 1}`;
      const plain = htmlToText(renderInline(rawText, state));
      if (level === 1 && !title) {
        title = plain;
      }
      state.headings.push({ id, text: plain, level });
      blocks.push(`<h${level} id="${escapeHtml(id)}">${renderInline(rawText, state)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*>\s?/u.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>\s?/u.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/u, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${renderMarkdownBlocks(quote, state)}</blockquote>`);
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = splitTableRow(line);
      const align = splitTableRow(lines[index + 1]).map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        if (left && right) {
          return "center";
        }
        if (right) {
          return "right";
        }
        return left ? "left" : "";
      });
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      const head = header
        .map(
          (cell, column) =>
            `<th${align[column] ? ` style="text-align:${align[column]}"` : ""}>${renderInline(
              cell,
              state,
            )}</th>`,
        )
        .join("");
      const body = rows
        .map(
          (row) =>
            `<tr>${header
              .map(
                (_, column) =>
                  `<td${align[column] ? ` style="text-align:${align[column]}"` : ""}>${renderInline(
                    row[column] ?? "",
                    state,
                  )}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("");
      blocks.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    if (listItem(line)) {
      const rendered = renderList(lines, index, state);
      blocks.push(rendered.html);
      index = rendered.next;
      continue;
    }

    if (/^(?:---|\*\*\*|___)\s*$/u.test(line)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockStart(lines, index) &&
      !listItem(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraph.join(" "), state)}</p>`);
  }

  const html = blocks.join("\n");
  return {
    html,
    headings: state.headings,
    links: state.links,
    title,
    text: htmlToText(html),
  };
}

/** Render nested block lines (used by blockquotes). */
function renderMarkdownBlocks(lines, state) {
  return renderMarkdown(lines.join("\n"), {
    pageSlug: state.pageSlug,
    fromFile: state.fromFile,
    resolveLink: state.resolveLink,
  }).html;
}

/** Extract a string-literal Set from the sandbox source. */
function extractStringSet(source, name) {
  const match = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`, "u").exec(source);
  if (!match) {
    throw new Error(`Cannot find ${name} in extensionSandbox.tsx`);
  }
  return [...match[1].matchAll(/"([^"]+)"/gu)].map((entry) => entry[1]);
}

/** Extract an integer constant from the sandbox source. */
function extractNumber(source, name) {
  const match = new RegExp(`const ${name} = ([\\d_]+);`, "u").exec(source);
  if (!match) {
    throw new Error(`Cannot find ${name} in extensionSandbox.tsx`);
  }
  return Number(match[1].replaceAll("_", ""));
}

/** Read the declarative UI contract from the renderer source. */
async function loadUiContract() {
  const source = await readFile(join(ROOT, "src/frontend/platform/extensionSandbox.tsx"), "utf8");
  const idLimit = /record\.id\.length <= (\d+)/u.exec(source);
  const classLimit = /record\.class\.length <= (\d+)/u.exec(source);
  if (!idLimit || !classLimit) {
    throw new Error("Cannot find declarative UI id/class limits");
  }
  return {
    tags: extractStringSet(source, "ALLOWED_TAGS"),
    attrs: extractStringSet(source, "ALLOWED_ATTRS"),
    inputTypes: extractStringSet(source, "ALLOWED_INPUT_TYPES"),
    maxNodes: extractNumber(source, "MAX_UI_NODES"),
    maxDepth: extractNumber(source, "MAX_UI_DEPTH"),
    maxImageBytes: extractNumber(source, "MAX_IMAGE_BYTES"),
    idLimit: Number(idLimit[1]),
    classLimit: Number(classLimit[1]),
  };
}

/** Read every custom property declared by the design token sheets. */
async function loadTokenNames() {
  const names = new Set();
  for (const file of ["src/design/styles/tokens.less", "src/design/design.less"]) {
    const source = await readFile(join(ROOT, file), "utf8");
    for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:/giu)) {
      names.add(match[1]);
    }
  }
  const theme = await import(pathToFileURL(join(ROOT, "src/core/theme/colorTokens.ts")).href);
  for (const token of theme.THEME_COLOR_TOKENS) {
    names.add(token);
  }
  return names;
}

/** Build the capability table and its risk labels from the runtime catalog. */
function renderCapabilityTable(catalog) {
  const rows = catalog.map((row) => {
    const description = CAPABILITY_DESCRIPTIONS[row.capability];
    if (!description) {
      throw new Error(`Capability lacks documentation: ${row.capability}`);
    }
    const risk =
      activeLocale === "en"
        ? ({ read: "Read", write: "Write", sensitive: "Sensitive" }[row.risk] ?? row.risk)
        : RISK_LABELS[row.risk];
    const localizedDescription =
      activeLocale === "en" ? `Access to ${row.capability}.` : description;
    return `| \`${row.capability}\` | ${risk} \`${row.risk}\` | ${localizedDescription} | ${
      row.capability === "host.patch"
        ? activeLocale === "en"
          ? "No (retired)"
          : "否（已退役）"
        : activeLocale === "en"
          ? "Yes"
          : "是"
    } |`;
  });
  const header =
    activeLocale === "en"
      ? ["| Capability | Risk | Description | Grantable |", "| --- | --- | --- | --- |"]
      : ["| 能力 | 风险 | 说明 | 可授予 |", "| --- | --- | --- | --- |"];
  return [...header, ...rows].join("\n");
}

/** Group registered methods by capability and render one table per grant. */
function renderMethodTables(methods, capabilities) {
  const groups = new Map();
  for (const entry of methods) {
    let group = groups.get(entry.capability);
    if (!group) {
      group = [];
      groups.set(entry.capability, group);
    }
    group.push(entry);
  }
  const sections = [];
  let total = 0;
  for (const capability of capabilities) {
    const entries = groups.get(capability);
    if (!entries?.length) {
      continue;
    }
    total += entries.length;
    const rows = entries.map((entry) => {
      const key = entry.handle ? `${entry.handle}.${entry.method}` : entry.method;
      return `| \`${key}\` | \`${entry.risk}\` | ${
        entry.writesHostState
          ? activeLocale === "en"
            ? "Yes"
            : "是"
          : activeLocale === "en"
            ? "No"
            : "否"
      } | ${entry.since} |`;
    });
    sections.push(
      [
        `### \`${capability}\``,
        "",
        activeLocale === "en"
          ? "| Method | Risk | Writes host state | Since |"
          : "| 方法 | 风险 | 写宿主状态 | since |",
        "| --- | --- | --- | --- |",
        ...rows,
      ].join("\n"),
    );
  }
  return {
    markdown: [
      activeLocale === "en"
        ? `${total} registered methods across ${groups.size} capabilities. Unknown paths return \`methodNotRegistered\`.`
        : `共 ${total} 个已登记方法，覆盖 ${groups.size} 个能力。未登记路径返回 \`methodNotRegistered\`。`,
      "",
      ...sections,
    ].join("\n\n"),
    total,
  };
}

/** One API handle's display name. */
function apiHandleOf(entry) {
  return entry.handle || entry.method.split(".")[0];
}

/** The member path after the handle, used in URL segments. */
function apiMemberMethodOf(entry) {
  const handle = apiHandleOf(entry);
  if (entry.handle) {
    return entry.method;
  }
  const prefix = `${handle}.`;
  return entry.method.startsWith(prefix) ? entry.method.slice(prefix.length) : entry.method;
}

/** The fully qualified method path used in tables and search. */
function apiFullPathOf(entry) {
  return entry.handle ? `${entry.handle}.${entry.method}` : entry.method;
}

/** Whether one registry entry is presented as a read-only attribute. */
function isApiAttribute(entry) {
  return (
    entry.risk === "read" &&
    !entry.writesHostState &&
    ATTRIBUTE_NAMES.has(entry.method.split(".").at(-1))
  );
}

/** A short Chinese summary for one generated API page. */
function apiSummaryOf(entry) {
  const full = apiFullPathOf(entry);
  if (activeLocale === "en") {
    const verb = entry.method.split(".").at(-1);
    const subject = apiHandleOf(entry);
    const english = {
      availability: "Reports whether this API is available.",
      state: `Reads the current ${subject} state.`,
      snapshot: `Reads a ${subject} snapshot.`,
      placeNote: "Places one note at the requested target.",
      preview: "Previews a transaction without committing it.",
      apply: "Applies a previously previewed transaction.",
      cancel: "Cancels a transaction preview.",
      subscribe: "Subscribes to changes and returns a disposer.",
      tokens: "Reads the theme tokens currently applied by the host.",
      register: "Registers one extension contribution.",
      unregister: "Removes one extension contribution.",
      open: "Opens a panel or sidebar entry.",
      close: "Closes the current extension surface.",
      getJSON: "Reads and parses a JSON value.",
      setJSON: "Serializes and stores a JSON value.",
      guide: "Opens a step-by-step guide.",
    };
    return english[verb] ?? `Calls ${full}.`;
  }
  const override = METHOD_SUMMARY_OVERRIDES[full];
  if (override) {
    return override;
  }
  const handle = apiHandleOf(entry);
  const label = API_HANDLE_LABELS[handle] ?? handle;
  const verb = entry.method.split(".").at(-1);
  const summaries = {
    availability: `查询${label}是否可用。`,
    read: "分页读取一个集合。",
    state: `读取${label}当前状态。`,
    snapshot: `读取${label}快照。`,
    fingerprint: "读取当前文档指纹。",
    metadata: "读取谱面元数据。",
    resources: "读取谱面声明的资源引用。",
    lines: "读取全部判定线。",
    line: "按 id 读取一条判定线。",
    parentId: "读取对象的父判定线 id。",
    notes: "读取全部音符引用。",
    note: "按 id 读取一个音符引用。",
    events: "读取全部事件引用。",
    event: "按 id 读取一个事件引用。",
    placeNote: "在指定判定线放置一个音符。",
    apply: "应用一次事务。",
    preview: "预览一次事务。",
    cancel: "取消一次事务预览。",
    history: "读取撤销历史。",
    undo: "撤销最近一次编辑。",
    redo: "重做最近一次撤销。",
    clear: "清空当前选择。",
    copy: "复制当前选择。",
    cut: "剪切当前选择。",
    delete: "删除当前选择。",
    paste: "粘贴选择内容。",
    select: "设置当前选择。",
    range: "按范围设置当前选择。",
    create: "创建一个项目或文档。",
    createRaw: "从已序列化数据创建项目。",
    openPath: "按路径打开文档。",
    openBytes: "从字节打开文档。",
    save: "保存当前文档。",
    close: "关闭当前文档。",
    list: "列出项目摘要。",
    get: "按 id 读取一个对象。",
    scope: "打开一个项目作用域。",
    update: "更新一个对象。",
    remove: "删除一个对象。",
    duplicate: "复制一个对象。",
    assets: "列出项目资源。",
    asset: "读取一个项目资源。",
    addAsset: "向项目添加一个资源。",
    removeAsset: "从项目移除一个资源。",
    revisions: "列出项目修订。",
    createRevision: "创建项目修订。",
    revision: "读取一个修订。",
    removeRevision: "删除一个修订。",
    play: "开始播放。",
    pause: "暂停播放。",
    stop: "停止播放。",
    replay: "从头重新播放。",
    seek: "跳转到指定时间。",
    seekBeat: "跳转到指定拍。",
    setRate: "设置播放倍率。",
    inspect: "读取播放诊断信息。",
    renderAt: "渲染指定时间的预览帧。",
    textures: "读取预览纹理状态。",
    frames: "读取预览帧统计。",
    startMeasurement: "开始播放性能测量。",
    stopMeasurement: "停止播放性能测量。",
    metrics: "读取播放性能指标。",
    resetDiagnostics: "清空播放诊断。",
    register: "注册一个贡献。",
    unregister: "移除一个贡献。",
    registerDivider: "注册一个侧栏分隔线。",
    registerAll: "批量注册贡献。",
    open: "打开一个面板或侧栏入口。",
    subscribe: "订阅变化。",
    entry: "按 id 读取一个条目。",
    refresh: "重新计算动作可用性。",
    available: "查询动作是否可用。",
    bindings: "读取动作的快捷键绑定。",
    shortcutText: "读取动作的快捷键显示文本。",
    registerNavigation: "注册设置页导航。",
    registerSetting: "注册设置行。",
    define: "声明一个命名值。",
    getHandle: "获取命名值句柄。",
    has: "判断命名值是否存在。",
    ownerOf: "读取命名值的所有者。",
    set: "写入一个值。",
    subscribeAll: "订阅本包全部值变化。",
    registerCategory: "注册快捷键分类。",
    registerShortcut: "注册快捷键。",
    setEnabled: "设置跟踪开关。",
    pick: "执行命中测试。",
    geometry: "读取命中测试几何。",
    anchors: "读取布局锚点。",
    tokens: "读取主题 token。",
    on: "订阅一个宿主事件。",
    setTimeout: "创建一个延时回调。",
    setInterval: "创建一个周期回调。",
    requestAnimationFrame: "请求下一帧回调。",
    clearTimeout: "清除延时回调。",
    clearInterval: "清除周期回调。",
    cancelAnimationFrame: "取消帧回调。",
    add: "添加一张样式表。",
    notice: "显示一条通知。",
    progress: "创建进度条。",
    confirm: "显示确认框。",
    input: "显示输入框。",
    guide: "显示分步引导。",
    registerPanel: "注册面板。",
    registerSidebar: "注册侧栏入口。",
    registerOverlay: "注册覆盖层。",
    getJSON: "读取并解析 JSON 值。",
    setJSON: "序列化并保存 JSON 值。",
  };
  return summaries[verb] ?? `调用 ${full}。`;
}

/** Parameter metadata for one registry entry. */
function apiParamsOf(entry) {
  const full = apiFullPathOf(entry);
  return PARAM_RULES[full] ?? PARAM_RULES[entry.method.split(".").at(-1)] ?? [];
}

/** Escape one string for use in a generated regular expression. */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Render a known public type as an in-place documentation inspector trigger. */
function typeCell(type) {
  const text = String(type);
  const names = Object.entries(TYPE_LINKS).sort(([left], [right]) => right.length - left.length);
  let output = escapeHtml(text);
  for (const [name, anchor] of names) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])(${escapeRegExp(name)})(?![A-Za-z0-9_])`, "gu");
    output = output.replace(
      pattern,
      `$1<button type="button" class="docs-type-link" data-type-id="${anchor}" aria-haspopup="dialog">$2</button>`,
    );
  }
  return `<code>${output}</code>`;
}

/** One-line return description for one registry entry. */
function apiReturnOf(entry) {
  const full = apiFullPathOf(entry);
  if (activeLocale === "en") {
    return "Returns a Promise. Check `ok` for API results, then read `value` or `error`.";
  }
  if (full === "theme.tokens") {
    return "返回 `ExtensionThemeTokens` 快照；沙箱中为 `Promise<ExtensionThemeTokens>`。";
  }
  if (full === "theme.subscribe") {
    return "返回 `Promise<() => void>`；调用返回的 disposer 结束订阅。";
  }
  const short = entry.method.split(".").at(-1);
  return (
    RETURN_RULES[full] ??
    RETURN_RULES[short] ??
    "返回 `Promise`。宿主方法通常包在 `ApiResult` 中：先看 `ok`，成功读 `value`，失败读 `error`。"
  );
}

/** Render the fixed example block for one API member. */
function apiExampleOf(entry) {
  const handle = apiHandleOf(entry);
  const member = apiMemberMethodOf(entry);
  const full = apiFullPathOf(entry);
  if (activeLocale === "en") {
    const params = apiParamsOf(entry);
    const args = params.map(([name]) => SAMPLE_VALUES[name] ?? "undefined").join(", ");
    const destructure = entry.handle
      ? "const { api } = context;"
      : `const { ${handle} } = context;`;
    const expression = entry.handle ? `api.${handle}.${entry.method}` : `${handle}.${member}`;
    return `async function example(context) {
  ${destructure}
  const result = await ${expression}(${args});
  if (result && typeof result === "object" && "ok" in result && !result.ok) {
    throw new Error(result.error.message);
  }
  return result && typeof result === "object" && "ok" in result ? result.value : result;
}`;
  }
  if (full === "theme.tokens") {
    return `async function example(context) {
  const { api } = context;
  // 读取当前主题实际应用的设计 token
  const tokens = await api.theme.tokens();
  return {
    theme: tokens.theme,
    colors: tokens.colors,
    spacing: tokens.spacing,
  };
}`;
  }
  if (full === "storage.getJSON") {
    return `async function example(context) {
  const { storage } = context;
  // 读取并解析 config
  const config = await storage.getJSON("config");
  return config;
}`;
  }
  if (full === "storage.setJSON") {
    return `async function example(context) {
  const { storage } = context;
  // 保存带版本号的 JSON 配置
  await storage.setJSON("config", { version: 1, data: { quality: 80 } });
}`;
  }
  if (full === "chart.placeNote") {
    return `async function example(context) {
  const { api, ui } = context;
  // 1 = Tap，2 = Hold，3 = Flick，4 = Drag
  const result = await api.chart.placeNote(1, {
    lineIndex: 0,
    from: { beat: 0, positionX: 0 },
  });
  if (!result.ok) {
    ui.notice(result.error.message, { level: "error" });
    return;
  }
  if (result.value.status === "committed") {
    ui.notice("已放置 Tap", { level: "success" });
  }
}`;
  }
  if (full === "transaction.preview") {
    return `async function example(context) {
  const { api, ui } = context;
  const result = await api.transaction.preview({
    label: "移动一个音符",
    notes: { update: [{ id: "note-id", patch: { positionX: 100 } }] },
  });
  if (!result.ok) {
    ui.notice(result.error.message, { level: "error" });
    return;
  }
  return result.value.previewId;
}`;
  }
  if (full === "transaction.apply") {
    return `async function example(context) {
  const { api, ui } = context;
  const result = await api.transaction.apply("preview-id");
  if (!result.ok) {
    ui.notice(result.error.message, { level: "error" });
    return;
  }
  return result.value.status;
}`;
  }
  if (full === "values.byId.get") {
    return `async function example(context) {
  const { api } = context;
  const value = await api.values.byId.get("quality");
  return value;
}`;
  }
  if (full === "values.byId.set") {
    return `async function example(context) {
  const { api } = context;
  await api.values.byId.set("quality", 80);
}`;
  }
  const params = apiParamsOf(entry);
  const args = params.map(([name]) => SAMPLE_VALUES[name] ?? "undefined").join(", ");
  const destructure = entry.handle
    ? "const { api, ui } = context;"
    : `const { ${handle} } = context;`;
  const expression = entry.handle ? `api.${handle}.${entry.method}` : `${handle}.${member}`;
  const summary = apiSummaryOf(entry);
  return `async function example(context) {
  ${destructure}
  // ${summary.replaceAll("`", "")}
  const result = await ${expression}(${args});
  if (result && typeof result === "object" && "ok" in result && !result.ok) {
    ui.notice(result.error.message, { level: "error" });
    return;
  }
  return result && typeof result === "object" && "ok" in result ? result.value : result;
}`;
}

/** Render the five-column parameter table for one method page. */
function apiParameterTable(entry) {
  const params = apiParamsOf(entry);
  if (!params.length) {
    if (activeLocale === "en") {
      return [
        "<table><thead><tr><th>Parameter</th><th>Type</th><th>Default</th><th>Required</th><th>Description</th></tr></thead>",
        "<tbody><tr><td>—</td><td>—</td><td>—</td><td>—</td><td>This method accepts no parameters.</td></tr></tbody></table>",
      ].join("");
    }
    return [
      "<table><thead><tr><th>属性</th><th>数据类型</th><th>默认值</th><th>必填</th><th>说明</th></tr></thead>",
      "<tbody><tr><td>—</td><td>—</td><td>—</td><td>—</td><td>本方法不接受参数。</td></tr></tbody></table>",
    ].join("");
  }
  const rows = params
    .map(
      ([name, type, fallback, required, description]) =>
        `<tr><td><code>${escapeHtml(name)}</code></td><td>${typeCell(
          type,
        )}</td><td>${fallback ? escapeHtml(fallback) : "—"}</td><td>${
          required === "是"
            ? activeLocale === "en"
              ? "Yes"
              : "是"
            : activeLocale === "en"
              ? "No"
              : "否"
        }</td><td>${activeLocale === "en" ? `Parameter passed to ${apiFullPathOf(entry)}.` : escapeHtml(description)}</td></tr>`,
    )
    .join("");
  return [
    activeLocale === "en"
      ? "<table><thead><tr><th>Parameter</th><th>Type</th><th>Default</th><th>Required</th><th>Description</th></tr></thead>"
      : "<table><thead><tr><th>属性</th><th>数据类型</th><th>默认值</th><th>必填</th><th>说明</th></tr></thead>",
    `<tbody>${rows}</tbody></table>`,
  ].join("");
}

/** Render one generated API member page. */
function renderApiMemberPage(entry) {
  const handle = apiHandleOf(entry);
  const member = apiMemberMethodOf(entry);
  const short = member.split(".").at(-1);
  const attribute = isApiAttribute(entry);
  const kind =
    activeLocale === "en" ? (attribute ? "Property" : "Method") : attribute ? "属性" : "方法";
  const params = attribute ? [] : apiParamsOf(entry);
  // The public facade takes positional arguments, so repeat the parameter names
  // in call order instead of wrapping each one in an object literal.
  const syntaxArgs = params.map(([name]) => name).join(", ");
  const call = `${entry.handle ? `context.api.${handle}.${entry.method}` : `context.${entry.method}`}(${syntaxArgs})`;
  const headings = [];
  const sections = [
    `<h1>${escapeHtml(short)}</h1>`,
    `<div class="docs-pills"><span class="docs-pill">${activeLocale === "en" ? "Capability" : "需要能力"} <code>${escapeHtml(
      entry.capability,
    )}</code></span><span class="docs-pill">${activeLocale === "en" ? "Since" : "自"} ${escapeHtml(entry.since)}${activeLocale === "en" ? "" : " 起"}</span></div>`,
    `<p class="docs-lede">${renderInlineMarkup(apiSummaryOf(entry))}${
      attribute ? (activeLocale === "en" ? " This is read-only." : " 此为只读属性。") : ""
    }</p>`,
  ];
  const syntaxHeading = activeLocale === "en" ? "Syntax" : "语法";
  const parametersHeading = activeLocale === "en" ? "Parameters" : "参数";
  const returnHeading = activeLocale === "en" ? "Return value" : "返回值";
  const exampleHeading = activeLocale === "en" ? "Example" : "示例";
  headings.push({ id: syntaxHeading, text: syntaxHeading, level: 2 });
  sections.push(`<h2 id="${syntaxHeading}">${syntaxHeading}</h2>`, renderCodeBlock(call, "js"));
  if (!attribute) {
    headings.push({ id: parametersHeading, text: parametersHeading, level: 2 });
    sections.push(
      `<h2 id="${parametersHeading}">${parametersHeading}</h2>`,
      apiParameterTable(entry),
    );
  }
  headings.push({ id: returnHeading, text: returnHeading, level: 2 });
  const returnType = RETURN_TYPES[apiFullPathOf(entry)];
  sections.push(
    `<h2 id="${returnHeading}">${returnHeading}</h2>`,
    `<p>${returnType ? (activeLocale === "en" ? `Returns ${typeCell(returnType)}. ` : `返回 ${typeCell(returnType)}。`) : ""}${renderInlineMarkup(
      apiReturnOf(entry),
    )}</p>`,
  );
  headings.push({ id: exampleHeading, text: exampleHeading, level: 2 });
  sections.push(
    `<h2 id="${exampleHeading}">${exampleHeading}</h2>`,
    renderCodeBlock(apiExampleOf(entry), "js"),
  );
  const html = sections.join("\n");
  return {
    slug: `api-${handle}-${member.replaceAll(".", "-")}`,
    title: short,
    route: `api/${handle}/${member}`,
    section: "API",
    group: handle,
    kind: attribute ? "attribute" : "method",
    breadcrumb: ["API", handle, kind, short],
    updated: DOCS_UPDATED,
    keywords: [handle, member, entry.capability],
    html,
    headings,
    links: [],
    text: htmlToText(html),
  };
}

/** Render one handle overview page with method and attribute tables. */
function renderApiHandlePage(handle, entries) {
  const methods = entries.filter((entry) => !isApiAttribute(entry));
  const attributes = entries.filter(isApiAttribute);
  const sections = [
    `<h1>${escapeHtml(handle)}</h1>`,
    `<div class="docs-pills"><span class="docs-pill">${methods.length} ${activeLocale === "en" ? "methods" : "个方法"}</span><span class="docs-pill">${attributes.length} ${activeLocale === "en" ? "properties" : "个属性"}</span></div>`,
    `<p class="docs-lede">${escapeHtml(
      activeLocale === "en"
        ? `Access to ${handle} operations.`
        : (API_HANDLE_DESCRIPTIONS[handle] ?? API_HANDLE_LABELS[handle] ?? ""),
    )}</p>`,
    `<p>${escapeHtml(activeLocale === "en" ? `Use this handle for ${handle} operations.` : (API_HANDLE_WHEN[handle] ?? ""))}</p>`,
  ];
  const headings = [];
  const table = (label, rows) => {
    if (!rows.length) {
      return "";
    }
    headings.push({ id: label, text: label, level: 2 });
    const body = rows
      .map((entry) => {
        const member = apiMemberMethodOf(entry);
        return `<tr><td><a href="#/api/${escapeHtml(handle)}/${escapeHtml(
          member,
        )}" data-route="api/${escapeHtml(handle)}/${escapeHtml(
          member,
        )}"><code>${escapeHtml(member)}</code></a></td><td>${escapeHtml(
          apiSummaryOf(entry),
        )}</td><td><code>${escapeHtml(entry.capability)}</code></td></tr>`;
      })
      .join("");
    const localizedLabel =
      activeLocale === "en" ? (label === "方法" ? "Methods" : "Properties") : label;
    return `<h2 id="${localizedLabel}">${localizedLabel}</h2><table><thead><tr><th>${localizedLabel}</th><th>${activeLocale === "en" ? "Purpose" : "用途"}</th><th>${activeLocale === "en" ? "Capability" : "权限"}</th></tr></thead><tbody>${body}</tbody></table>`;
  };
  sections.push(table("方法", methods), table("属性", attributes));
  const html = sections.filter(Boolean).join("\n");
  return {
    slug: `api-${handle}`,
    title: `${handle}`,
    route: `api/${handle}`,
    section: "API",
    group: handle,
    kind: "handle",
    breadcrumb: ["API", handle],
    updated: DOCS_UPDATED,
    keywords: [handle, API_HANDLE_LABELS[handle] ?? handle],
    html,
    headings,
    links: [],
    text: htmlToText(html),
  };
}

/** Render the API index page with one row per handle. */
function renderApiIndexPage(handles, entries) {
  const rows = handles
    .map(({ handle }) => {
      const description =
        activeLocale === "en"
          ? `Access to ${handle} operations.`
          : (API_HANDLE_DESCRIPTIONS[handle] ?? API_HANDLE_LABELS[handle] ?? "");
      const when =
        activeLocale === "en"
          ? `Use this handle for ${handle} operations.`
          : (API_HANDLE_WHEN[handle] ?? "");
      return `<tr><td class="docs-handle"><a href="#/api/${escapeHtml(handle)}" data-route="api/${escapeHtml(
        handle,
      )}"><code>${escapeHtml(handle)}</code></a></td><td>${escapeHtml(
        description,
      )}</td><td>${escapeHtml(when)}</td></tr>`;
    })
    .join("");
  const tasks =
    activeLocale === "en"
      ? [
          ["Place a note", "place-note", "Place a Tap, Hold, Flick, or Drag on the current line"],
          ["Read chart objects", "api/chart", "Find lines, notes, events, or resources by id"],
          ["Modify a chart", "api/transaction", "Batch edits while preserving undo history"],
          [
            "Register scripts and panels",
            "context",
            "Build an extension surface from its entry point",
          ],
          [
            "Persist settings or package data",
            "api/values",
            "Declare observable values or store package data",
          ],
          [
            "Add configurable shortcuts",
            "api/shortcuts",
            "Register shortcut categories and commands",
          ],
        ]
      : [
          ["放一个音符", "place-note", "只想在当前判定线放 Tap / Hold / Flick / Drag"],
          ["读取谱面对象", "api/chart", "按 id 找判定线、音符、事件或资源"],
          ["修改谱面", "api/transaction", "批量移动、修改或删除，并保留撤销历史"],
          ["注册脚本、通知和面板", "context", "从扩展入口开始做界面"],
          ["保存设置或包数据", "api/values", "声明可观察值，或自动持久化设置"],
          ["给命令加可改键", "api/shortcuts", "注册快捷键分类和命令"],
        ];
  const taskRows = tasks
    .map(
      ([label, route, description]) =>
        `<tr><td><a href="${
          route.startsWith("api/") ? `#/${escapeHtml(route)}` : `#/page/${escapeHtml(route)}`
        }" data-route="${escapeHtml(route)}">${escapeHtml(label)}</a></td><td>${escapeHtml(
          description,
        )}</td></tr>`,
    )
    .join("");
  const html = [
    `<h1>${activeLocale === "en" ? "API overview" : "API"}</h1>`,
    `<div class="docs-pills"><span class="docs-pill">${handles.length} ${activeLocale === "en" ? "handles" : "个 handle"}</span><span class="docs-pill">${entries.length} ${activeLocale === "en" ? "members" : "个成员"}</span></div>`,
    `<p class="docs-lede">${activeLocale === "en" ? "Start with a common task, then open a handle for its exact methods. Read the context and types guides when you need the surrounding contract." : "先看“常见任务”，再按 handle 查具体方法。每个 handle 都是一组相关能力；不确定从哪里开始时，先读任务页和类型说明。"}</p>`,
    `<h2 id="${activeLocale === "en" ? "Common tasks" : "常见任务"}">${activeLocale === "en" ? "Common tasks" : "常见任务"}</h2>`,
    `<table><thead><tr><th>${activeLocale === "en" ? "I want to…" : "我想…"}</th><th>${activeLocale === "en" ? "Read first" : "先读"}</th></tr></thead><tbody>`,
    taskRows,
    "</tbody></table>",
    '<h2 id="Handle">Handle</h2>',
    `<table><thead><tr><th>Handle</th><th>${activeLocale === "en" ? "Purpose" : "是什么"}</th><th>${activeLocale === "en" ? "When to use" : "什么时候用"}</th></tr></thead><tbody>`,
    rows,
    "</tbody></table>",
    `<p class="docs-hint">${activeLocale === "en" ? '<code>ui</code>, <code>scripts</code>, <code>storage</code>, <code>events</code>, <code>timers</code>, and <code>styles</code> are context helpers rather than API handles. See the <a href="#/page/context" data-route="context">extension context</a> guide.' : '<code>ui</code>、<code>scripts</code>、<code>storage</code>、<code>events</code>、<code>timers</code> 和 <code>styles</code> 不是 API handle，而是扩展上下文的一部分，见<a href="#/page/context" data-route="context">扩展上下文</a>。'}</p>`,
  ].join("\n");
  return {
    slug: "api",
    title: activeLocale === "en" ? "API overview" : "API 总览",
    route: "api",
    section: "API",
    group: "",
    kind: "api-index",
    breadcrumb: ["API"],
    updated: DOCS_UPDATED,
    keywords:
      activeLocale === "en"
        ? ["API", "handle", "method", "property", "common tasks", "place a note"]
        : ["API", "handle", "method", "attribute", "常见任务", "放一个音符"],
    html,
    headings: [
      {
        id: activeLocale === "en" ? "Common tasks" : "常见任务",
        text: activeLocale === "en" ? "Common tasks" : "常见任务",
        level: 2,
      },
      { id: "Handle", text: "Handle", level: 2 },
    ],
    links: [],
    text: htmlToText(html),
  };
}

/** Render the context helper reference used by the context guide page. */
function renderContextMethodsTable(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (entry.handle) {
      continue;
    }
    const prefix = entry.method.split(".")[0];
    const list = groups.get(prefix);
    if (list) {
      list.push(entry);
    } else {
      groups.set(prefix, [entry]);
    }
  }
  const known = new Set(CONTEXT_GROUPS.map(([prefix]) => prefix));
  const ordered = [
    ...CONTEXT_GROUPS,
    ...[...groups.keys()]
      .filter((prefix) => !known.has(prefix))
      .map((prefix) => [prefix, prefix, ""]),
  ];
  const sections = [];
  for (const [prefix, title, summary] of ordered) {
    const members = groups.get(prefix);
    if (!members?.length) {
      continue;
    }
    const rows = members.map(
      (entry) =>
        `| \`context.${entry.method}\` | ${apiSummaryOf(entry)} | \`${entry.capability}\` |`,
    );
    const localizedTitle = activeLocale === "en" ? `${prefix} — context helper` : title;
    const localizedSummary =
      activeLocale === "en" ? `${prefix} is available from the extension context.` : summary;
    sections.push(
      [
        `### ${localizedTitle}`,
        "",
        localizedSummary,
        "",
        activeLocale === "en" ? "| Method | Purpose | Capability |" : "| 方法 | 用途 | 能力 |",
        "| --- | --- | --- |",
        ...rows,
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

/** Build every API index, handle, and member page from the method registry. */
function renderApiPages(entries) {
  const handleEntries = entries.filter((entry) => Boolean(entry.handle));
  const grouped = new Map();
  for (const entry of handleEntries) {
    const handle = apiHandleOf(entry);
    let bucket = grouped.get(handle);
    if (!bucket) {
      bucket = [];
      grouped.set(handle, bucket);
    }
    bucket.push(entry);
  }
  const handles = [
    ...API_HANDLE_ORDER.filter((handle) => grouped.has(handle)),
    ...[...grouped.keys()].filter((handle) => !API_HANDLE_ORDER.includes(handle)),
  ];
  const pages = [
    renderApiIndexPage(
      handles.map((handle) => ({ handle, entries: grouped.get(handle) })),
      handleEntries,
    ),
  ];
  for (const handle of handles) {
    const members = grouped.get(handle);
    const methods = members.filter((entry) => !isApiAttribute(entry));
    const attributes = members.filter(isApiAttribute);
    pages.push(renderApiHandlePage(handle, members));
    for (const entry of methods) {
      pages.push(renderApiMemberPage(entry));
    }
    for (const entry of attributes) {
      pages.push(renderApiMemberPage(entry));
    }
  }
  return pages;
}

/** Validate curated token names against the source sheets. */
function renderTokenTables(tokenNames) {
  const sections = [];
  for (const group of TOKEN_GROUPS) {
    const rows = group.tokens.map(([name, description]) => {
      if (!tokenNames.has(name)) {
        throw new Error(`Design token is missing from source: ${name}`);
      }
      return `| \`${name}\` | ${activeLocale === "en" ? `Design token ${name}.` : description} |`;
    });
    sections.push(
      [
        `**${activeLocale === "en" ? "Token group" : group.title}**`,
        "",
        activeLocale === "en" ? "| Token | Purpose |" : "| Token | 用途 |",
        "| --- | --- |",
        ...rows,
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

/** Render the generated declarative UI tables. */
function renderUiTables(contract) {
  const tagRows = contract.tags.map((tag) => {
    const description = TAG_DESCRIPTIONS[tag];
    if (!description) {
      throw new Error(`Declarative UI tag lacks documentation: ${tag}`);
    }
    return `| \`${tag}\` | ${activeLocale === "en" ? `Allowed declarative ${tag} element.` : description} |`;
  });
  const attrRows = contract.attrs.map((attr) => {
    const description = ATTR_DESCRIPTIONS[attr];
    if (!description) {
      throw new Error(`Declarative UI attribute lacks documentation: ${attr}`);
    }
    return `| \`${attr}\` | ${activeLocale === "en" ? `Allowed ${attr} attribute.` : description} |`;
  });
  return {
    tags: [
      activeLocale === "en" ? "| Tag | Purpose |" : "| 标签 | 用途 |",
      "| --- | --- |",
      ...tagRows,
    ].join("\n"),
    attrs: [
      activeLocale === "en" ? "| Attribute | Contract |" : "| 属性 | 契约 |",
      "| --- | --- |",
      ...attrRows,
    ].join("\n"),
    inputTypes: [
      activeLocale === "en" ? "| Type | Rendering |" : "| type | 渲染 |",
      "| --- | --- |",
      ...contract.inputTypes.map(
        (type) =>
          `| \`${type}\` | ${
            type === "range"
              ? activeLocale === "en"
                ? "Host Slider"
                : "官方 Slider"
              : type === "color"
                ? activeLocale === "en"
                  ? "Host color field"
                  : "官方颜色字段"
                : type === "checkbox"
                  ? activeLocale === "en"
                    ? "Host checkbox"
                    : "官方复选框"
                  : activeLocale === "en"
                    ? "Host input"
                    : "官方 Input"
          } |`,
      ),
    ].join("\n"),
    limits: [
      activeLocale === "en" ? "| Limit | Value | Behavior |" : "| 限制 | 值 | 行为 |",
      "| --- | --- | --- |",
      activeLocale === "en"
        ? `| Nodes | ${contract.maxNodes} | Extra nodes are truncated |`
        : `| 节点数 | ${contract.maxNodes} | 超出部分截断 |`,
      activeLocale === "en"
        ? `| Depth | ${contract.maxDepth} levels | Deeper nodes are truncated |`
        : `| 深度 | ${contract.maxDepth} 层 | 超出部分截断 |`,
      activeLocale === "en"
        ? `| Node id | ${contract.idLimit} characters | Long ids are dropped |`
        : `| 节点 id | ${contract.idLimit} 字符 | 超长 id 丢弃 |`,
      activeLocale === "en"
        ? `| Node class | ${contract.classLimit} characters | Long classes are dropped |`
        : `| 节点 class | ${contract.classLimit} 字符 | 超长 class 丢弃 |`,
      activeLocale === "en"
        ? `| Images | ${contract.maxImageBytes} bytes | Rejected by the picker |`
        : `| 图片 | ${contract.maxImageBytes} 字节 | 选择器拒绝 |`,
      activeLocale === "en"
        ? "| Style keys | `--custom-property` or a property name | Invalid keys are dropped |"
        : "| 样式键 | `--custom-property` 或普通属性名 | 非法键丢弃 |",
      activeLocale === "en"
        ? "| `url()` | Forbidden | Values containing `url(...)` are dropped |"
        : "| `url()` | 禁止 | 含 `url(...)` 的样式值丢弃 |",
    ].join("\n"),
  };
}

/** Wrap the published icon names into a copyable code block. */
function renderIconBlock(names) {
  const lines = [];
  let line = "";
  for (const name of names) {
    const piece = line ? `, ${name}` : name;
    if (line && line.length + piece.length > 88) {
      lines.push(`${line},`);
      line = name;
    } else {
      line += piece;
    }
  }
  if (line) {
    lines.push(line);
  }
  return ["```text", ...lines, "```"].join("\n");
}

/** Read the locale catalog that controls translated pages and shell copy. */
async function loadLocaleCatalog() {
  const source = await readFile(LOCALE_SOURCE, "utf8");
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`docs-sdk/locales.json is not valid JSON: ${error.message}`, { cause: error });
  }
}

/** Return every Markdown file below a directory with POSIX-style paths. */
async function collectMarkdownFiles(directory, prefix = "") {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(directory, relativePath)));
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      files.push(relativePath);
    }
  }
  return files;
}

/** Validate a localized page path before joining it to the documentation root. */
function assertSafeDocsFile(file) {
  if (
    !file ||
    file.startsWith("/") ||
    file.includes("\\") ||
    file.split("/").some((segment) => segment === ".." || segment === "") ||
    extname(file) !== ".md"
  ) {
    throw new Error(`Page file must stay in docs-sdk: ${file}`);
  }
  return file;
}

/** Load one locale's pages and generated API reference. */
async function loadDocs({ locale = DEFAULT_LOCALE, localeCatalog } = {}) {
  const catalog = localeCatalog ?? (await loadLocaleCatalog());
  const localeConfig = catalog.locales?.[locale];
  if (!localeConfig) {
    throw new Error(`Unknown docs locale: ${locale}`);
  }
  const localeDirectory = localeConfig.directory ?? locale;
  if (!/^[a-z0-9-]+$/u.test(localeDirectory)) {
    throw new Error(`Invalid docs locale directory: ${localeDirectory}`);
  }
  activeLocale = locale;
  const indexSource = await readFile(join(DOCS_DIR, "index.json"), "utf8");
  let index;
  try {
    index = JSON.parse(indexSource);
  } catch (error) {
    throw new Error(`docs-sdk/index.json is not valid JSON: ${error.message}`, { cause: error });
  }

  const markdownFiles = await collectMarkdownFiles(DOCS_DIR);
  const slugByFile = new Map();
  const pageEntries = [];
  const seenSlugs = new Set();

  for (const section of index.sections ?? []) {
    if (!section || typeof section.title !== "string" || !section.title.trim()) {
      throw new Error("docs-sdk/index.json has a section without a title");
    }
    const sectionTitle = localeConfig.sections?.[section.title] ?? section.title;
    for (const page of section.pages ?? []) {
      if (!page || typeof page.slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(page.slug)) {
        throw new Error(`docs-sdk/index.json has an invalid page slug: ${page?.slug}`);
      }
      if (seenSlugs.has(page.slug)) {
        throw new Error(`Duplicate page slug in docs-sdk/index.json: ${page.slug}`);
      }
      seenSlugs.add(page.slug);
      if (typeof page.title !== "string" || !page.title.trim()) {
        throw new Error(`Page lacks a title: ${page.slug}`);
      }
      const localizedPage = localeConfig.pages?.[page.slug] ?? {};
      const file = assertSafeDocsFile(localizedPage.file ?? page.file ?? `${page.slug}.md`);
      if (!markdownFiles.includes(file)) {
        throw new Error(`Indexed page file is missing: ${file}`);
      }
      if (slugByFile.has(file)) {
        throw new Error(`Two pages reference the same file: ${file}`);
      }
      slugByFile.set(file, page.slug);
      // Markdown links are intentionally locale-neutral (`types.md`), while
      // source files live under `en/` or `zh/`. Register both the short link
      // form and the concrete source paths so links resolve in either locale.
      const baseFile = `${page.slug}.md`;
      slugByFile.set(baseFile, page.slug);
      slugByFile.set(`${localeDirectory}/${baseFile}`, page.slug);
      if (page.file) {
        slugByFile.set(page.file, page.slug);
      }
      pageEntries.push({
        slug: page.slug,
        title: localizedPage.title ?? page.title,
        file,
        route: page.slug,
        breadcrumb: [sectionTitle, localizedPage.title ?? page.title],
        kind: "page",
        group: "",
        updated: DOCS_UPDATED,
        keywords: Array.isArray(localizedPage.keywords)
          ? localizedPage.keywords.map(String)
          : Array.isArray(page.keywords)
            ? page.keywords.map(String)
            : [],
        order: Number.isFinite(page.order) ? page.order : pageEntries.length,
        section: sectionTitle,
      });
    }
  }

  const localeFiles = markdownFiles.filter((file) => file.startsWith(`${localeDirectory}/`));
  for (const file of localeFiles) {
    if (!slugByFile.has(file)) {
      throw new Error(`Markdown page is not referenced by the ${locale} docs catalog: ${file}`);
    }
  }

  const runtime = await loadRuntimeTables();
  const placeholders = new Map([
    ["{{CAPABILITY_TABLE}}", renderCapabilityTable(runtime.catalog)],
    ["{{METHOD_TABLES}}", runtime.methodTables.markdown],
    ["{{DESIGN_TOKEN_TABLES}}", renderTokenTables(runtime.tokenNames)],
    ["{{UI_TAGS_TABLE}}", runtime.ui.tags],
    ["{{UI_INPUT_TYPES_TABLE}}", runtime.ui.inputTypes],
    ["{{UI_ATTRS_TABLE}}", runtime.ui.attrs],
    ["{{UI_LIMITS_TABLE}}", runtime.ui.limits],
    ["{{CONTEXT_METHODS_TABLE}}", runtime.contextMethodsTable],
    ["{{ICON_NAMES}}", renderIconBlock(runtime.icons)],
  ]);

  const pages = [];
  for (const entry of pageEntries) {
    let source = await readFile(join(DOCS_DIR, entry.file), "utf8");
    for (const [token, value] of placeholders) {
      source = source.replaceAll(token, value);
    }
    const leftover = /\{\{[A-Z_]+\}\}/u.exec(source);
    if (leftover) {
      throw new Error(`Unknown docs placeholder in ${entry.file}: ${leftover[0]}`);
    }
    const rendered = renderMarkdown(source, {
      pageSlug: entry.slug,
      fromFile: entry.file,
      resolveLink(href) {
        if (href.startsWith("#")) {
          return {
            href: `#/page/${entry.slug}${href}`,
            internal: true,
            anchor: href.slice(1),
            targetSlug: entry.slug,
            targetRoute: entry.slug,
          };
        }
        if (/^(?:https?:\/\/|mailto:)/iu.test(href)) {
          return { href, internal: false };
        }
        if (href.startsWith("api:")) {
          const route = href.slice(4);
          const targetRoute = route ? `api/${route}` : "api";
          return {
            href: route ? `#/api/${route}` : "#/api",
            internal: true,
            targetRoute,
          };
        }
        const [rawFile, anchor = ""] = href.split("#");
        const targetFile = rawFile.replace(/^\.\//u, "");
        const targetSlug = slugByFile.get(targetFile);
        if (!targetSlug) {
          throw new Error(`Internal link target is missing: ${href} (from ${entry.file})`);
        }
        return {
          href: `#/page/${targetSlug}${anchor ? `#${anchor}` : ""}`,
          internal: true,
          targetSlug,
          targetRoute: targetSlug,
          anchor,
        };
      },
    });
    if (!rendered.title) {
      throw new Error(`Markdown page lacks a level-1 title: ${entry.file}`);
    }
    if (!rendered.text) {
      throw new Error(`Markdown page has no searchable text: ${entry.file}`);
    }
    if (GUIDE_PAGE_SLUGS.has(entry.slug)) {
      const sections = rendered.headings
        .filter((heading) => heading.level === 2)
        .map((heading) => heading.text);
      const expectedSections = activeLocale === "en" ? GUIDE_PAGE_SECTIONS_EN : GUIDE_PAGE_SECTIONS;
      if (sections.join("|") !== expectedSections.join("|")) {
        throw new Error(
          `Guide page ${entry.file} must use the seven-section scaffold: ${expectedSections.join(
            " / ",
          )}`,
        );
      }
    }
    pages.push({ ...entry, ...rendered });
  }

  const apiPages = renderApiPages(runtime.methodEntries);
  const ordered = [];
  for (const section of index.sections ?? []) {
    if (section.title === "API") {
      ordered.push(...apiPages);
    } else {
      const localizedSection = localeConfig.sections?.[section.title] ?? section.title;
      ordered.push(...pages.filter((page) => page.section === localizedSection));
    }
  }
  const allSlugs = new Set();
  for (const page of ordered) {
    if (allSlugs.has(page.slug)) {
      throw new Error(`Duplicate generated page slug: ${page.slug}`);
    }
    allSlugs.add(page.slug);
  }
  validateLinks(ordered);
  return { index, pages: ordered, runtime, apiPages };
}

/** Reject anchors that do not exist in the target page. */
function validateLinks(pages) {
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  for (const page of pages) {
    for (const link of page.links) {
      if (!link.internal || !link.anchor) {
        continue;
      }
      const target = bySlug.get(link.targetSlug ?? page.slug);
      if (!target) {
        throw new Error(`Link points at a missing page: ${link.href}`);
      }
      if (!target.headings.some((heading) => heading.id === link.anchor)) {
        throw new Error(`Link anchor is missing: ${link.href} (from ${page.file})`);
      }
    }
  }
}

/** Load runtime tables and build every generated Markdown fragment. */
async function loadRuntimeTables() {
  const capabilities = await import(
    pathToFileURL(join(ROOT, "src/core/extensions/capabilities.ts")).href
  );
  const catalog = await import(
    pathToFileURL(join(ROOT, "src/core/extensions/capabilityCatalog.ts")).href
  );
  const methods = await import(
    pathToFileURL(join(ROOT, "src/core/extensions/methodRegistry.ts")).href
  );
  const icons = await import(
    pathToFileURL(join(ROOT, "src/design/components/icon/iconAssets.ts")).href
  );
  const tokenNames = await loadTokenNames();
  const uiContract = await loadUiContract();
  return {
    catalog: catalog.CAPABILITY_CATALOG,
    capabilities: capabilities.EXTENSION_CAPABILITIES,
    methodEntries: methods.EXTENSION_METHODS,
    methodTables: renderMethodTables(
      methods.EXTENSION_METHODS,
      capabilities.EXTENSION_CAPABILITIES,
    ),
    contextMethodsTable: renderContextMethodsTable(methods.EXTENSION_METHODS),
    icons: icons.ICON_NAMES,
    tokenNames,
    ui: renderUiTables(uiContract),
  };
}

/** Build the site into `outDir` and return a summary. */
export async function buildDocsSite({ outDir = DEFAULT_OUT } = {}) {
  const target = resolve(outDir);
  if (target === ROOT || target === DOCS_DIR) {
    throw new Error(`Refusing to replace a source directory: ${target}`);
  }
  const localeCatalog = await loadLocaleCatalog();
  const localePayloads = {};
  let defaultDocs;
  for (const locale of Object.keys(localeCatalog.locales ?? {})) {
    const docs = await loadDocs({ locale, localeCatalog });
    const sections = groupPages(docs.pages);
    const localeConfig = localeCatalog.locales[locale];
    const payload = {
      version: CONTENT_VERSION,
      locale,
      htmlLang: localeConfig.htmlLang,
      title: localeConfig.title,
      description: localeConfig.description,
      generatedAt: new Date().toISOString(),
      shell: localeConfig.shell,
      types: buildTypeCatalog(docs.pages),
      sections,
      nav: buildNavTree(sections),
    };
    localePayloads[locale] = payload;
    if (locale === (localeCatalog.defaultLocale ?? DEFAULT_LOCALE)) {
      defaultDocs = docs;
    }
  }
  if (!defaultDocs) {
    throw new Error(`Default docs locale is missing: ${localeCatalog.defaultLocale}`);
  }
  const defaultPayload = localePayloads[localeCatalog.defaultLocale ?? DEFAULT_LOCALE];
  const content = {
    ...defaultPayload,
    version: CONTENT_VERSION,
    defaultLocale: localeCatalog.defaultLocale ?? DEFAULT_LOCALE,
    locales: localePayloads,
  };

  await rm(target, { recursive: true, force: true });
  await mkdir(join(target, "assets"), { recursive: true });
  await writeFile(join(target, "content.json"), JSON.stringify(content), "utf8");

  const template = await readFile(join(TEMPLATE_DIR, "index.html"), "utf8");
  const firstRoute = defaultDocs.pages[0]?.route ?? "getting-started";
  const html = template
    .replaceAll("{{SITE_TITLE}}", content.title)
    .replaceAll("{{SITE_DESCRIPTION}}", content.description)
    .replaceAll("{{FIRST_ROUTE}}", firstRoute);
  for (const marker of [
    "data-docs-shell",
    'id="docs-search"',
    'id="docs-nav"',
    'id="docs-article"',
    'src="/docs/assets/brand.png"',
  ]) {
    if (!html.includes(marker)) {
      throw new Error(`Site template lacks ${marker}`);
    }
  }
  await writeFile(join(target, "index.html"), html, "utf8");
  for (const asset of ["app.js", "app.css"]) {
    await writeFile(
      join(target, "assets", asset),
      await readFile(join(TEMPLATE_DIR, asset), "utf8"),
    );
  }
  await writeFile(join(target, "assets", "brand.png"), await readFile(BRAND_SOURCE));

  await validateOutput(target, defaultDocs.pages, localePayloads);
  return {
    outDir: target,
    pages: defaultDocs.pages.length,
    methods: defaultDocs.runtime.methodTables.total,
    capabilities: defaultDocs.runtime.catalog.length,
    bytes: Buffer.byteLength(JSON.stringify(content)),
  };
}

/** Group the flat rendered pages back into the index section order. */
function groupPages(pages) {
  const sections = [];
  for (const page of pages) {
    let section = sections.at(-1);
    if (!section || section.title !== page.section) {
      section = { title: page.section, pages: [] };
      sections.push(section);
    }
    section.pages.push({
      slug: page.slug,
      title: page.title,
      route: page.route,
      breadcrumb: page.breadcrumb,
      kind: page.kind,
      group: page.group,
      updated: page.updated,
      keywords: page.keywords,
      html: page.html,
      text: page.text,
      headings: page.headings,
    });
  }
  return sections;
}

/** Build the searchable, non-navigating data-structure inspector catalog. */
function buildTypeCatalog(pages) {
  const references = new Map(Object.keys(TYPE_DETAILS).map((id) => [id, []]));
  for (const page of pages) {
    for (const match of page.html.matchAll(/data-type-id="([^"]+)"/gu)) {
      const id = match[1];
      const list = references.get(id);
      if (list && !list.some((reference) => reference.route === page.route)) {
        list.push({ route: page.route, title: page.title });
      }
    }
  }
  return Object.entries(TYPE_DETAILS).map(([id, detail]) => ({
    id,
    ...detail,
    summary: activeLocale === "en" ? `Public SDK data structure: ${detail.name}.` : detail.summary,
    references: references.get(id) ?? [],
  }));
}

/** Turn one rendered page into a leaf in the sidebar navigation tree. */
function navLeaf(page) {
  return {
    id: `page-${page.slug}`,
    label: page.title,
    route: page.route,
    slug: page.slug,
    kind: page.kind,
    defaultExpanded: false,
    children: [],
  };
}

/** Build one API handle node with its method and attribute member groups. */
function apiHandleNav(handlePage, pages) {
  const members = pages.filter(
    (page) =>
      page.group === handlePage.group && (page.kind === "method" || page.kind === "attribute"),
  );
  const groups = [
    { suffix: "methods", label: activeLocale === "en" ? "Methods" : "方法", kind: "method" },
    {
      suffix: "attributes",
      label: activeLocale === "en" ? "Properties" : "属性",
      kind: "attribute",
    },
  ]
    .map(({ suffix, label, kind }) => {
      const children = members.filter((page) => page.kind === kind).map(navLeaf);
      if (!children.length) {
        return null;
      }
      return {
        id: `api-${handlePage.group}-${suffix}`,
        label,
        route: null,
        slug: "",
        kind: "members",
        defaultExpanded: false,
        children,
      };
    })
    .filter(Boolean);
  return {
    id: `api-${handlePage.group}`,
    label: handlePage.title,
    route: handlePage.route,
    slug: handlePage.slug,
    kind: "handle",
    defaultExpanded: true,
    children: groups,
  };
}

/** Build the API section node: overview, handles, and collapsed member groups. */
function apiSectionNav(section) {
  const pages = section.pages ?? [];
  const apiIndex = pages.find((page) => page.kind === "api-index");
  const handles = pages
    .filter((page) => page.kind === "handle")
    .map((handlePage) => apiHandleNav(handlePage, pages));
  const children = apiIndex
    ? [
        {
          id: `page-${apiIndex.slug}`,
          label: apiIndex.title,
          route: apiIndex.route,
          slug: apiIndex.slug,
          kind: "api-index",
          defaultExpanded: true,
          children: handles,
        },
      ]
    : handles;
  return {
    id: "section-API",
    label: section.title,
    route: null,
    slug: "",
    kind: "section",
    defaultExpanded: true,
    children,
  };
}

/** Build the sidebar hierarchy from the grouped page list. */
function buildNavTree(sections) {
  return (sections ?? []).map((section) =>
    section.title === "API"
      ? apiSectionNav(section)
      : {
          id: `section-${section.title}`,
          label: section.title,
          route: null,
          slug: "",
          kind: "section",
          defaultExpanded: true,
          children: (section.pages ?? []).map(navLeaf),
        },
  );
}

/** Read generated files back and check the host-facing contract. */
async function validateOutput(target, pages, localePayloads = {}) {
  if (!existsSync(join(target, "index.html"))) {
    throw new Error("Generated index.html is missing");
  }
  if (!existsSync(join(target, "content.json"))) {
    throw new Error("Generated content.json is missing");
  }
  const content = JSON.parse(await readFile(join(target, "content.json"), "utf8"));
  if (!content.locales || content.defaultLocale !== DEFAULT_LOCALE) {
    throw new Error("content.json lacks the locale catalog");
  }
  for (const [locale, payload] of Object.entries(localePayloads)) {
    if (
      !content.locales[locale] ||
      !Array.isArray(payload.sections) ||
      !Array.isArray(payload.nav)
    ) {
      throw new Error(`content.json lacks locale payload: ${locale}`);
    }
    const localizedPages = payload.sections.flatMap((section) => section.pages);
    if (localizedPages.length !== pages.length) {
      throw new Error(`Locale ${locale} has a different page count`);
    }
    if (locale === "en") {
      const localizedText = localizedPages.map((page) => `${page.title}\n${page.text}`).join("\n");
      if (/[\u4e00-\u9fff]/u.test(localizedText)) {
        throw new Error("English docs contain Han characters");
      }
    }
  }
  if (!Array.isArray(content.types) || content.types.length !== Object.keys(TYPE_DETAILS).length) {
    throw new Error("content.json lacks the data-structure inspector catalog");
  }
  for (const type of content.types) {
    if (!type.id || !type.name || !type.definition || !Array.isArray(type.references)) {
      throw new Error(`content.json has an incomplete type inspector entry: ${type.id}`);
    }
  }
  const flat = content.sections.flatMap((section) => section.pages);
  if (flat.length !== pages.length) {
    throw new Error("content.json page count does not match the source tree");
  }
  for (const page of flat) {
    if (!page.text || !page.html) {
      throw new Error(`content.json page lacks HTML or search text: ${page.slug}`);
    }
    if (!page.route || !Array.isArray(page.breadcrumb)) {
      throw new Error(`content.json page lacks a route or breadcrumb: ${page.slug}`);
    }
  }
  const navIds = new Set();
  const navRoutes = new Map();
  const visitNav = (nodes, depth) => {
    for (const node of nodes ?? []) {
      if (typeof node.id !== "string" || !node.id) {
        throw new Error("content.json nav has a node without an id");
      }
      if (navIds.has(node.id)) {
        throw new Error(`content.json nav has a duplicate node id: ${node.id}`);
      }
      navIds.add(node.id);
      if (typeof node.defaultExpanded !== "boolean") {
        throw new Error(`content.json nav node lacks defaultExpanded: ${node.id}`);
      }
      if (depth === 0 && !node.defaultExpanded) {
        throw new Error(`content.json top-level nav group must default to expanded: ${node.id}`);
      }
      if (node.route) {
        navRoutes.set(node.route, (navRoutes.get(node.route) ?? 0) + 1);
      }
      visitNav(node.children, depth + 1);
    }
  };
  visitNav(content.nav, 0);
  for (const page of flat) {
    if (navRoutes.get(page.route) !== 1) {
      throw new Error(`content.json nav must reference ${page.route} exactly once`);
    }
  }
  if (navRoutes.size !== flat.length) {
    throw new Error("content.json nav references an unknown route");
  }
  const api = content.sections.find((section) => section.title === "API");
  if (!api) {
    throw new Error("content.json lacks the API section");
  }
  const typePage = content.sections
    .flatMap((section) => section.pages)
    .find((page) => page.route === "types");
  if (!typePage) {
    throw new Error("content.json lacks the types guide page");
  }
  const typeHeadings = new Set(typePage.headings.map((heading) => heading.id));
  for (const anchor of Object.values(TYPE_LINKS)) {
    if (!typeHeadings.has(anchor)) {
      throw new Error(`Types guide is missing the anchor used by API pages: ${anchor}`);
    }
  }
  const apiRoutes = new Set();
  for (const page of api.pages) {
    if (apiRoutes.has(page.route)) {
      throw new Error(`Duplicate API route: ${page.route}`);
    }
    apiRoutes.add(page.route);
    if (!["api-index", "handle", "method", "attribute"].includes(page.kind)) {
      throw new Error(`API page has an unknown kind: ${page.slug}`);
    }
    const headingIds = new Set(page.headings.map((heading) => heading.id));
    if (page.kind === "method" || page.kind === "attribute") {
      for (const required of page.kind === "method"
        ? ["语法", "参数", "返回值", "示例"]
        : ["语法", "返回值", "示例"]) {
        if (!headingIds.has(required)) {
          throw new Error(`API page ${page.route} lacks the ${required} section`);
        }
      }
      if (page.kind === "attribute" && headingIds.has("参数")) {
        throw new Error(`API attribute page must omit the parameter section: ${page.route}`);
      }
      if (!page.html.includes("<h1>")) {
        throw new Error(`API member page lacks its H1: ${page.route}`);
      }
    }
  }
  for (const asset of ["app.js", "app.css"]) {
    const source = await readFile(join(target, "assets", asset), "utf8");
    if (!source.trim()) {
      throw new Error(`Generated asset is empty: ${asset}`);
    }
  }
  const brand = await stat(join(target, "assets", "brand.png"));
  if (!brand.isFile() || brand.size === 0) {
    throw new Error("Generated brand image is missing or empty");
  }
}

/** CLI entry: build the default output and print the summary. */
async function main() {
  const flag = process.argv.indexOf("--out");
  const outDir = flag >= 0 ? process.argv[flag + 1] : DEFAULT_OUT;
  if (!outDir) {
    throw new Error("--out requires a directory");
  }
  const summary = await buildDocsSite({ outDir });
  console.log(
    `Built ${summary.pages} pages, ${summary.methods} API members, ${summary.capabilities} capabilities -> ${
      relative(ROOT, summary.outDir) || summary.outDir
    }`,
  );
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    console.error(`[docs-site] ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}

export { buildNavTree, loadDocs, renderCapabilityTable, renderMethodTables, renderTokenTables };
