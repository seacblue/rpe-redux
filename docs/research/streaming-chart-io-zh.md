# 谱面流式传输与增量解析方案（研究稿）

## 结论

建议保留 RPE JSON / PEZ 作为唯一的磁盘与交换格式，不改谱面序列化契约；把“打开 / 保存”的 I/O 路径整体替换为带帧的流式管线，并按谱面规模自适应两种消费策略：

1. **普通谱面：流式传输 + 增量解析 + 全量物化。** 仍然得到完整的 `Chart` 对象图，但不再在渲染线程上出现整文件字符串、整文件 `JSON.parse` 和多次全量遍历。
2. **极大谱面：流式传输 + 行索引 + 按行分页物化。** 只保留行摘要、当前工作集和按时间窗口激活的行；渲染、时间线、行列表只处理已加载的行，保存时干净行直接复用源分块。

这样做的关键判断是：**真正的瓶颈不是“文件太大所以读得慢”，而是全量字符串、全量对象图、以及打开/保存链路上的多次全量遍历叠加在一起。** 只把传输改成分块，仍然会在主线程上 `JSON.parse`、`assertChart`、`chartFingerprint`、`SceneRuntime.compile` 各遍历一遍，极大谱面依旧不可用。

建议分三期落地：

| 阶段 | 内容 | 是否必须 | 迁移 |
| --- | --- | --- | --- |
| Phase 0 | 拆分校验/指纹/诊断的头与行边界，加入字节上限分块和流式端点，保持行为不变 | 必须 | 无 |
| Phase 1 | 统一流式打开/保存管线，去掉整文件字符串和主线程全量校验/指纹 | 必须 | 无数据库迁移 |
| Phase 2 | 行索引、按行分页、时间窗口渲染、行级历史 | 极大谱面必须 | 库数据库增量迁移（可重建索引） |
| Phase 3 | 列式 IR、协作快照流式化、扩展分块钩子 | 可选 | 协作协议版本升级 |

**不需要迁移谱面格式。** 旧 JSON/PEZ 文件继续按原格式读取；索引是缓存，可随时重建。只有 Phase 2 若要把索引/分块持久化到 SQLite，才需要一次**增量、非破坏性**的 schema 迁移。

这里的“完全替换”指**所有打开/保存入口都走同一套流式管线**：文件、库项目、PEZ、浏览器 File 都通过 `ChartSource` + frame parser；普通谱面只是在这条管线上选择“全量物化”策略，而不是保留另一条整文件读写路径。整图 `JSON.parse` / `JSON.stringify` 仅作为扩展钩子或异常输入的回退。

> 实现状态（本分支）：核心扫描器、行索引（含不相交活动区间）、分块文档、帧协议、浏览器 worker、库流式 GET/commit、native `open_document_stream`/`read_chart_lines` 已落地。编辑器对超过 10,000 行的谱面启用 paged 会话（无已启用扩展、无 Code Cell、无协作房间时），按时间窗口加载行，行树只渲染活动行附近的窗口；其余谱面仍 eager 物化。库打开默认只取 header/index，行通过 `GET /chart/lines` 按需读取，不再把整图原始行留在内存；单行超过批帧上限时，native 通过 `read_chart_line_chunk` 分片读取；paged 保存经有界异步队列逐行输出，不再先收集整串。协作开始或加入前会物化当前 paged 文档，保证房间快照与恢复副本完整。paged 行级历史、保存回放、渲染等价性均有测试覆盖。

---

## 1. 需求拆解

目标：

- 极大谱面（数百 MB、数十万到数百万 note/event、上万行）能够打开、编辑、播放、保存。
- 首屏尽快出现：先拿到 `META`、`BPMList` 和第一批行，就能安装编辑会话并绘制。
- 峰值内存不随谱面线性膨胀：至少不出现“文件 100 MB、堆 1 GB”的对象图放大。
- 保存不要求先把整张谱面 `JSON.stringify` 成一个字符串。
- 不破坏 RPE/PEZ 兼容、版本转换、只读修复、SDK/Extension、协作和现有测试。

非目标：

- 不设计新的磁盘谱面格式，不改变 RPE 字段语义。
- 不重写渲染器；只让渲染器按“当前激活的行”工作。
- 不改变普通谱面的编辑体验和现有快捷键/撤销语义。

---

## 2. 现状与瓶颈

### 2.1 打开路径

当前有四条主要打开路径，最终都会得到完整的 `Chart` 对象图：

| 入口 | 传输 | 解析 | 主线程全量工作 |
| --- | --- | --- | --- |
| 桌面原生文件 | Rust 一次读完整文件（上限 512 MB），`serde_json::from_slice` 成全量 `Value`，再通过 Tauri Channel 按 12 行一批发送 | Rust 全量解析 | 重组 `judgeLineList`、`normalizeChartObjectIdsAsync`、`assertChart`、会话构造时整图指纹、`TimelineActivity.compile`、`SceneRuntime.compile` |
| 库项目 | HTTP `GET /api/projects/{id}` 返回整张谱面 JSON | 浏览器 `response.text()` + `JSON.parse`，在主线程 | 整图校验/归一化/指纹/编译 |
| 拖入 JSON/PEZ | 浏览器路径下 `File.arrayBuffer()` 整文件读入、PEZ 整个 ZIP 读入内存；桌面 native 通过 `ZipArchive` 读取，但 chart 条目仍整图解析 | 解析每个 JSON 条目 | 同上 |
| Worker 解析 | 字节复制后发给 worker | worker 全量 `JSON.parse` + 校验 + 归一化，再按 12 行一批回传 | 主线程仍要 `assertChart`、会话构造、指纹、渲染编译 |

关键代码：

- [`src-tauri/src/documents/open.rs`](../../src-tauri/src/documents/open.rs)：`open_document` 先 `read_file_limited` + `serde_json::from_slice`，然后 `stream_chart` 把 `judgeLineList` 拆成 12 行一批发送。也就是说，**传输是流式的，解析不是**。
- [`src/core/global/document/chartParsing.ts`](../../src/core/global/document/chartParsing.ts)：`parseChartEntries` 对每个条目执行 `JSON.parse`、诊断、`parseChartValue`（校验 + 归一化）。
- [`src/frontend/screens/editor/workspace/document/open/chartParseWorker.ts`](../../src/frontend/screens/editor/workspace/document/open/chartParseWorker.ts)：worker 仍然先得到完整 chart，再按 `CHUNK_LINES = 12` 回传；一行如果有 4 万个 note，仍然是单条巨大消息。
- [`src/frontend/screens/editor/workspace/document/open/chartParseOffThread.ts`](../../src/frontend/screens/editor/workspace/document/open/chartParseOffThread.ts)：主线程重组完整 `judgeLineList`，`markChartObjectIdsNormalized` 只跳过归一化，不能跳过后续校验/指纹。
- [`src/core/global/library/http.ts`](../../src/core/global/library/http.ts)：`performRequest` 用 `response.text()` + `JSON.parse`，整张谱面在主线程解码。
- [`src/core/platform/desktop/documentStore.ts`](../../src/core/platform/desktop/documentStore.ts)：`open` 组装 `chartHeader + chartLines`，再 `normalizeChartObjectIdsAsync`。

### 2.2 保存路径

当前保存同样绕不开整图：

- [`src/frontend/screens/editor/workspace/document/save/chartSerializeOffThread.ts`](../../src/frontend/screens/editor/workspace/document/save/chartSerializeOffThread.ts)：把每一行发给 worker，worker 用 `serializeChart(chart)` 生成**一个完整字符串**再回传。
- [`src/core/platform/desktop/documentStore.ts`](../../src/core/platform/desktop/documentStore.ts)：`save` 把整串文本按 128 KiB 分块写给 Tauri；native 端在 `finish_save_document` 又 `serde_json::from_slice` 成全量 `Value` 再写出。
- [`src/backend/internal/httpapi/api.go`](../../src/backend/internal/httpapi/api.go)：库服务 `maxRequestBody = 64 << 20`，也就是说**谱面 JSON 加上请求包装超过 64 MiB 时无法通过正常库保存提交**。这是一个硬上限，不是性能问题。
- [`src/backend/internal/store/store.go`](../../src/backend/internal/store/store.go)：`CommitProject` 会 `normalizeChart`（`json.Valid` + 反序列化到 `map[string]json.RawMessage`）、`extractMeta`（再次把整图反序列化成 `map[string]any`）、`sha256Hex`、`string(chart)`，一次提交至少复制/遍历多遍。

### 2.3 主线程上的多次全量遍历

打开一张已经解析好的谱面后，主线程还会经历：

1. `createDocumentReplacer` 里的 `assertChart(chart)`（整图结构校验）。
2. `new EditorSession` → `new History` → `chartFingerprint(document)`（整图指纹，同步）。
3. `warmFingerprint()` 在加载完成前再次遍历所有行，预热每行指纹缓存。
4. `TimelineActivity.compile` 遍历所有行，构造每行活动索引。
5. `SceneRuntime.compile` 首次渲染时遍历所有行，构造每行 `LineRuntime`；`sampleInto` 每帧还会遍历所有行。
6. `hitTimeline` 遍历所有 note 生成打击音时间线。
7. `ProjectImages.load` / `resourceReferences` / `chartAssetNames` 等资源扫描。

对应代码：

- [`src/core/global/chart/chart.ts`](../../src/core/global/chart/chart.ts)：`assertChart`、`normalizeChartObjectIds`、`serializeChart`。
- [`src/core/global/chart/chartValidation.ts`](../../src/core/global/chart/chartValidation.ts)：`assertChartStructure` 逐行校验。
- [`src/core/global/chart/diagnostics.ts`](../../src/core/global/chart/diagnostics.ts)：`collectChartDiagnostics` / `sanitizeChartForReadOnly` 逐行扫描。
- [`src/core/edit/session/history.ts`](../../src/core/edit/session/history.ts)：`History` 构造函数同步调用 `chartFingerprint`。
- [`src/core/edit/document/chartRevision.ts`](../../src/core/edit/document/chartRevision.ts)：`chartFingerprint` 遍历所有行；`warmChartFingerprintAsync` 逐行预热。
- [`src/core/edit/timeline/activity.ts`](../../src/core/edit/timeline/activity.ts)：`TimelineActivity.compile` 遍历所有行；`shaderEvents(chart, index)` 每行还会扫描所有 effect 根。
- [`src/core/global/chart/runtime/scene.ts`](../../src/core/global/chart/runtime/scene.ts)：`SceneRuntime.compile` 遍历所有行；`sampleInto` 每帧遍历所有行。
- [`src/core/media/hitTimeline.ts`](../../src/core/media/hitTimeline.ts)：`hitTimeline` 遍历所有 note。

### 2.4 量化数据

在 Node 25.2.1 上对生成的 RPE 结构做了只读探针（不含 React、WebView、worker 副本和渲染器），用于判断数量级：

| 规模 | 紧凑 JSON | `JSON.parse` | `normalize` | `assertChart` | 整图指纹 | `parseChart` | `serializeChart` | 堆 / RSS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 行 / 10 万 note | 19.4 MiB | 74 ms | 66 ms | 357 ms | 396 ms | 568 ms | 420 ms（输出 45.5 MiB） | 200 / 427 MiB |
| 2,000 行 / 40 万 note | 77.5 MiB | 560 ms | 396 ms | 857 ms | 2,467 ms | 2,136 ms | 2,210 ms（输出 182 MiB） | 766 / 929 MiB |
| 10 行 / 40 万 note | 76.6 MiB | 450 ms | 378 ms | 460 ms | 2,590 ms | 1,723 ms | 1,882 ms（输出 176.5 MiB） | 743 / 953 MiB |

再测“解析完成后、主线程安装/编译”的链路：

| 规模 | `parseChart` | `new EditorSession` | `TimelineActivity.compile` | `SceneRuntime.compile` | `hitTimeline` |
| --- | --- | --- | --- | --- | --- |
| 500 行 / 10 万 note | 261 ms | 328 ms | 26 ms | 106 ms | 26 ms |
| 2,000 行 / 40 万 note | 1,364 ms | 2,105 ms | 96 ms | 527 ms | 170 ms |

结论：

- 77 MiB 的紧凑 JSON 已经产生约 0.9 GB RSS；按此放大，接近 512 MB 上限的谱面在 WebView 堆里几乎不可行。
- 即使解析在 worker 里完成，主线程仍要支付约 2.8 秒的安装/编译成本（40 万 note 样本），这还没有算传输和首帧绘制。
- 单行 4 万 note 的样本说明“按行分块”不够：**分块上限必须按字节，而不是按行数**。
- 指纹和校验是独立的全量遍历，不是解析的附带成本；流式解析必须同时把它们改成按行增量。

> 这些数字是数量级证据，不是 WebView2 的最终基准。真实峰值还要加上 worker 中的完整对象图、结构化克隆副本、React/DOM 和 GPU 资源。实现时应把同样的探针放进 `npm run dev` 的性能面板或独立 benchmark，作为阶段验收门槛。

---

## 3. 目标架构

### 3.1 分层

```text
┌──────────────────────────────────────────────────────────────┐
│ 编辑表面：行树 / 时间线 / 预览 / Inspector                    │
│ 只读取“当前激活行 + 已加载行 + 行摘要”                        │
└───────────────────────────────┬──────────────────────────────┘
                                │ ChartDocument（行索引 + LRU）
┌───────────────────────────────▼──────────────────────────────┐
│ ChartDocument：header + line summaries + lazy line cache      │
│ - ensureLine(index) / ensureRange() / dirtyLines()            │
│ - fingerprint() / serialize(sink)                             │
└───────────────────────────────┬──────────────────────────────┘
                                │ ChartStream（带帧）
┌───────────────────────────────▼──────────────────────────────┐
│ ChartSource：native / library / memory / PEZ                  │
│ - header frame / index frame / line frames / effects frames   │
└───────────────────────────────┬──────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────┐
│ Host：Rust 文件读取 / Go SQLite / 浏览器 File.stream          │
│ 增量 JSON 解析，按字节切帧，背压与取消                        │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 核心接口

建议新增 `src/core/global/document/chartSource.ts` 与 `src/core/global/chart/streaming/chartDocument.ts`（名称可调整），把“来源”和“文档”分开：

```ts
/** 一张谱面的非行部分；足以建立 TempoMap、渲染环境和资源引用。 */
export interface ChartHeader {
  readonly META: ChartMeta;
  readonly BPMList: BpmEntry[];
  readonly judgeLineGroup?: string[];
  readonly blockAreaList?: BlockArea[];
  readonly effects?: unknown[];
  readonly shaderEvents?: unknown[];
  readonly markers?: unknown[];
  readonly extras: Record<string, unknown>;
  readonly lineCount: number;
}

/** 一行在索引中的摘要；不含 notes/events 对象。 */
export interface ChartLineSummary {
  readonly index: number;
  readonly byteOffset?: number;
  readonly byteLength?: number;
  readonly noteCount: number;
  readonly eventCount: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly digest: string;
  readonly flags: number;
  readonly group: number;
  readonly father: number;
  readonly id?: string;
}

export interface ChartIndex {
  readonly version: 1;
  readonly headerDigest: string;
  readonly lines: readonly ChartLineSummary[];
  readonly assetNames: readonly string[];
  readonly totalBytes: number;
  readonly canonical: boolean;
}

/** 一行在内存中的状态。 */
export type LineState = "missing" | "loading" | "loaded" | "dirty" | "invalid";

export interface ChartDocument {
  readonly header: ChartHeader;
  readonly index: ChartIndex | null;
  readonly lineCount: number;

  summary(index: number): ChartLineSummary;
  line(index: number): JudgeLine | undefined; // 同步，仅已加载行
  ensureLine(index: number, signal?: AbortSignal): Promise<JudgeLine>;
  ensureRange(start: number, count: number, signal?: AbortSignal): Promise<void>;
  ensureAncestors(index: number): Promise<void>;

  replaceLine(index: number, line: JudgeLine): void;
  insertLine(index: number, line: JudgeLine): void;
  removeLine(index: number): void;
  dirtyLines(): Iterable<number>;

  fingerprint(): string;
  serialize(sink: (chunk: string) => Promise<void>): Promise<void>;
  materializeAll(options?: { signal?: AbortSignal }): Promise<Chart>;
}
```

传输时 `blockAreaList` / `effects` / `shaderEvents` 可以留空，由后续 `EFFECTS` / `BLOCK` 帧填充；header 只保证 `META`、`BPMList`、`lineCount` 等小字段先可用。

`ChartSource` 负责传输，不负责编辑语义：

```ts
export interface ChartSource {
  readonly kind: "native" | "library" | "memory";
  readonly name: string;
  readonly byteLength?: number;
  open(signal?: AbortSignal): Promise<ChartStream>;
}

export interface ChartStream {
  readonly header: Promise<ChartHeader>;
  readonly index: Promise<ChartIndex | null>;
  lines(start: number, count: number, signal?: AbortSignal): AsyncIterable<ChartLineChunk>;
  effects?(signal?: AbortSignal): AsyncIterable<ChartEffectChunk>;
  close(): Promise<void>;
}
```

### 3.3 帧协议

不建议把整张谱面塞进一个 JSON 响应，也不建议用“每行一个 JSON 字符串”作为唯一分块单位（单行可能巨大）。建议使用长度前缀的二进制帧，payload 内部仍是原始 JSON：

```text
frame := u32le length | u8 kind | payload
kind 0x01 HEADER   UTF-8 JSON：ChartHeader（不含 judgeLineList）
kind 0x02 INDEX    UTF-8 JSON：ChartIndex
kind 0x03 LINE     u32 lineIndex + 原始 JSON 对象
kind 0x04 LINES    u32 start + u32 count + 原始 JSON 数组
kind 0x05 EFFECTS  UTF-8 JSON 数组分块
kind 0x06 BLOCK    UTF-8 JSON 数组分块（blockAreaList）
kind 0x07 END      UTF-8 JSON：{ digest, bytes }
kind 0x08 ERROR    UTF-8 JSON：{ code, message, path }
```

要点：

- `LINE` 的 payload 是原始 JSON 文本，主线程按需 `JSON.parse`；worker 不需要把每个 note 对象结构化克隆一遍。
- 单行超过 `MAX_FRAME_BYTES`（例如 4 MiB）时，拆成 `LINE_PART`：`{ lineIndex, part: "head"|"notes"|"events", items }`，保证单帧有界。
- `HEADER` 不包含 `judgeLineList`，避免头帧被大数组拖慢。
- 如果源文件把 `judgeLineList` 写在 `META` 之前，允许先发 `LINE` 后发 `HEADER`；客户端在 header 到达前缓冲有界的行帧。对于可随机访问的来源（本地文件、库分块），优先两遍扫描先生成 header + index。
- HTTP 使用 `Transfer-Encoding: chunked`，`Content-Type: application/x-rpe-chart-stream`；Tauri 使用 `Channel<Vec<u8>>`。两端共用同一个 frame parser。
- 背压：HTTP 由 `ReadableStream` 的拉取自然限速；Tauri Channel 没有显式背压，需要客户端 ack 或“未完成帧数/字节上限”，避免 Rust 侧把整张谱面塞进 IPC 队列。

### 3.4 行索引

索引是 Phase 2 的核心。它把“整张谱面”变成“可随机访问的行集合”：

- `byteOffset` / `byteLength`：本地文件或分块存储的随机读取位置。
- `noteCount` / `eventCount`：行树、统计、进度、资源扫描不需要加载行。
- `startSeconds` / `endSeconds`：按时间窗口决定哪些行需要激活。
- `digest`：每行内容指纹，整图指纹由 header + 行 digest 聚合，不需要每次遍历所有 note。
- `flags`：缺省字段、非法行、shader、noise 等标记，供版本转换、只读修复和渲染使用。
- `father` / `group` / `id`：父链解析、行树、协作寻址。

索引的持久化：

| 来源 | 存放 | 失效条件 |
| --- | --- | --- |
| 本地 JSON | 应用数据目录下的索引缓存（按路径 + size + mtime 或内容哈希） | 文件变化 |
| PEZ | 按归档哈希 + 条目名缓存；或首次打开时解压 chart 到临时缓存 | 归档变化 |
| 库项目 | SQLite 的 `chart_index`（Phase 2 增量 schema） | `projects.revision` 变化 |
| 浏览器 File | 内存索引；可选 IndexedDB 缓存 | 文件变化 |

索引永远是可重建缓存；缺失、损坏或版本不匹配时退回顺序扫描，不影响正确性。

注意：SQLite 的 `projects.chart` 是单行 TEXT，只加索引仍然要把整行读进 Go 内存才能切片。如果 Phase 2 要真正随机读取，库侧应把大谱面存成 `chart_chunks` 或外部 blob，索引指向 chunk；普通谱面可以继续用单行 TEXT，保持现有查询简单。

压缩可以作为传输层优化（HTTP `Content-Encoding`）或存储层优化（分块压缩），但不要让压缩破坏行偏移语义；如果采用压缩，索引应记录“解压后偏移”或按压缩块建索引。第一期不引入压缩，优先保证正确性和可观测性。

一个必须提前定下的细节：**分页模式不能让整图指纹依赖“哪些行已经被物化”**。当前 `chartFingerprint` 会把 `id` 字段一起哈希；如果只为已加载行补 id，指纹就会随加载顺序变化。两种可行方案：

- 在索引阶段为所有 line/note/event 生成稳定 id，并用紧凑表存储；物化时注入对象，指纹使用同一套 id。
- 或者把 editor-only 的 `id` 从 canonical 文档指纹中排除，协作寻址仍使用 id；这需要一次指纹契约变更和回归测试。

无论选哪种，都要保证 eager/paged、打开/保存、协作指纹对同一内容给出一致结果。

### 3.5 自适应策略

同一套管线，按规模选择消费策略：

| 条件 | 策略 | 行为 |
| --- | --- | --- |
| `bytes <= 16 MiB` 且 `lines <= 2,000` | eager | 流式解析后全量物化；保留现有编辑/协作/扩展行为 |
| `bytes <= 128 MiB` | progressive | 首批行到达即安装会话，后台继续填充；全量物化但避免整文件字符串和重复遍历 |
| `bytes > 128 MiB` 或 `notes > 500k` 或 `lines > 20k` | paged | 行索引 + LRU + 时间窗口渲染；协作/扩展按能力降级 |
| `bytes > 512 MiB` | paged + 明确确认 | 超过 native 当前上限时拒绝或要求用户确认；不要静默 OOM |

阈值应可配置、可观测，不作为产品承诺；实现时用真实 WebView2 基准校准。

### 3.6 打开时序

```text
UI                DocumentProvider        ChartSource/Host        Parser Worker        ChartDocument
 | open(path)            |                       |                     |                    |
 |---------------------->| open()                |                     |                    |
 |                       |---------------------->| read/parse header   |                    |
 |                       |                       |-------------------->| header + index     |
 |                       |                       |                     |------------------->|
 |                       |                       | first line batch    |                    |
 |                       |                       |-------------------->| lines              |
 |                       |                       |                     |------------------->|
 |                       | install session after header + first batch |                    |
 |<----------------------| render first frame    |                     |                    |
 |                       |                       | remaining lines     |                    |
 |                       |                       |-------------------->| append/evict       |
 |                       |                       |                     |------------------->|
 |                       |                       | done                |                    |
 |<----------------------| mark ready / background fill continues      |                    |
```

关键点：

- **先安装会话，再继续加载。** 当前 `replaceChart` 必须等完整 chart；Phase 1 改为 header + 首批行即可安装。
- **优先加载当前行和父链。** 如果恢复的 view state 指向第 5000 行，先请求该行及其祖先，而不是从第 0 行顺序加载。
- **进度分两段。** “可交互”与“后台填充完成”分开；用户可以先编辑当前行，状态栏显示剩余行加载进度。
- **取消要彻底。** 新的打开请求应中止旧流、终止 worker、释放行缓存；`TauriDocumentStore.openRevision` 和 `DocumentChangeCoordinator` 已有类似机制，需要把 `AbortSignal` 贯穿到 source/parser。

### 3.7 保存时序

```text
ChartDocument          serializeChartChunks          Tauri save session / Go commit session
 | header + line slots         |                                   |
 |--------------------------->| frame(HEADER)                     |
 | dirty line -> serialize     | frame(LINE)                       |
 | clean line -> raw chunk     | frame(LINE)                       |
 |--------------------------->|---------------------------------->| append temp file / SQLite
 |                            |                                   | validate + hash + index
 |                            |                                   | commit atomically
```

要点：

- `serializeChartChunks` 逐行输出，**不再构造整图字符串**。
- 干净行优先复用源分块；只有 dirty 行重新序列化。这样保存成本从 O(整图) 降到 O(改动行 + 传输)。
- 如果源分块不是当前序列化器的 canonical 形式，首次保存做一次 canonical 化并标记 `canonical`；后续保存复用。
- `projectChartForExport` 的逐行投影：`normalizeLine`、note/event 默认值、noise line 投影都可以按行做；`ReduxExportDefaults` 的行号列表从索引 flags 或 dirty 行汇总得到，不需要整图预扫描。
- 库提交走 `begin / write / finish` 会话（与 Tauri 保存会话同构），绕开 `maxRequestBody = 64 MiB`。
- 如果 Phase 2 使用分块存储，干净行可以直接从源 chunk 复制到新 revision；不需要重新编码。

### 3.8 分页编辑语义

这是 Phase 2 最容易低估的部分。现有编辑器大量假设：

```ts
session.chart.judgeLineList[index]; // 一定是完整 JudgeLine
```

分页模式不能透明地返回 `undefined` 而不改调用方。建议分三层处理：

1. **核心热路径改用 `ChartDocument`**：`SceneRuntime`、`TimelineActivity`、`hitTimeline`、`resourceReferences`、`serialize`、`fingerprint`、行树/概览数据源。
2. **编辑路径保证当前行已加载**：选择行、多选、剪贴板、多行编辑、Inspector 操作前 `await document.ensureLine(index)`；多选加载数量设上限（例如 32 行）。
3. **兼容层只给旧调用方**：`session.chart` 在 paged 模式返回一个 `Chart` 外观对象，`judgeLineList` 是 array-like：`length` 正确，未加载行返回带 `_reduxPlaceholder: true` 的占位行（空 notes/eventLayers + 摘要字段）。占位行永远不参与序列化，编辑前必须替换为真实行。

占位行是过渡手段，不是最终契约。核心热路径不应依赖它；否则一个未加载行被当成空行，会静默丢数据。

渲染侧的分页策略：

- `SceneRuntime` 增加 `setActiveLines(indices)`，只编译/采样当前时间窗口内的行；`sampleInto` 遍历 `activeLines` 而不是所有行。
- 行进入窗口时 `ensureLine` + `ensureAncestors`；父链必须先加载，否则世界变换错误。
- `TimelineActivity` 按行增量 `addLine/updateLine/removeLine`；`duration` 从索引摘要取最大值，不再全量遍历。
- `shaderEvents` 目前对每行扫描所有 effect 根；改为一次建立 `lineIndex -> effects[]` 映射，再按行取。
- `hitTimeline` 只生成当前时间窗口的触发；或者按行索引 + 时间二分查询。
- 行树/概览只渲染可见窗口（虚拟列表）；未加载行显示摘要和加载状态。

### 3.9 历史与协作边界

- **历史**：eager 模式继续使用现有 `History`（before/after 整图引用 + 结构共享）。paged 模式增加 `LinePatch` 历史：`{ index, before?: JudgeLine, after?: JudgeLine }` + header patch；撤销/重做只替换受影响行。这样不会因为一次编辑复制整个 `judgeLineList`。
- **协作**：房间服务器目前持有完整 chart，欢迎快照也是整图。Phase 2 建议对超过阈值的谱面禁用房间或提示“协作模式不支持超大谱面”；Phase 3 再把欢迎快照改成同样的流式帧。对象寻址的 `ChartChange` 与行分页天然兼容：改动落到某行时按需加载该行即可。
- **扩展/SDK**：`chart:parse`、`chart:parsed`、`chart:validate`、`chart:serialize` 这些钩子都假设完整 chart。最安全的规则是：**注册了这些钩子就强制 eager 模式**；`chart.snapshot` / `document.openBytes` / Code Cell 也按需 `materializeAll()`，并在超大谱面上返回明确错误或降级提示。后续可以增加按行/按块的扩展 API，但不要在第一期破坏现有契约。

---

## 4. 关键改动清单

### 4.1 Core：解析、校验、序列化、指纹

| 文件 | 关键函数 | 改动 |
| --- | --- | --- |
| [`src/core/global/chart/chart.ts`](../../src/core/global/chart/chart.ts) | `parseChartValue` / `parseChart` / `serializeChart` / `normalizeChartObjectIds` | 拆出 `parseChartHeader`、`parseChartLine`、`finishParsedChart` 的 header/line 两段；`normalizeChartObjectIds` 增加按行版本和共享 ID 集合；新增 `serializeChartChunks(chart, sink)` |
| [`src/core/global/chart/chartValidation.ts`](../../src/core/global/chart/chartValidation.ts) | `assertChartStructure` / `assertEventTrackStructure` | 拆成 `assertChartHeaderStructure` + `assertJudgeLineStructure`；保留整图 `assertChart` 兼容 |
| [`src/core/global/chart/diagnostics.ts`](../../src/core/global/chart/diagnostics.ts) | `collectChartDiagnostics` / `sanitizeChartForReadOnly` | 增加 `collectLineDiagnostics`、`sanitizeLineForReadOnly`；header 与行分别累计 |
| [`src/core/global/chart/compatibility.ts`](../../src/core/global/chart/compatibility.ts) | `detectChartCompatibility` / `convertChartToCurrentVersion` | header-only 检测；`convertLine` 逐行应用；缺省字段计数来自索引 flags |
| [`src/core/global/chart/exportProjection.ts`](../../src/core/global/chart/exportProjection.ts) | `projectChartForExport` / `normalizeLine` | 增加 `projectLineForExport(line, index)`；默认值行号从索引/行投影累计；`projectNoiseLinesForExport` 对含 noise 设置的行单独处理 |
| [`src/core/global/chart/exportProjection.ts`](../../src/core/global/chart/exportProjection.ts) | `serializeChartForExport` | 改为基于 `serializeChartChunks` |
| [`src/core/edit/document/chartRevision.ts`](../../src/core/edit/document/chartRevision.ts) | `chartFingerprint` / `warmChartFingerprintAsync` | 增加 `ChartFingerprintBuilder`：`addHeader`、`addLine(index, line, digest?)`、`finish()`；行 digest 写入索引；paged 模式不遍历未加载行 |
| [`src/core/global/chart/shader/shaderEvents.ts`](../../src/core/global/chart/shader/shaderEvents.ts) | `shaderEvents` | 从“每行扫描所有 effect 根”改为一次建立 `line -> effects` 索引；支持增量添加行 |
| [`src/core/media/hitTimeline.ts`](../../src/core/media/hitTimeline.ts) | `hitTimeline` | 增加按时间窗口/按行查询；paged 模式不生成全量数组 |

### 4.2 文档层与前端打开流程

| 文件 | 关键函数 | 改动 |
| --- | --- | --- |
| [`src/core/global/document/chartParsing.ts`](../../src/core/global/document/chartParsing.ts) | `parseChartEntries` / `ChartEntryParser` | 增加 `parseChartStream(source)`；保留整图入口作为小谱面/扩展钩子回退 |
| [`src/core/global/document/import.ts`](../../src/core/global/document/import.ts) | `openFiles` | 返回 `ChartSource` 或 `ChartDocument`，不再强制完整 `OpenCandidate.chart` |
| [`src/core/global/document/pez.ts`](../../src/core/global/document/pez.ts) | `readPez` / `ArchiveReader` | 增加流式读取选中 chart 条目；避免整 ZIP + 整 chart 同时驻留 |
| [`src/core/global/document/types.ts`](../../src/core/global/document/types.ts) | `OpenCandidate` / `EditorCandidate` | 增加 `document?: ChartDocument`、`paged?: boolean`；`chart` 继续服务 eager 路径 |
| [`src/core/global/document/loading.ts`](../../src/core/global/document/loading.ts) | `LoadStage` / `LoadTask` | 增加 `header`、`index`、`background` 阶段；区分“可交互”和“后台填充完成” |
| [`src/frontend/screens/editor/workspace/document/open/chartParseWorker.ts`](../../src/frontend/screens/editor/workspace/document/open/chartParseWorker.ts) | worker 消息协议 | 改为 frame 流；按字节而不是 12 行切块；单行过大时拆 note/event 分片；不保留完整 chart |
| [`src/frontend/screens/editor/workspace/document/open/chartParseOffThread.ts`](../../src/frontend/screens/editor/workspace/document/open/chartParseOffThread.ts) | `parseChartEntriesOffThread` | 返回 `ChartDocument`/`ChartStream`；主线程不再重组完整 `judgeLineList` |
| [`src/frontend/screens/editor/workspace/document/open/candidateLoader.ts`](../../src/frontend/screens/editor/workspace/document/open/candidateLoader.ts) | `createCandidateLoader` / `reportChartObjectProgress` | header + 首批行即 `replaceChart`；进度从索引/帧统计；资源加载延后到行加载 |
| [`src/frontend/screens/editor/workspace/document/lifecycle/replacer.ts`](../../src/frontend/screens/editor/workspace/document/lifecycle/replacer.ts) | `createDocumentReplacer` | 接受 `ChartDocument`；header/行分别校验；eager 模式仍可整图 `assertChart` |
| [`src/frontend/screens/editor/workspace/document/lifecycle/sessionInstaller.ts`](../../src/frontend/screens/editor/workspace/document/lifecycle/sessionInstaller.ts) | `createSessionInstaller` | 支持 `EditorSession.fromDocument`；paged 模式不再同步整图指纹 |
| [`src/frontend/screens/editor/workspace/runtime/providers/DocumentProvider.tsx`](../../src/frontend/screens/editor/workspace/runtime/providers/DocumentProvider.tsx) | `loadCandidate` / `replaceChart` / `prepareCandidate` | 把 source/document 贯穿；转换提示基于 header；扩展钩子存在时强制 eager |

### 4.3 会话、历史、渲染

| 文件 | 关键函数 | 改动 |
| --- | --- | --- |
| [`src/core/edit/session/session.ts`](../../src/core/edit/session/session.ts) | `EditorSession` 构造函数 / `chart` getter / `warmFingerprint` | 增加 `fromDocument`；paged 模式 `chart` 返回兼容外观；指纹走 builder |
| [`src/core/edit/session/history.ts`](../../src/core/edit/session/history.ts) | `History` / `HistoryCommand` / `record` | 增加 `LinePatch` 历史；paged 模式不再存整图 before/after；eager 模式保持现状 |
| [`src/core/edit/timeline/activity.ts`](../../src/core/edit/timeline/activity.ts) | `TimelineActivity.compile` / `LineActivity` | 增加 `addLine/updateLine/removeLine`；duration 从索引摘要取；只编译已加载/激活行 |
| [`src/core/global/chart/runtime/scene.ts`](../../src/core/global/chart/runtime/scene.ts) | `SceneRuntime.compile` / `sampleInto` / `LineRuntime` | 增加 `setActiveLines`；按行增量编译；`sampleInto` 只遍历激活行；父链按需加载 |
| [`src/frontend/screens/editor/workspace/runtime/frame/frameDrawing.ts`](../../src/frontend/screens/editor/workspace/runtime/frame/frameDrawing.ts) | `draw` | 高密度判断从全量 `reduce` 改为索引统计；paged 模式只绘制激活行 |
| [`src/frontend/screens/editor/workspace/timeline/overview/timelineOverview.ts`](../../src/frontend/screens/editor/workspace/timeline/overview/timelineOverview.ts) | `TimelineOverview` | 使用增量 activity；行缩略图按需加载 |
| [`src/frontend/screens/global/sections/lines/LineTree.tsx`](../../src/frontend/screens/global/sections/lines/LineTree.tsx) | 行/卡片渲染 | 虚拟列表/网格；未加载行用摘要；避免一次渲染上万 DOM 行 |
| [`src/core/global/document/resources.ts`](../../src/core/global/document/resources.ts) | `resourceReferences` | 使用 header + info；资源名从索引 manifest 读取 |
| [`src/core/collaboration/assets.ts`](../../src/core/collaboration/assets.ts) | `chartAssetNames` | 使用索引 manifest；paged 模式不遍历所有 note |

### 4.4 保存、桌面宿主、本地服务

| 文件 | 关键函数 | 改动 |
| --- | --- | --- |
| [`src/frontend/screens/editor/workspace/document/save/chartSerializeOffThread.ts`](../../src/frontend/screens/editor/workspace/document/save/chartSerializeOffThread.ts) | `serializeChartOffThread` | 返回 `AsyncIterable<string>` 或直接写 sink；不再返回整串 |
| [`src/frontend/screens/editor/workspace/document/save/saver.ts`](../../src/frontend/screens/editor/workspace/document/save/saver.ts) | `createDocumentSaver` | 保存快照改为 `ChartDocument.serialize`；库提交走流式会话 |
| [`src/core/platform/desktop/documentStore.ts`](../../src/core/platform/desktop/documentStore.ts) | `TauriDocumentStore.save` / `open` | `save` 接受流；`open` 使用 `ChartSource`；新增 `openChartStream` |
| [`src-tauri/src/documents/open.rs`](../../src-tauri/src/documents/open.rs) | `open_document` / `stream_chart` / `read_pez_progress` | 用 `serde_json::Deserializer` + `SeqAccess`/`RawValue` 逐行解析；新增 `read_chart_lines` 随机读取；PEZ 选中条目流式解压 |
| [`src-tauri/src/documents/save.rs`](../../src-tauri/src/documents/save.rs) | `begin_save_document` / `finish_save_document` | 支持“已投影的原始 JSON 流”直接写文件，跳过 `serde_json::from_slice` 整图；PEZ 使用流式 zip writer |
| [`src/backend/internal/httpapi/api.go`](../../src/backend/internal/httpapi/api.go) | `handleGetProject` / `handleCommitProject` / `decodeBody` | 增加 `GET /chart/stream`、`GET /chart/lines`；增加 `commit/begin`、`commit/write`、`commit/finish` 会话；保留现有整图端点 |
| [`src/backend/internal/store/store.go`](../../src/backend/internal/store/store.go) | `CommitProject` / `extractMeta` / `normalizeChart` | 增加流式 commit：边写临时文件边计算 hash/metadata/index；`extractMeta` 改为流式；Phase 2 增加 chunk/index 表 |
| [`src/core/global/library/client.ts`](../../src/core/global/library/client.ts) | `LocalLibrary.get` / `commit` | 增加 `chartStream(id)` / `commitStream`；保留 `get` 整图接口给 SDK/测试 |
| [`src/core/global/library/document.ts`](../../src/core/global/library/document.ts) | `openLibraryProject` | 使用 `ChartSource`；asset map 仍懒加载 |
| [`src/core/global/library/save.ts`](../../src/core/global/library/save.ts) | `saveLibraryDocument` | 接受 `AsyncIterable<string>`；提交会话化 |

### 4.5 关键函数签名建议

```ts
// 解析
export function parseChartHeader(value: unknown): ChartHeader;
export function parseChartLine(value: unknown, index: number, context: ParseContext): JudgeLine;

// 校验
export function assertChartHeaderStructure(header: ChartHeader): void;
export function assertJudgeLineStructure(line: unknown, index: number): void;

// 归一化
export function normalizeChartObjectIdsStreaming(
  chart: ChartDocument,
  assign: ChartIdentityAssigner,
): void;

// 指纹
export class ChartFingerprintBuilder {
  addHeader(header: ChartHeader): void;
  addLine(index: number, line: JudgeLine | null, digest?: string): void;
  finish(): string;
}

// 序列化
export async function serializeChartChunks(
  chart: Chart | ChartDocument,
  sink: (chunk: string) => Promise<void>,
  options?: { canonical?: boolean; exportProjection?: boolean; signal?: AbortSignal },
): Promise<void>;

// 文档
export async function openChartDocument(
  source: ChartSource,
  options?: { signal?: AbortSignal; materialize?: "eager" | "paged" },
): Promise<ChartDocument>;
```

---

## 5. 可行性评估

| 部分 | 可行性 | 风险 | 说明 |
| --- | --- | --- | --- |
| 带帧流式传输 | 高 | 低 | Tauri `Channel` 和 HTTP chunked 都已具备；现有保存已经用分块 IPC |
| 增量 JSON 解析 | 高 | 中 | Rust `serde_json::Deserializer`、Go `json.Decoder` 都能逐元素读取；浏览器 worker 需要一个小的扫描器，按数组元素切片后 `JSON.parse`。用 `JSON.parse` 对照测试保证语义 |
| 字节上限分块 | 高 | 低 | 把 12 行/批改成 `MAX_FRAME_BYTES`；单行超大时拆 note/event 分片 |
| 主线程去全量校验/指纹 | 高 | 中 | 需要把 `assertChart`、`chartFingerprint`、`collectChartDiagnostics` 拆成 header/line；现有 per-line 缓存可以复用 |
| 流式保存 | 高 | 中 | 现有 Tauri 保存会话已经是 `begin/write/finish`；主要改前端不再生成整串，以及 native/Go 不重新解析整图 |
| 库 64 MiB 上限 | 高 | 低 | 用会话化 commit 绕过 `maxRequestBody`；这是必须修的硬限制 |
| 按行分页编辑 | 中 | 高 | 最大工作量。需要审计所有 `judgeLineList` 访问，改核心热路径，处理父链、历史、占位行和协作 |
| 时间窗口渲染 | 中 | 高 | `SceneRuntime.sampleInto` 目前每帧遍历所有行；需要 active-line 集合、增量编译和父链加载 |
| 行树虚拟化 | 高 | 低 | 纯前端列表/网格虚拟化，独立可做 |
| 扩展/SDK 兼容 | 高 | 中 | 有钩子时回退 eager；`chart.snapshot` 需要 `materializeAll` 或明确限制 |
| 协作超大谱面 | 中 | 高 | 房间服务器仍持有整图；Phase 2 建议先限流/禁用，Phase 3 再做快照流式化 |

总体判断：

- **Phase 0 + Phase 1 可行且收益明确。** 它们不改变谱面格式，不需要数据库迁移，能解决“打开慢、主线程卡、库保存 64 MiB 上限”和解析/传输阶段的重复内存；对象图本身的峰值内存仍需要 Phase 2 的分页来根治。
- **Phase 2 是“极大谱面”的真正门槛。** 技术上可行，但它不是单纯的 I/O 改造，而是编辑器数据模型的改造；需要独立分支、特性开关和较长的回归周期。
- **Phase 3 不是必须。** 只有在 Phase 2 之后仍然被 JS 对象开销卡住时，才值得做列式 IR。

### 5.1 当前实现实测

以下数据来自本分支的 `scripts/benchmarkChartStreaming.mjs`（Node 25，同一台机器；不是 WebView2 最终数据）：

| 规模 | 整图 `parseChart` | 扫描 + 行索引 | 文档全量物化 | 分页 `ensureTime` | 分块序列化 |
| --- | --- | --- | --- | --- | --- |
| 2,000 行 / 4 万 note / 24.8 MiB | 369 ms | 652 ms | 181 ms | 4.7 ms（加载 23/2,000 行） | 172 ms |
| 10,000 行 / 20 万 note / 124 MiB | 4,670 ms | 8,519 ms | 9,527 ms | 61 ms（加载 23/10,000 行） | 7,131 ms |

解读：

- 分页窗口把“打开时要处理的谱面”从整图降到 23 行，说明行索引 + 时间窗口的方向成立。
- 扫描 + 行索引目前比整图 `JSON.parse` 慢约 1.8 倍，因为每行都要解析、计数、校验和计算 digest；这是下一步可以优化的点（按需 digest、worker 批量、避免重复遍历）。
- 全量物化和分块序列化已经比早期原型快一个数量级（`LINE_FLAG_IDS` 跳过重复归一化、索引摘要复用）；大谱面仍应走分页，而不是先全量物化。
- 这些数字会随机器和 WebView2 变化；实现时把 benchmark 放进 CI 的性能门槛，而不是只跑一次。

---

## 6. 影响面

### 6.1 模块影响

| 区域 | 影响 |
| --- | --- |
| `core/global/chart/` | 解析、校验、诊断、兼容转换、导出投影、指纹、序列化都要增加 header/line 两段式 API |
| `core/global/document/` | 新增 `ChartSource` / `ChartStream` / `ChartDocument`；`OpenCandidate`/`EditorCandidate` 增加 document 字段 |
| `core/edit/session/` | `EditorSession` / `History` 支持 document 与 line patch；eager 路径保持 |
| `core/edit/timeline/` | `TimelineActivity` 增量编译；时间线只处理激活行 |
| `core/global/chart/runtime/` | `SceneRuntime` 增量编译/采样；父链按需加载 |
| `core/global/library/` | 客户端增加流式 GET/commit；保存不再依赖整串 |
| `core/platform/desktop/` | 文档打开/保存改为 source/stream；恢复、磁盘快照、资产存储保持 |
| `frontend/.../document/` | worker 协议、候选加载、替换、保存全部改流式 |
| `frontend/.../timeline/` | 概览/缩略图按需加载；行树虚拟化 |
| `src-tauri/src/documents/` | 增量解析、随机行读取、流式保存/PEZ |
| `src/backend/` | 流式 GET/commit、流式 metadata/hash、Phase 2 schema |
| `core/collaboration/` | 大谱面房间限制；Phase 3 快照流式化 |
| `core/extensions/` / `sdk/` | 钩子回退 eager；SDK 行为不变，新增能力另议 |
| `i18n/` | 新增“大谱面模式/按需加载/功能受限”等中英文键 |
| `docs/` | 更新 compatibility、architecture、testing；新增本研究稿 |
| `src/test/` | 新增流式解析、帧协议、保存回放、取消/背压、paged 模式测试 |

### 6.2 用户可见行为

- 打开大谱面时先出现第一屏，剩余行在后台加载；状态栏/加载面板显示“可交互”和“后台填充”两段状态。
- 大谱面模式下行树/概览可能显示“未加载”占位，选中后加载；这是新的交互状态，需要文案和可访问性处理。
- 保存进度按行/字节推进；库保存不再受 64 MiB 限制。
- 协作/扩展在超大谱面上可能被禁用或降级，需要明确提示，不能静默失败。

### 6.3 测试影响

现有测试大多假设“打开后完整 chart 可用”。需要新增/调整：

- `src/test/chart/document/chartLoading.test.mjs`：增加流式与整图等价性。
- 新增 `src/test/chart/document/chartStreaming.test.mjs`：帧协议、单行超大、header 后置、截断、BOM/CRLF、重复 ID。
- 新增 `src/test/chart/document/chartSaveStreaming.test.mjs`：流式保存输出与 `serializeChart` 语义等价。
- `src/test/editor/session/historyTransactions.test.mjs`：line patch 撤销/重做。
- `src/test/rendering/preview/*`：active-line 采样与整图采样等价。
- `src/test/e2e/`：文档打开/保存 P0 流程。
- `src/backend/internal/httpapi/api_test.go` / `store_test.go`：流式 GET/commit、hash/metadata、并发/冲突。
- `src-tauri/src/documents/*`：Rust 增量解析/保存/PEZ 测试。
- `npm run smoke`：打包窗口的真实打开/保存/播放。

---

## 7. 迁移评估

| 项目 | 是否需要迁移 | 建议 |
| --- | --- | --- |
| RPE JSON / PEZ 谱面格式 | **否** | 保持唯一磁盘格式；流式解析器必须接受现有所有合法 JSON 形状（包括 `judgeLineList` 在 `META` 前） |
| 现有谱面文件 | **否** | 旧文件直接走流式解析；小谱面仍可回退整图解析 |
| 本地库 SQLite | Phase 2 需要**增量**迁移 | 增加 `chart_index`（以及可选 `chart_chunks`）表/列；旧行惰性建索引；索引可重建，不删除旧数据 |
| 库 API | **否**（新增端点） | 保留 `GET /api/projects/{id}` 和现有 commit；新增流式端点，客户端按版本探测使用 |
| 桌面 IPC | **否**（新增命令） | 保留 `open_document`/`begin_save_document`；新增 `read_chart_lines` 或扩展 channel 协议 |
| SDK / Extension API | **否** | 现有 `chart.snapshot`/`openBytes` 保持；paged 模式按需 `materializeAll` 或明确报错；钩子回退 eager |
| 协作协议 | Phase 2 否，Phase 3 是 | 大谱面先限流/禁用；快照流式化需要协议版本升级（房间已要求同版本） |
| 索引缓存 | **否** | 纯缓存，删除/重建安全；版本不匹配直接重建 |
| 用户数据 | **否** | 不做破坏性迁移；备份/恢复逻辑保持 |
| 测试夹具 | 需要补充 | 新增流式/超大/畸形夹具；不要求真实大谱面入库，可生成 |

**迁移原则：**

- 谱面格式是兼容契约，不动。
- 数据库只做加法；索引是缓存，不是唯一数据源。
- 旧客户端/旧项目文件必须能被新版本打开；新版本写出的文件必须能被旧 RPE/PEZ 读取。
- 任何“只在新格式可用”的能力都不能成为默认路径。

---

## 8. 实施计划

> 以下工期是数量级估计，前提是现有测试和性能基准可用；实际取决于 Phase 2 对编辑器热路径的审计范围。

### Phase 0：拆分边界 + 可观测性（约 1–2 周）

- 拆 `assertChart`、`collectChartDiagnostics`、`detectChartCompatibility`、`convertChartToCurrentVersion` 的 header/line 两段。
- 增加 `ChartFingerprintBuilder`，让 worker 可以按行计算 digest，主线程只聚合。
- 把 native/worker 的“12 行/批”改为字节上限分块；单行超大时拆 note/event 分片。
- 增加 benchmark/性能标记：`read`、`parse`、`normalize`、`validate`、`fingerprint`、`install`、`firstPaint`、`sceneCompile`、`timelineCompile`。
- 行为不变，作为 Phase 1 的基线。

**退出标准：** 现有测试全绿；能复现当前峰值内存/耗时；有可重复的 10 万/40 万 note 基准。

### Phase 1：统一流式打开/保存（约 2–4 周）

- 实现 frame 协议与 `ChartSource`/`ChartStream`。
- native/Go/worker 增量解析；主线程不再整文件 `JSON.parse`。
- `ChartDocument` 先支持 eager 物化；header + 首批行安装会话，后台继续填充。
- `serializeChartChunks` + 流式保存会话；库 commit 绕过 64 MiB 上限。
- 主线程不再重复 `assertChart`/整图指纹；改用 header/line 校验与指纹聚合。
- 扩展钩子存在时回退整图路径。

**退出标准：**

- 100–200 MB 谱面可打开/保存；首屏在首批行到达后出现。
- 主线程无超过 50 ms 的整图任务（除首次 `SceneRuntime` 可按阶段拆分）。
- 打开/保存输出与现有 `parseChart`/`serializeChart` 语义等价。
- 所有现有 P0 流程通过。

### Phase 2：按行分页（约 6–10 周）

- 行索引持久化（native 缓存 / library 增量 schema）。
- `ChartDocument` 的 LRU 行缓存、`ensureLine`/`ensureRange`/`ensureAncestors`。
- `SceneRuntime` active-line 编译/采样；`TimelineActivity` 增量；`hitTimeline` 时间窗口。
- 行树/概览虚拟化；未加载行占位与加载状态。
- line patch 历史；paged 模式保存/导出。
- 协作/扩展能力降级与提示。
- 特性开关 + 自动阈值；允许用户强制 eager/paged。

**退出标准：**

- 512 MB 级/数百万 note 级谱面在目标内存内打开；当前行编辑响应可接受。
- 播放只采样激活行；行树不因行数卡死。
- 保存只重写 dirty 行 + 流式复制干净行。
- 所有 eager 路径行为不变。

### Phase 3：可选优化（4–8 周）

- 列式 IR（typed arrays）用于 note/event 存储和渲染。
- 协作欢迎快照流式化（协议版本升级）。
- 扩展按行/按块钩子。
- 浏览器 PEZ 流式解压、流式 ZIP 导出。

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 流式 JSON 扫描器与 `JSON.parse` 语义不一致 | 打开失败/数据差异 | 小谱面回退 `JSON.parse`；用 corpus 做逐字节/逐值对照；限制嵌套深度和数字格式 |
| 单行巨大导致单帧过大 | 主线程卡顿/内存峰值 | 字节上限分块；note/event 子分片；背压 |
| 分页模式静默丢数据 | 保存错误/用户数据损坏 | 占位行永不序列化；编辑前强制 `ensureLine`；核心热路径不依赖占位；保存前校验 dirty 行完整性 |
| 父链未加载导致渲染错误 | 画面错位 | `ensureAncestors`；索引保存 `father`；激活行加载失败时跳过并提示 |
| 历史/撤销在 paged 模式不一致 | 撤销错误 | line patch 历史 + 现有 selective undo 测试；eager 路径保持原实现 |
| 扩展钩子假设完整 chart | 扩展失效 | 注册钩子时强制 eager；文档说明限制 |
| 库 schema 迁移失败 | 无法打开库 | 只做加法；索引可重建；迁移前备份；旧行惰性处理 |
| 取消/并发打开泄漏 worker/流 | 内存/端口泄漏 | `AbortSignal` 贯穿；`openRevision`；worker terminate；测试连续打开 A/B |
| 保存与磁盘变化竞争 | 覆盖外部修改 | 现有 disk snapshot/冲突检测保留；paged 模式源失效时提示重新加载 |
| 索引与源不一致 | 读错行 | 索引带版本/大小/哈希；不匹配重建；读取时校验行边界 |
| 协作超大谱面 OOM | 房间崩溃 | 房间大小上限；明确提示；Phase 3 再流式化 |

---

## 10. 验收与测试

### 10.1 正确性

- `parseChartStream(source).materializeAll()` 与 `parseChart(text)` 语义等价（同一 fixture 的 `chartFingerprint` 一致）。
- 流式保存输出用现有 `parseChart` 解析后与源 chart 语义等价；PEZ 能被现有 native 读取。
- 版本转换、只读修复、`stripReduxExportVersion`、`stripLegacyTrajectory` 在流式路径与整图路径结果一致。
- header 后置、BOM、CRLF、重复 ID、缺失 ID、非法行、截断帧、超大单行都要有测试。
- eager/paged 两种模式对同一谱面的编辑结果一致（除明确限制的功能）。

### 10.2 性能

建议门槛（以真实 WebView2 校准）：

- 100 MB 谱面：首批行到首帧 < 1 s；主线程单任务 < 50 ms。
- 400k note 谱面：打开后主线程安装/编译总耗时 < 1 s（Phase 1）；paged 模式下 < 200 ms（Phase 2）。
- 峰值内存：Phase 1 < 当前整图峰值的 70%；Phase 2 与谱面大小基本解耦（工作集 + 索引）。
- 保存 100 MB 谱面：不产生整图字符串；主线程无 > 50 ms 任务。
- 播放：paged 模式只采样激活行，帧时间不随总行数线性增长。

### 10.3 回归

- `npm run check` / `npm run verify`。
- `src/test/e2e/` P0：API/Extension 契约、文档打开/创建/保存、设置页、会话恢复、工作区表面、判定线文件夹。
- `npm run build -- --debug` + `npm run smoke`：真实窗口打开/保存/播放。
- `npm run check:native`：Rust 改动。
- Go `npm run test:server`。

---

## 11. 待确认问题

1. **目标上限**：需要支持到多大？512 MB / 200 万 note / 10 万行，还是只要求 100–200 MB？这决定 Phase 2 是否必须。
2. **随机访问**：是否要求直接跳转到任意行/任意时间？还是顺序渐进加载可接受？前者需要持久化行索引。
3. **协作**：超大谱面是否必须支持房间？如果可以先禁用/限流，Phase 2 会简单很多。
4. **扩展/SDK**：是否接受“注册了 chart 钩子就回退 eager”的规则？还是必须让扩展也能分块读取？
5. **数据库迁移**：是否接受 SQLite 增量 schema（新增索引/分块表）？如果不接受，Phase 2 需要每次打开重建索引。
6. **平台范围**：桌面优先，还是浏览器开发模式也必须支持 PEZ/大文件流式？浏览器端需要额外的流式 ZIP/文件读取实现。

---

## 附录 A：基准方法

- 运行环境：Node.js 25.2.1，Windows；生成 RPE 结构（`createChart` + `createLine` + `createNote`），不含真实媒体和 UI。
- 规模：500 行 × 200 note；2,000 行 × 200 note；10 行 × 40,000 note。
- 计时：`performance.now()`；内存：`process.memoryUsage()`（`--expose-gc` 后读取）。
- 代码路径：`parseChart`、`assertChart`、`normalizeChartObjectIds`、`chartFingerprint`、`serializeChart`、`new EditorSession`、`TimelineActivity.compile`、`SceneRuntime.compile`、`hitTimeline`。
- 该探针只用于数量级判断；实现时应把同样的测量放进仓库内的 benchmark/性能面板，并在 WebView2 上复测。

## 附录 B：帧协议示例

```text
[length: u32le][kind: u8][payload]

01  HEADER   {"META":{...},"BPMList":[...],"judgeLineGroup":[...],"lineCount":2000}
02  INDEX    {"version":1,"lines":[{"index":0,"byteOffset":123,"byteLength":456,...}]}
03  LINE     [lineIndex: u32le][{"Name":"Line 0","notes":[...],...}]
04  LINES    [start: u32le][count: u32le][[{...},{...}]]
05  EFFECTS  [{"line":0,...},...]
06  BLOCK    [{"moveXEvents":[...]},...]
07  END      {"digest":"...","bytes":123456}
08  ERROR    {"code":"chart_too_large","message":"...","path":"$"}
```

## 附录 C：索引字段建议

```ts
interface ChartLineSummary {
  index: number; // 逻辑行号
  byteOffset?: number; // 源文件/分块偏移
  byteLength?: number; // 源分块长度
  noteCount: number; // 计分/非计分 note 总数
  eventCount: number; // 所有 event track 的事件数
  startSeconds: number; // 行内最早时间
  endSeconds: number; // 行内最晚时间
  digest: string; // 行内容指纹（可排除 editor-only id，需与整图指纹约定一致）
  flags: number; // 缺省字段/非法/shader/noise/已规范化
  group: number; // judgeLineGroup 索引
  father: number; // 父行索引，-1 表示根
  id?: string; // 行 id；note/event id 可另存紧凑表
}
```

## 附录 D：建议的新增模块

```text
src/core/global/document/chartSource.ts        ChartSource / ChartStream / frame codec
src/core/global/chart/streaming/chartDocument.ts ChartDocument / line store / LRU
src/core/global/chart/streaming/chartIndex.ts  索引类型、构建、持久化
src/core/global/chart/streaming/jsonScanner.ts 浏览器 worker 的增量 JSON 扫描器
src/core/global/chart/streaming/serializeChunks.ts 逐行序列化/导出投影
src-tauri/src/documents/chart_stream.rs        Rust 增量解析与随机行读取
src/backend/internal/store/chart_stream.go     Go 流式 commit / metadata / index
```

---

## 一句话建议

**先做 Phase 1：把打开/保存改成统一的流式管线，去掉整文件字符串和主线程全量校验/指纹；这会立刻解决大部分“大谱面卡死”和库保存 64 MiB 上限的问题。** 然后再用 Phase 2 的行索引与时间窗口渲染，真正把“极大谱面”的内存和渲染成本变成与当前工作集相关，而不是与整张谱面相关。
