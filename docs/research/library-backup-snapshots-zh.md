# 谱面库自动备份：跨宿主快照存储与迁移设计

本文把原先只面向浏览器的自动备份方案扩展为桌面、静态网页和远程服务共用的设计，并补齐迁移路径。它回答四个问题：

- 自动备份能不能做成 Git 风格；
- 轮换能不能 squash 之前的操作树；
- 备份期间崩溃如何恢复；
- gzip 能解决多少空间问题。

结论是：可以做，而且不应只做浏览器版。三端共享同一套逻辑快照格式，但各自使用宿主原生的对象存储和锁。迁移分为三层：SQLite schema、备份存储格式、旧备份文件导入，三者独立版本化。

## 1. 结论

| 决策            | 选择                                                                 |
| --------------- | -------------------------------------------------------------------- |
| 备份模型        | 内容寻址对象 + 提交对象 + 只追加的代际 ref，不引入完整 Git           |
| 去重            | 复用现有 SHA-256：图表文本、资源 BLOB、偏好、项目清单都按内容寻址    |
| 快照粒度        | 整库逻辑快照；`revisions` 是快照内的一部分，不再单独承担备份职责     |
| 桌面 / 远程实现 | Go 服务内的 `librarybackup` 包，挨着 SQLite 运行                     |
| 浏览器实现      | 浏览器 SQLite Worker 内的 TypeScript 实现，对象放在独立 OPFS 目录    |
| 一致性          | 备份只读 live DB；写入被短暂串行化，快照完成后继续                   |
| 崩溃安全        | 先写对象，再写提交，最后写 ref；旧 ref 永不原地覆盖                  |
| 恢复            | 正常情况用事务替换库表；live DB 已损坏时用带 intent 日志的文件替换   |
| 轮换            | 保留最近 N 个提交，更早的前缀被截掉；最老的保留提交就是新的 base     |
| 完全 squash     | 写一个 `parent = null` 的当前状态根提交，删除其他提交                |
| gzip            | 只压缩文本对象；媒体原样存储；对象头记录编码，保证跨宿主去重         |
| 跨宿主传输      | 导出标准 `.sqlite`，导入时迁移 schema；快照存储本身不直接跨设备同步  |
| 旧桌面 ZIP      | 保留为“完整应用数据备份”；其数据库部分可导入新的历史存储             |
| 兼容策略        | schema 只做加法；旧应用可以继续打开新库；新应用拒绝打开更新的 schema |

## 2. 范围和术语

### 2.1 两个“提交”不是一回事

- **项目提交（project commit）**：一次谱面保存，现有 `projects.revision` 和 `POST /commit` 做的事。
- **库快照（library snapshot）**：一次整库备份，本文的 commit 对象。UI 和 API 用 “snapshot”，避免和项目提交混淆。

### 2.2 进入快照的数据

| 数据 | 位置 | 是否进入快照 | 说明 |
| --- | --- | --- | --- |
| 项目元数据、图表 JSON、`viewState`、`assetFolders` | `projects` | 是 | 谱面库的核心内容 |
| 资源 BLOB 和 `project_assets` | `assets` / `project_assets` | 是 | 按内容寻址，跨项目、跨快照去重 |
| 修订和 `revision_assets` | `revisions` / `revision_assets` | 是 | 默认保留单谱面历史 |
| 可移植偏好 | `preferences.data` 的允许段 | 是 | 快捷键、编辑器设置、语言等 |
| `library_meta.database_id` | `library_meta` | 是 | 判断快照来自哪个库 |
| 恢复草稿 | `recovery_*` | 否 | 宿主本地的崩溃恢复数据 |
| 路径映射 | `preferences.library` | 否 | 绝对路径只对当前机器有意义 |
| 服务地址 / 协作身份 | `preferences.server` / `collaboration` | 否 | 网络和账号边界 |
| 上次会话、对话框目录、窗口页面 | `session` / `dialogs` / `settingsWindow` | 否 | 宿主会话状态 |
| 面板几何 | `preferences.layout` | 否 | 桌面和网页的布局不同 |
| 剪贴板历史 | `preferences.clipboard` | 否 | 隐私内容，且不是谱面数据 |
| 主题、皮肤、扩展 | `themes/`、`skins/`、`extensions/` | 否 | 由现有“完整应用备份”负责 |
| 自定义背景文件 | `backgrounds/` | 否 | 设置里只保留引用；文件不进库快照 |
| 协作房间、房间资源 | `collaboration/` | 否 | 临时房间和加密内容 |
| 日志、缓存、WebView2 数据 | 数据目录 | 否 | 可重建的宿主数据 |
| 运行时端口、更新状态 | 宿主配置 | 否 | 机器相关 |

### 2.3 不在本文范围

- 文件型谱面（未进入库的 JSON/PEZ）的自动版本。
- 扩展、皮肤、主题的跨设备同步。
- 多设备实时同步、冲突合并、分支。
- 云端多租户计费和权限系统。

## 3. 逻辑格式

### 3.1 目录布局

桌面和远程：

```text
<data-dir>/
  redux.db                         # live SQLite，唯一数据源
  library-history/                 # 新备份存储，和 live DB 分开
    store.json                     # 格式版本和状态缓存
    policy.json                    # 自动备份和保留策略
    pins.json                      # 手动/迁移快照的保留标记
    objects/<sha256>               # 内容对象：图表、资源、项目清单、偏好
    commits/<sha256>               # 提交对象
    refs/000000000042.json         # 只追加的代际 ref
    tmp/                           # 写入中的临时文件
  backups/                         # 旧 ZIP 和 pre-update 备份，保持现状
    pre-update-*.zip
    pre-migration/
```

浏览器：

```text
OPFS 根/
  rpe-redux-pool/redux.db          # 现有 opfs-sahpool 数据库
  library-history/                 # 独立目录，不放进 SQLite
    objects/ commits/ refs/ tmp/
```

远程：

```text
<db-dir>/redux.db
<backup-dir>/library-history/      # 必须是持久卷；默认在 db-dir 旁
```

`library-history` 永远不放进 live SQLite。数据库损坏、迁移失败或误删表时，备份仍然可读。

### 3.2 对象封装

所有内容对象使用同一个 16 字节头，后接负载：

```text
0..3    "RPEB"          魔数
4       1               封装版本
5       0 raw / 1 gzip  负载编码
6       对象类型        0 blob, 1 chart, 2 commit, 3 project, 4 revisions,
                        5 preferences, 6 tree
7       0               保留
8..15   原始长度        未压缩负载的字节数，uint64 大端
```

对象 ID 是**未压缩负载**的 SHA-256，小写十六进制。文件名为 `<id>`，不带编码后缀。这样同一个资源无论先被 Go 以 gzip 写入、还是先被浏览器以 raw 写入，都只有一个对象；读取端按头部解码。旧原型使用 `<hash>.<gz|raw>`，会在压缩能力不同的宿主之间产生重复对象，正式实现不采用。

对象类型字节只用于诊断，不参与 ID；读取端以引用中的类型为准，不因类型字节不同而拒绝。写入端如果发现对象已存在，必须读取实际头部，并把实际的 `encoding`、`size`、`storedSize` 写进引用，而不是写自己原本计划的压缩方式。

读取时必须校验：

1. 头部魔数和版本；
2. 编码合法；
3. 头部原始长度、解码后长度和引用里的 `size` 一致；
4. 解码后 SHA-256 等于文件名。

任何一项失败都视为对象损坏，不返回半截数据。

### 3.3 提交对象

提交文件是一个 JSON 负载，文件名是这段 JSON 字节的 SHA-256。提交不包含自己的 ID，避免自引用。

```json
{
  "format": "rpe-redux-library-commit",
  "version": 1,
  "parent": "previous-commit-id",
  "reason": "auto",
  "createdAt": "2026-11-10T12:00:00.000Z",
  "schemaVersion": 2,
  "appVersion": "1.0.7",
  "sourceHost": "desktop",
  "databaseId": "9e5b0d5e-...",
  "preferencePolicy": "portable-v1",
  "tree": { "hash": "<sha256>", "encoding": "gzip", "size": 1234, "storedSize": 456 },
  "preferences": { "hash": "<sha256>", "encoding": "gzip", "size": 789, "storedSize": 300 },
  "stats": {
    "projects": 1,
    "assets": 2,
    "revisions": 1,
    "objects": 6,
    "rawBytes": 1048576
  }
}
```

`reason` 取值：`auto`、`manual`、`bootstrap`、`import`、`pre-migration`、`pre-restore`、`pre-update`、`restore`、`compact`。读取端遇到未知 reason 时按 `other` 显示，不拒绝。

提交的 ID 是内容哈希，因此同一个提交重复写入是幂等的；`createdAt` 不同则 ID 不同，这是预期行为。

### 3.4 根树、项目清单、修订集

提交不直接内联所有项目，而是引用根树。这样提交保持很小，未变化的项目清单可以跨快照复用。

根树：

```json
{
  "format": "rpe-redux-library-tree",
  "version": 1,
  "projects": [
    { "id": "project-id", "manifest": { "hash": "<sha256>", "encoding": "gzip", "size": 900 } }
  ]
}
```

项目清单：

```json
{
  "format": "rpe-redux-library-project",
  "version": 1,
  "id": "project-id",
  "name": "Chart",
  "group": "",
  "archived": false,
  "charter": "",
  "composer": "",
  "level": "",
  "background": "cover.png",
  "song": "music.mp3",
  "noteCount": 0,
  "revision": 5,
  "viewState": {},
  "assetFolders": [],
  "createdAt": "...",
  "updatedAt": "...",
  "chart": { "hash": "<sha256>", "encoding": "gzip", "size": 1234 },
  "assets": [{ "name": "cover.png", "hash": "<sha256>", "encoding": "raw", "size": 4567 }],
  "revisions": { "hash": "<sha256>", "encoding": "gzip", "size": 200 }
}
```

修订集：

```json
{
  "format": "rpe-redux-library-revisions",
  "version": 1,
  "projectId": "project-id",
  "revisions": [
    {
      "id": "revision-id",
      "label": "v1",
      "createdAt": "...",
      "size": 1234,
      "chart": { "hash": "<sha256>", "encoding": "gzip", "size": 1234 },
      "assets": [{ "name": "cover.png", "hash": "<sha256>" }]
    }
  ]
}
```

项目按 `id` 排序，修订按 `createdAt` 再按 `id` 排序。资产按 `name` 排序。排序是为了让相同内容产生相同对象，而不是为了可读性。

### 3.5 偏好对象和可移植策略

偏好对象只包含允许跨宿主的段：

```json
{
  "format": "rpe-redux-library-preferences",
  "version": 1,
  "policy": "portable-v1",
  "sections": {
    "shortcuts": {},
    "settings": {},
    "values": {},
    "appearance": "default",
    "language": "zh-CN"
  }
}
```

`portable-v1` 规则：

| 段 | 处理 |
| --- | --- |
| `shortcuts`、`trajectory`、`multiEdit`、`language`、`appearance`、`icons`、`noteSkin`、`lineSelection`、`sampler`、`welcome`、`onboarding`、`rpe` | 整体携带 |
| `settings` | 逐键合并；跳过宿主专属、需要确认、引用应用数据文件的键 |
| `values` | 逐键合并；跳过 `extension.` / `mod.` 前缀的扩展私有键 |
| `library`、`server`、`collaboration`、`session`、`dialogs`、`settingsWindow`、`layout` | 不携带 |
| `clipboard` | 不携带 |
| 未知段 | 默认不携带 |

安全边界很重要：`code-execution-enabled`、扩展免责声明等同意类开关**绝不能**跟着快照跨设备恢复。`portable-v1` 的排除列表至少包含：

- 所有声明了 `hosts` 的设置（窗口、端口、更新、自动保存、桌面文件入口等）；
- 所有声明了 `confirm` 的设置（代码执行等信任边界）；
- 所有 `storage: "application-data"` 的设置（自定义背景文件引用）；
- 扩展命名空间下的设置和 `values` 键；
- 自动快照开关和间隔本身，避免恢复旧快照时改掉目标机器的备份策略。

这份策略是一个版本化的共享数据文件，Go 和 TypeScript 各读一份，测试保证两份一致。后续新增设置时，测试会提醒更新策略，而不是默默把新字段带进快照。

恢复时：

1. 读取当前 live DB 的完整偏好；
2. 对快照里的可移植段，`settings` 和 `values` 逐键合并，其余整体替换；
3. 保留当前宿主的 `library`、`server`、`collaboration`、`session`、`dialogs`、`settingsWindow`、`layout`、`clipboard`；
4. 快照里缺失的段不删除当前值；
5. 同意类键即使出现在旧快照里也丢弃。

这样恢复不会把 A 机器的路径、服务地址、协作房间或代码执行同意带到 B 机器。

### 3.6 ref、store、pins、policy

ref：

```json
{
  "format": "rpe-redux-library-ref",
  "version": 1,
  "generation": 42,
  "commitId": "<sha256>",
  "checksum": "<sha256 of format/version/generation/commitId/createdAt>",
  "createdAt": "..."
}
```

checksum 的输入是固定字符串，避免跨语言序列化差异：

```text
SHA-256("rpe-redux-library-ref\n1\n" + generation + "\n" + commitId + "\n" + createdAt)
```

`refs/000000000042.json` 使用 12 位补零。`generation` 单调递增，只追加，不原地改写。

`store.json` 是状态缓存，不是权威：

```json
{
  "format": "rpe-redux-library-history",
  "version": 1,
  "createdAt": "...",
  "generation": 42,
  "head": "<commitId>",
  "lastBackupAt": "...",
  "lastError": null,
  "dirty": false
}
```

HEAD 永远从 refs 重新计算。`store.json` 损坏只影响状态显示，不影响历史。

`pins.json` 记录需要保留的提交 ID。`policy.json` 记录自动备份开关、去抖时间、保留数量和空间上限；用户设置优先，`policy.json` 作为没有设置记录时的回退。两者都用临时文件 + 原子替换写入；丢失时回退默认值，不破坏提交和 ref。

### 3.7 大小限制

读取端必须在上限内工作，防止损坏或恶意备份耗尽内存：

| 项                                   | 上限                              |
| ------------------------------------ | --------------------------------- |
| 单个对象解码后                       | 8 GiB（和现有数据库导入上限一致） |
| 提交 / 根树 / 项目清单 / 修订集 JSON | 64 MiB                            |
| 偏好对象                             | 8 MiB                             |
| 项目数                               | 100,000                           |
| 单项目资产数                         | 100,000                           |
| 修订数                               | 1,000,000                         |
| ref 数                               | 100,000                           |
| 提交父链深度                         | 100,000                           |

超过上限返回稳定错误码，不尝试“尽力读取”。

## 4. 三种宿主的实现位置

| 宿主 | live DB | 备份存储 | 写入者 | 锁 |
| --- | --- | --- | --- | --- |
| 桌面 | Go sidecar 的 `user-data/redux.db`（WAL） | `user-data/library-history/` | Go 服务 | 进程内互斥 + 文件锁；Tauri 只负责原生路径和对话框 |
| 静态网页 | 浏览器 Worker 的 OPFS `redux.db` | OPFS `library-history/` | 选主标签页的 Worker | Web Locks + BroadcastChannel |
| 远程 | Go 服务的 SQLite | `--backup-dir` 持久卷 | Go 服务 | 单实例假设；多实例需要分布式租约 |

### 4.1 桌面

- Go 服务本来就拥有数据库连接，快照和恢复放在服务里最自然。
- 现有 `src-tauri/src/storage/backup.rs` 继续负责完整应用 ZIP、主题/皮肤/扩展和 pre-update ZIP；它不实现新的对象存储。
- Tauri 命令只负责：选择导出路径、选择导入文件、打开数据目录、把用户选择的文件复制到服务可读的临时目录。
- 服务对任意路径的读写仍然受限：导入先复制到 `user-data/imports/<uuid>.sqlite`，导出先写到 `user-data/exports/<uuid>.sqlite`，再由 Tauri 复制到用户选择的位置。
- 多个前端窗口共享一个 sidecar；快照服务只有一个写入者。

### 4.2 浏览器

- `db.worker.ts` 已经拥有 SQLite 连接；备份存储放在同一个 Worker，避免第二个连接和跨线程 BLOB 复制。
- 对象目录使用 `navigator.storage.getDirectory()` 下的 `library-history/`，不要放进 `opfs-sahpool` 的数据库池目录。
- 只有 leader 标签页执行快照、恢复、压缩和 GC。follower 通过 BroadcastChannel 把请求转给 leader；状态查询也走 leader。
- `CompressionStream` / `DecompressionStream` 不可用时写 raw；对象头已经记录编码，其他宿主仍可读。
- `navigator.storage.persist()` 在首次自动备份前请求；拒绝时仍然工作，但状态页明确提示“清理站点数据会删除备份”。
- 同一 origin 的其他页面可以访问 OPFS 和 BroadcastChannel。需要隔离时使用独立自定义域名，不能只靠路径隔离。

### 4.3 远程

- 和桌面共用 Go 实现，只是数据目录和监听地址不同。
- `--backup-dir` 默认是数据库同级的 `library-history/`；容器部署必须把它挂到持久卷。
- 对象存储抽象为 `ObjectStore`：文件系统是默认实现；S3 兼容存储作为后续实现，利用 PUT 的原子性和 `If-None-Match` 写入不可变对象。
- v1 假设一个数据库只有一个写入服务。多实例部署必须使用数据库租约或对象存储条件写；否则第二个实例可能在同一 generation 上写 ref。未实现前，第二个实例应以只读模式启动。

## 5. 写入协议和崩溃恢复

### 5.1 一次快照的顺序

1. 取得备份写入锁（不是 live DB 写锁）。
2. 读取 live DB 的一致性视图，计算缺失对象列表。
3. 对每个缺失对象：写 `tmp/<uuid>`，flush，校验 hash，再发布为 `objects/<hash>` 或 `commits/<hash>`。
4. 写根树、项目清单、修订集、偏好对象；它们只能引用已经发布并校验的对象。
5. 写提交对象；提交只能引用已经发布的根树和偏好。
6. 计算下一个 generation，写 `refs/<generation>.json`。这是唯一让新快照生效的步骤。
7. 更新 `store.json` 缓存；清理 tmp。
8. 释放写入锁。

旧 ref 永远不被原地覆盖。新 ref 是新文件；失败时旧文件仍然有效。

实现还会在库写入成功后写一个 `library-history/dirty.json` 标记，快照 ref 成功后再删除。进程在这个窗口内崩溃时，下一次启动看到标记就立即补一轮快照，而不是等到下一次编辑。标记丢失最多导致一次“晚一拍”的备份，不会破坏已有 ref。

### 5.2 崩溃点

| 崩溃位置 | 结果 | 恢复 |
| --- | --- | --- |
| 对象写一半 | 孤儿 tmp 或损坏的 hash 文件 | 启动时删 tmp；读到损坏对象时忽略；下次从 live DB 重写 |
| 对象写完、提交未写 | 孤儿对象 | 下次 GC 删除 |
| 提交写完、ref 未写 | 孤儿提交 | 下次 GC 删除；HEAD 仍是旧提交 |
| ref 写一半 | 无效 ref | JSON/checksum 校验失败，跳过 |
| ref 写完但未落盘 | 可能丢失最新 ref | 回退到上一个有效 ref；不保证最新一次备份存在，但不破坏旧备份 |
| 根树/项目清单写一半 | 孤儿对象 | 同对象损坏处理 |
| 压缩/序列化异常 | 当前快照失败 | 旧 ref 保持不变；记录错误并退避 |

### 5.3 启动扫描和损坏 HEAD

启动时：

1. 列出 `refs/`，按 generation 从大到小排序。
2. 对每个 ref：解析 JSON、校验 checksum、文件名和 generation 一致。
3. 读取 ref 指向的提交，重新计算提交字节的 SHA-256，必须等于 commitId。
4. 检查提交格式和版本；读取根树和偏好对象，确认存在。
5. 第一个 ref + 提交都有效的作为 **head**。
6. 从 head 开始继续向更老的 ref 扫描，对提交做对象存在性检查；第一个全部存在的提交是 **healthy head**。如果 head 自己完整，两者相同。

区分 `head` 和 `healthy head`：

- `head` 是最新的可解析提交，用来显示“最新快照”和损坏状态。
- `healthy head` 是最新的完整提交，自动备份以它作为 parent 和去重来源；如果不存在，下一次快照写一个 `parent: null` 的根提交。
- 如果 head 存在但对象缺失，状态页显示“最新快照损坏”，不静默回退到旧快照，也不删除损坏 ref。
- 恢复默认选 healthy head；用户可以选择损坏提交并执行“尽力恢复”，但会明确提示可能失败。
- 完整 hash 校验不在每次启动时做（大库会很慢）；`verify` 命令和恢复流程做完整校验。启动只做存在性和提交 hash 校验。

### 5.4 GC 的崩溃安全

GC 只在备份写入锁内运行：

1. 重新计算所有有效 ref、保留提交、pins 引用的对象集合。
2. 写 `gc.json` 意图文件，列出候选对象和候选提交。
3. 删除不可达对象和提交；旧 ref 最后删除。
4. 删除 `gc.json`。

如果 GC 中途崩溃，下一次 GC 会从当前 refs 重新计算。已删除的对象在删除时不可达；不会因为 GC 崩溃而让一个仍然有效的提交失去对象。唯一需要避免的是“快照正在写对象、GC 同时认为它不可达”：写入锁保证两者不并发。浏览器由 leader Worker 串行化，桌面由 Go 互斥锁串行化，远程由单实例假设保证。

### 5.5 锁

- 桌面：进程内 `sync.Mutex` + `library-history/writer.lock` 文件锁（记录 PID 和时间，超时视为陈旧锁）。文件锁防止同一数据目录被两个 sidecar 打开。
- 浏览器：`navigator.locks.request("rpe-redux-library-history-writer", { mode: "exclusive" })`；只有 leader 持有。
- 远程：单实例；多实例需要租约，未实现前只读。
- 所有锁都必须有超时和可诊断错误，不能无限等待。

## 6. 快照一致性

### 6.1 不读全库

快照利用已有的 hash 做增量：

- `projects.chart_hash` 已存在；为空或非法时，在准备阶段重算。
- `assets.hash` 已存在；对象存在时不再读取 BLOB。
- `revisions` 增加 `chart_hash` 列；为空时惰性回填。
- 偏好对象很小，每次序列化并查重即可。
- 项目清单和修订集只包含元数据和 hash，不包含图表正文。

因此“只改了一个谱面”的快照通常只需要：一个新图表对象、一个新项目清单、一个新根树、一个提交、一个 ref。未变化的图片和音乐不会被读取。

### 6.2 一致性视图

快照按以下方式取得一致视图：

1. 准备阶段：用写事务回填缺失的 `chart_hash`，提交。
2. 快照阶段：`BEGIN` 读事务，读取项目、资产清单、修订和偏好。
3. 对缺失对象，在事务内读取 BLOB / 图表文本并写入对象存储。
4. 提交事务，释放连接。

桌面和远程优先为快照开一个**独立的只读 SQLite 连接**。WAL 允许一个读事务和一个写事务并发，因此普通保存不需要等待快照；读事务看到的是一个确定的旧视图。读事务会阻止 WAL checkpoint 截断，快照结束后必须立即提交并关闭。live DB 的资源 GC 即使同时删除孤立 BLOB，读事务仍然看到旧页面，不会读到半截数据。

浏览器当前只有一个 `opfs-sahpool` 连接，Worker 的调用队列会短暂暂停写入；如果目标浏览器允许第二个只读句柄，可以采用和桌面相同的策略，但需要实测后再启用。

无论哪种方式，快照都代表一个确定的时间点，不会出现“项目元数据是新的、资源清单是旧的”。代价主要是 WAL 增长和少量读 I/O，而不是 UI 写请求被阻塞。

代价是新增大资源时写入可能等待。v1 接受这个代价，因为：

- 快照在保存后去抖执行，用户通常已经停止编辑；
- 增量快照只读新增对象；
- 备份正确性优先于极限并发。

后续可以改成“先把缺失对象复制到临时库，再释放 live DB”，但这会增加一次完整 BLOB 复制，浏览器配额压力更大。设计上把它作为可选优化，不作为 v1 前提。

### 6.3 快照算法

```text
prepare:
  for each project/revision with empty chart_hash:
    read chart text, compute sha256, update row
snapshot:
  begin read transaction
  read preferences row
  read project rows
  for each project:
    if chart_hash object missing: read chart, write chart object
    for each asset manifest entry:
      if hash object missing: read BLOB, write asset object
    build revision set:
      for each revision:
        if chart_hash object missing: read chart, write chart object
        collect revision assets
      write revision-set object
    build project manifest object
  build root tree object
  build preferences object from portable policy
  build commit object
  commit read transaction
  write ref (new generation)
```

对象写入是幂等的：已存在且校验通过就跳过；存在但损坏则重写。提交和 ref 最后写。

## 7. gzip、去重和空间

### 7.1 什么时候压缩

适合 gzip：

- 图表 JSON；
- 项目清单、修订集、根树、提交、偏好 JSON；
- 未压缩的文本资源。

不适合：

- PNG、JPEG、WebP、GIF、AVIF；
- MP3、OGG、M4A、AAC、FLAC；
- 已经压缩的 ZIP、PEZ、WebP。

实现策略：

- 先看对象类型和 magic；已知压缩格式直接 raw。
- 其余先 gzip，比较 `compressed + header` 和 `raw + header`；只有更小才用 gzip。
- 浏览器用 `CompressionStream("gzip")`；不可用或抛错时 raw。
- Go 用 `compress/gzip`，默认级别；大文本可以降到 `BestSpeed`，但必须在提交里记录编码，不能靠猜测。
- 解压有总大小上限和压缩比上限，防止 gzip bomb。

### 7.2 去重才是主要收益

- 一张 10 MB 音乐在多个快照里只存一次；gzip 对媒体没有意义。
- 同一张图片被多个项目引用时只存一次。
- 未修改的图表文本只存一次；每个快照只新增提交、根树和变更的项目清单。
- 项目清单和修订集按内容寻址，重命名一个项目只重写它的清单，不重写其他项目。

原型里 984,933 字节的合成图表 JSON gzip 后是 7,645 字节，约 0.8%。这是文本的上限收益，不代表媒体也会缩小。

### 7.3 空间估算

快照前估算新增字节：

```text
newBytes = sum(raw size of missing objects) + commit/tree/manifest overhead
```

- 浏览器：用 `navigator.storage.estimate()` 得到 quota 和 usage；要求 `remaining > newBytes + reserve`，reserve 默认 50 MB 或 quota 的 10%，取较大值。
- 桌面 / 远程：检查备份目录所在卷的可用空间；reserve 默认 200 MB 或卷容量的 5%。
- 空间不足时自动备份跳过并记录 `quota_low`；手动备份仍然尝试，并把底层错误翻译成可读提示。
- 快照失败留下的孤儿对象不计入任何 ref，下一次成功快照后由 GC 回收。

## 8. squash、轮换和保留

### 8.1 三种操作

| 操作 | 行为 | 用途 |
| --- | --- | --- |
| `prune(keepRecent)` | 保留最新 N 个提交，删除更早的提交；清理指向已删除提交的 ref；最老的保留提交成为 base | 日常轮换 |
| `squashAll()` | 从当前 live DB 写一个 `parent = null` 的根提交，删除其他提交和 ref；默认拒绝删除 pinned 提交 | 彻底压缩历史 |
| `compact()` | `prune` + GC；空间仍超限时提示用户手动 `squashAll`，不自动清空历史 | 自动策略 |

`prune` 不重写保留提交的父链。最老保留提交的 `parent` 可能指向已删除的提交；读取端必须把“父提交缺失”解释为“历史在这里被截断”，而不是损坏。这比 Git 的 rebase 简单得多，因为每个提交都有完整的树，恢复不依赖父链。

这正是“把之前的操作树 squash 成一个基线快照”：base 就是最老保留提交的状态，之后是最近 N 次操作。完整 squash 则只留下一个当前状态的根提交。`squashAll` 默认保留 pinned 提交；需要用户先 unpin，或通过 `force: true` 二次确认后删除。UI 在 `squashAll` 前建议先导出一份 `.sqlite`，并把“历史将只剩一个快照”写进确认文案。

### 8.2 默认保留策略

| 项              | 默认                                                              |
| --------------- | ----------------------------------------------------------------- |
| 自动去抖        | 20 秒                                                             |
| `keepCommits`   | 50                                                                |
| `keepDays`      | 30                                                                |
| `maxCommits`    | 100                                                               |
| `maxBytes`      | 桌面/远程 5 GiB 或卷容量 20%；浏览器 1 GiB 或 quota 20%，取较小值 |
| 自动 prune 触发 | 提交数 > `maxCommits`，或备份对象超过 `maxBytes`                  |
| 自动 squashAll  | 不自动；只在用户选择“压缩历史”或 `keepCommits = 0` 时             |
| 手动快照        | 默认 pin                                                          |
| 自动快照        | 不 pin                                                            |
| 迁移前快照      | 自动 pin，保留最近 3 个                                           |
| 更新前快照      | 自动 pin，保留最近 3 个                                           |

保留集合按以下规则计算：

```text
keep = 最新 keepCommits 个提交
     ∪ 比 keepDays 新的提交
     ∪ 所有 pinned 提交
如果 keep 超过 maxCommits，只保留其中最新的 maxCommits 个，但 pinned 不受此上限影响
```

`pins.json` 里的提交即使不在最近 N 个里也会保留。由于提交是完整树，pin 一个老提交不需要保留它的祖先；GC 只保留该提交引用的对象。`pin` 太多时状态页提示用户清理，不自动删除。

### 8.3 refs 清理

- 最多保留最新 10 个仍指向保留提交的有效 ref，作为最新 ref 损坏时的回退。
- 删除指向已删除提交的旧 ref。
- 无效 ref 保留用于诊断，但最多 1,000 个；超过后删除最老的无效 ref。
- 永远不删除最新 ref，即使它指向损坏提交；它需要显示在状态页。

## 9. 恢复

### 9.1 正常恢复：事务替换库表

1. 选择提交，完整校验 ref、提交、根树、项目清单、修订集、偏好和所有对象 hash。
2. 在一个临时数据库中构建目标库（当前 schema），插入项目、资产、清单、修订、偏好和 `library_meta`。
3. 对临时库执行 `PRAGMA integrity_check` 和行数校验。
4. 对 live DB 写一个 `pre-restore` 快照并 pin。它记录恢复前的状态。
5. 在 live DB 上 `ATTACH` 临时库，`BEGIN IMMEDIATE`，按外键顺序删除并插入库表：
   - 删除 `revision_assets`、`revisions`、`project_assets`、`projects`、`assets`、`library_meta`；
   - 插入 `assets`、`projects`、`project_assets`、`revisions`、`revision_assets`；
   - 偏好单独按第 3.5 节合并；
   - `library_meta` 写入快照的 `database_id`、`created_at` 和导入时间。
6. `COMMIT`；`DETACH`；删除临时库。
7. 写一个 `reason: "restore"` 的提交，`parent` 是 pre-restore 提交，树是恢复后的状态；更新 ref。

恢复只替换库表，**不动** `recovery_*` 表，也不动浏览器/宿主自己的 `app_packages`、`app_package_files` 等应用包表。这样崩溃恢复草稿、Web 皮肤、宿主本地插件表或其他辅助表不会被库恢复清掉。未来新增的宿主表也应遵循这个规则：库快照只拥有库表。浏览器恢复在重建临时库后会把 live 库里的应用包复制回去，效果与 Go 的事务恢复一致。

事务恢复的优点是崩溃自动回滚，不需要文件交换，也不需要重启服务。大库的复制事务可能持续数秒到数十秒；v1 接受，后续可以按大小阈值切换到文件交换。

### 9.2 损坏的 live DB：文件替换

如果 live DB 已经无法打开或 `integrity_check` 失败，事务路径不可用，改用文件替换：

1. 从快照构建完整临时库并校验。
2. 写 `restore-intent.json`，记录阶段、目标路径、pre-restore 路径、快照提交 ID。
3. 关闭所有数据库连接。
4. 把 live DB、`-wal`、`-shm` 改名为 `redux.db.pre-restore-<time>*`。
5. 把临时库改名/复制为 `redux.db`。
6. 打开、校验、设置 `application_id` / `user_version`。
7. 写入 `restore-done` 标记，删除 intent。

启动时如果看到 intent：

- 阶段是 `prepared`：live 还没换，删除临时文件，保留原库。
- 阶段是 `swapped`：打开 live 并校验；通过则完成，失败则把 pre-restore 文件换回来。
- 阶段是 `verified`：清理 intent 和 pre-restore（或保留最近一份）。

浏览器没有可靠的原子 rename，使用同样的 intent + `pool.importDb`：

1. `VACUUM INTO` 当前库到 `/pre-restore.db`。
2. 写 intent。
3. `pool.importDb('/redux.db', snapshotBytes)`。
4. 重新打开并 `PRAGMA integrity_check`。
5. 失败则 `pool.importDb('/redux.db', preRestoreBytes)`。
6. 启动时如果 intent 存在，重复校验/回滚。

### 9.3 恢复后的引用

恢复后 live DB 的 `database_id` 来自快照。如果和当前库不同，说明是跨库导入；UI 在确认对话框里明确说“这会替换当前库”，不做合并。

恢复提交的 `parent` 是 pre-restore 提交，因此历史是线性的：

```text
... -> pre-restore -> restore
```

用户可以再次恢复到 pre-restore 或更早的提交。

### 9.4 恢复失败

- 临时库构建失败：live DB 未动，删除临时文件，返回 `restore_build_failed`。
- 事务提交失败：SQLite 回滚，live DB 未动。
- 文件替换失败：intent 保留，下次启动回滚或完成；不要手工删除 pre-restore 文件。
- 快照对象缺失：拒绝恢复该提交，列出缺失对象；建议选择更早的 healthy 提交。
- 快照 schema 版本高于当前应用：拒绝，提示升级应用；不尝试降级。

## 10. 迁移

迁移是本设计的重点。三个版本轴必须独立：

| 版本轴 | 存放位置 | 当前值 | 不兼容时 |
| --- | --- | --- | --- |
| SQLite schema | `PRAGMA user_version` + `application_id` | 2 | 更新版本拒绝打开；旧版本只读或拒绝 |
| 备份存储格式 | `store.json.version`、ref/commit/object `version` | 1 | 新版本只读；旧版本拒绝写入 |
| 便携导出格式 | `.sqlite` 的 schema + `library_meta` | schema 2 | 导入时迁移；过高拒绝 |

### 10.0 现有实现的差距

| 现有实现 | 差距 | 处理 |
| --- | --- | --- |
| Go `store.Open` 创建 v1 表，但从不写 `user_version` | Go 库的版本是 0，无法和浏览器统一 | 迁移时统一写 `application_id` / `user_version = 2` |
| 浏览器 Worker 在 0 时写 `user_version = 1` | 和 Go 的版本语义不一致 | 同一迁移器处理 0/1/2 |
| 两端都没有 `application_id` | 无法快速拒绝外部 SQLite | 统一写入 `0x52504552` |
| `revisions` 没有 `chart_hash` | 每次快照都要读全部修订文本 | schema 2 增加列，写入时填充，旧值惰性回填 |
| 浏览器恢复直接 `importDb` 覆盖 | 覆盖中途崩溃可能留下不可用库 | 正常走事务替换；损坏库走 intent + 回滚 |
| 浏览器没有资源 GC | 删除项目后孤立 BLOB 永久占用空间 | 在 live DB 增加 staging lease GC；备份对象由快照 GC 管理 |
| 桌面 ZIP 导入暂存后下次启动提升 | 提升后没有历史根提交 | 启动时检测空历史并 bootstrap |
| 三端都没有快照存储 | 没有自动历史 | 新增 Go/TS `librarybackup`，共享格式 |

### 10.1 SQLite schema 归一化

当前代码有一个必须修的差异：

- Go 的 `schemaVersion = 1`，但 `Open` 从不写 `PRAGMA user_version`，所以 Go 创建的库是 0。
- 浏览器 Worker 在 `user_version === 0` 时写 1。
- 两边都没有 `application_id`。
- 桌面 Rust 的 `recovery_*` 表在同一个 `redux.db` 里，由 `recovery_meta.schema_version = 2` 单独管理。
- `revisions` 没有 `chart_hash`，无法做增量快照。

正式方案：

- 固定 `application_id = 0x52504552`（ASCII `RPER`，十进制 1380992338）。
- 当前 schema 为 2。
- schema 2 在 schema 1 基础上只做加法：
  - `revisions.chart_hash TEXT NOT NULL DEFAULT ''`；
  - `library_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`；
  - 写入 `database_id`、`created_at`、`schema_origin`；
  - 设置 `application_id` 和 `user_version = 2`。
- `recovery_*` 不计入库 schema 版本；它们是宿主辅助表，由 Rust 自己的 `recovery_meta` 管理。

迁移步骤：

1. 打开数据库，读取 `application_id`、`user_version` 和 `sqlite_master`。
2. 没有任何库表：按 schema 2 新建。
3. `application_id = 0` 且存在 `projects/revisions/assets/...`：视为 v0/v1 旧库，进入迁移。
4. `application_id = RPER` 且 `user_version` 为 0/1/2：进入对应迁移。
5. 其他 `application_id`：拒绝，错误码 `library_not_recognized`。
6. `user_version > 2`：拒绝写入，错误码 `library_schema_too_new`；应用以只读/恢复模式启动，提示升级。

迁移前：

- 先 checkpoint WAL。
- 用 SQLite 的 `VACUUM INTO` 在 `backups/pre-migration/` 写一份原始副本，文件名带旧版本和时间。
- 保留最近 3 份；新版本成功启动后也不立即删除，交给后续迁移轮换。

迁移本身：

```sql
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS library_meta (...);
-- SQLite 不支持 ADD COLUMN IF NOT EXISTS；迁移器先查 pragma_table_info。
ALTER TABLE revisions ADD COLUMN chart_hash TEXT NOT NULL DEFAULT '';
-- 其他加法列/表
PRAGMA application_id = 1380992338;
PRAGMA user_version = 2;
COMMIT;
```

`revisions.chart_hash` 不做全量阻塞回填。写入修订时同时计算并保存 hash；旧的空值在准备快照或空闲维护时分批读取图表文本、计算 SHA-256、写回；为空时快照临时计算，不阻塞打开。新建库时同时生成 `library_meta.database_id`（UUID），已有库在迁移时补上。

失败处理：

- 迁移事务失败：回滚，旧库仍可用；应用显示迁移失败和 pre-migration 副本路径。
- 迁移后完整性检查失败：自动用 pre-migration 副本恢复；恢复失败则保留两份文件并给出路径。
- 浏览器：在 Worker 初始化阶段完成迁移；失败时进入恢复模式，允许下载/恢复 pre-migration 副本。

旧应用兼容：

- 只做加法，旧应用的显式列查询不受影响。
- 旧浏览器应用只在 `user_version === 0` 时写 1；看到 2 会保留，不会破坏。
- 旧 Go 应用不检查 `user_version`，可以继续读写；它不会写 `chart_hash`，新应用按空值处理。
- 破坏性迁移必须推迟到下一个大版本，并在打开时要求最低应用版本。

### 10.2 备份存储格式版本

- `store.json.version`、ref、commit、根树、项目清单、修订集、偏好对象、对象封装都有独立的 `version`。
- 读取端接受 `version <= 当前支持版本`；未知新版本时只读，不写、不 GC、不迁移。
- 写入端总是写当前版本。
- 第一版（v1）按前向兼容设计：新增字段忽略，不改变已有字段含义；只有破坏性变化才升版本。
- 如果必须迁移存储格式，先复制整个 `library-history/` 到 `library-history.pre-migration-<version>-<time>/`，再写新格式。桌面可以对大目录使用硬链接/复制；浏览器只能复制，空间不足时拒绝迁移并保持旧格式只读。
- 迁移成功后保留旧目录至少一个版本周期；用户确认后再删除。

### 10.3 旧桌面 ZIP 和 `.sqlite`

现有桌面备份是 ZIP：

- `manifest.json`：`{"format":"rpe-redux-app-backup","version":2,"parts":[...]}`；
- `user-data/redux.db` 及可选的 `-wal` / `-shm`；
- `themes/`、`skins/`、`extensions/`。

迁移规则：

- 保留 ZIP 格式和现有导入/导出，不把它替换成快照存储。
- 导入 ZIP 时，数据库部分走现有路径：暂存、`quick_check`、库表校验、`redux.db.import`、下次启动提升。
- 提升完成后，第一次启动检测到“新库 + 空历史”时，创建一个 `reason: "bootstrap"` 或 `"import-legacy"` 的根提交。
- 如果 ZIP 的数据库是 v0/v1，先按 10.1 迁移，再创建根提交。
- ZIP 中的主题/皮肤/扩展继续按宿主恢复；它们不进库快照，浏览器也不接受这些 part。
- ZIP 没有数据库、只有扩展/主题时，只恢复宿主包，不改变历史。
- manifest 版本高于当前支持版本时拒绝，不尝试部分导入。

`.sqlite` 导入：

- 桌面：Tauri 选择文件 → 复制到 `user-data/imports/<uuid>.sqlite` → Go 服务校验/迁移 → 建临时库 → 正常恢复事务 → 写 `reason:"import"` 提交。
- 浏览器：文件选择 → 写入 OPFS 临时文件 → 校验/迁移 → 正常恢复事务 → 写 `reason:"import"` 提交。
- 校验顺序：SQLite 头 → `quick_check` → 库表存在 → `application_id`（0 或 RPER）→ `user_version <= 2` → 迁移 → `integrity_check`。
- 如果目标库已有数据，先写 pre-restore 快照；导入失败时 live DB 不变。
- 跨宿主导入时，宿主本地偏好段按 3.5 丢弃/保留，不迁移路径和服务地址。

### 10.4 跨宿主可移植性

导出：

- 从任意提交构建一个独立 `.sqlite`，使用当前 schema，包含 `projects`、`assets`、`project_assets`、`revisions`、`revision_assets`、`preferences`、`library_meta`。
- 不包含 `recovery_*`、WAL/SHM、主题/皮肤/扩展、日志。
- 设置 `application_id = 0x52504552`、`user_version = 2`、`journal_mode = DELETE`，执行 `VACUUM`。
- 文件名 `RPE-Redux-library-<timestamp>.sqlite`。
- 导出的是**逻辑库**，不是备份存储目录；接收方导入后会生成自己的根提交和本地历史。

导入：

- 桌面、浏览器、远程使用同一套校验和迁移。
- 项目 ID、修订 ID、资产 hash、`created_at` 保留；`database_id` 保留，便于识别同一库的不同副本。
- 偏好按 `portable-v1` 合并。
- 恢复后写 `reason:"import"` 提交；如果来源是另一个 `database_id`，提交里记录 `importedFromDatabaseId`（可选字段）。

矩阵：

| 来源 → 目标           | 数据库            | 偏好         | 主题/皮肤/扩展 | 结果                 |
| --------------------- | ----------------- | ------------ | -------------- | -------------------- |
| 桌面 v0/v1 → 桌面 v2  | 迁移              | 保留         | 保留           | 本地升级 + 根快照    |
| 桌面 v2 → 桌面 v2     | 直接              | 合并         | 保留           | 同版本恢复           |
| 浏览器 v1 → 浏览器 v2 | 迁移              | 保留         | 不适用         | 本地升级 + 根快照    |
| 桌面 ↔ 浏览器         | `.sqlite`         | 只带可移植段 | 不迁移         | 跨宿主导入           |
| 桌面/浏览器 ↔ 远程    | `.sqlite` 或 HTTP | 只带可移植段 | 不迁移         | 跨宿主导入           |
| 旧 ZIP v2 → 桌面      | 暂存/提升         | 保留         | 恢复           | 启动后根快照         |
| 旧 ZIP v2 → 浏览器    | 不支持            | —            | —              | 提示先解压 `.sqlite` |
| 新 schema → 旧应用    | 拒绝              | —            | —              | 提示升级             |
| 新存储格式 → 旧应用   | 只读/拒绝         | —            | —              | 不写坏数据           |

### 10.5 旧浏览器 `.sqlite` 和手动备份

- 浏览器现有“下载备份/恢复备份”继续保留，作为用户可带走的外部副本。
- 恢复旧 `.sqlite` 时走 10.3 的校验/迁移，不再直接 `importDb` 覆盖而没有 intent。
- 第一次启用自动备份时，如果历史为空且有数据，创建 `bootstrap` 根提交；不自动导入用户以前下载的每个 `.sqlite`。
- 旧的 `opfs-sahpool` 数据库在 `user_version=1` 时按 10.1 迁移。
- 迁移前的 `VACUUM INTO` 副本放在 OPFS `library-history/pre-migration/`，不放在数据库池里，避免迁移失败时一起损坏。

### 10.6 更新前和迁移前

- 应用更新前：前端调用 `snapshot({ reason: "pre-update", pin: true })`，然后现有 Tauri `create_update_backup` 继续写完整 ZIP。快照失败不阻止更新，但状态页记录错误；ZIP 仍然可用。
- schema 迁移前：写原始 `pre-migration-v<old>-<time>.sqlite`；如果旧 schema 能被快照读取器理解，再写一个 `pre-migration` 提交。未知旧 schema 只保留原始副本。
- 迁移成功后保留 pre-migration 副本至少一个版本周期；pre-migration 提交 pin 最近 3 个。
- 更新/迁移失败时，用户可以从 ZIP、`.sqlite` 或快照恢复；三条路径互不依赖。

### 10.7 降级和不支持的新版本

- 应用看到 `user_version > 2`：不打开写入，显示“此库由更新版本创建”；允许导出原始文件，但不尝试读取。
- 应用看到 `store.version > 1`：备份历史只读；不写 ref、不 GC、不迁移；库本身仍可正常编辑。
- 应用看到 commit `version > 1`：该提交在历史中显示为“需要更新版本”，不参与恢复；其他旧提交仍可用。
- 不允许自动删除“看不懂”的文件。清理只能由用户确认或由更高版本执行。

### 10.8 迁移测试矩阵

| 场景 | 期望 |
| --- | --- |
| Go v0 库（无 `user_version`/`application_id`，含 recovery 表） | 迁移到 v2，recovery 表保留，创建根快照 |
| 浏览器 v1 库（`user_version=1`，无 `application_id`） | 迁移到 v2，创建根快照 |
| 有 `application_id` 但不是 RPER | 拒绝，live 不变 |
| `user_version=99` | 拒绝写入，只读/恢复模式 |
| 旧 ZIP v2 + WAL | 暂存、校验、提升、迁移、根快照 |
| 旧 ZIP v2 只有扩展 | 恢复扩展，不改变库历史 |
| 旧 ZIP 版本 3 | 拒绝 |
| `.sqlite` v0/v1 导入 | 迁移、恢复、写 import 提交 |
| 新 schema `.sqlite` 导入旧应用 | 拒绝，live 不变 |
| 跨宿主导入 | 项目/资产/修订保留，宿主偏好丢弃 |
| 恢复中途崩溃 | intent 回滚到 pre-restore |
| 迁移前崩溃 | 原始副本可用 |
| 备份存储格式过新 | 历史只读，库可编辑 |

## 11. 自动备份策略

### 11.1 触发点

在以下操作成功后标记 dirty：

- 项目创建、更新（带 chart）、删除、复制；
- `commit` 保存；
- 修订创建、删除；
- 偏好保存；
- 导入、恢复、迁移完成。

不在 `stageAsset` 时备份：未提交的 staged BLOB 可能是废弃上传，不应进入历史。

### 11.2 去抖、设置和补偿

- 设置项 `library-backup-auto` 控制自动快照；关闭后服务不创建快照 ticker，只等待设置变化或进程退出。
- 设置项 `library-backup-interval-seconds` 控制最长等待秒数，范围 30–3600；它是“最大延迟”，不是固定节拍。
- 设置值保存在 live 数据库的偏好 `settings` 段；偏好保存后，Go 服务通过 preference hook、浏览器 Worker 通过 `savePreferences` 立即重读，不需要重启。
- 关闭自动快照只停止后台计时器；显式的 `snapshot` / `restore` 命令仍然可用。
- 去抖 20 秒；期间多次写入只跑一次。
- **最大延迟 120 秒**：从第一次变脏开始计时，即使编辑器连续写入，也会在 2 分钟内落一次快照。去抖只推迟“最后一次写入之后”的等待，不会无限推迟第一次变脏之后的备份。
- 快照运行期间再有写入，标记 `dirty`，当前快照结束后再排一次。
- 启动时如果 `lastBackupAt` 超过 24 小时、`dirty=true`，或 `library-history/dirty.json` 存在，延迟 5 秒补一次。
- 失败退避 30 秒 → 2 分钟 → 10 分钟 → 1 小时；手动备份重置退避。
- 页面关闭/应用退出不启动新快照；桌面可以让正在进行的快照完成，浏览器最多丢失一个去抖窗口或最大延迟窗口，因为 live DB 仍是权威。
- 空库（没有项目、没有可移植偏好）不自动创建快照；手动可以。

### 11.3 每次快照做什么

- 读取 live DB 的一致性视图；
- 只写缺失对象；
- 写根树、项目清单、修订集、偏好；
- 写提交和 ref；
- 更新状态缓存；
- 按策略决定是否 prune/GC。

### 11.4 状态

状态页显示：

- 上次成功时间、提交 ID、原因；
- 下次自动备份时间；
- 提交数、对象数、备份占用、live DB 大小；
- 浏览器 quota / usage / persistent；
- 最近错误码和可读说明；
- 是否有损坏 HEAD、缺失对象、只读模式；
- pin 的提交和迁移前副本。

## 12. API 和实现落点

### 12.1 共享 API

在 `LocalLibrary` 上增加备份方法，`BrowserLibrary` 覆盖为 Worker RPC：

```ts
interface LibraryBackupStatus {
  enabled: boolean;
  lastBackupAt: string | null;
  head: string | null;
  healthy: boolean;
  commits: number;
  objects: number;
  bytes: number;
  liveBytes: number;
  quota?: { usage: number; total: number; persisted: boolean };
  lastError: string | null;
}

interface LibrarySnapshotSummary {
  id: string;
  parent: string | null;
  reason: string;
  createdAt: string;
  pinned: boolean;
  projects: number;
  assets: number;
  revisions: number;
  bytes: number;
  sourceHost: string;
  damaged: boolean;
}
```

服务方法：

- `backupStatus()`
- `snapshot({ reason?, note?, pin? })`
- `snapshotHistory({ limit?, before? })`
- `restoreSnapshot({ commitId })`
- `verifyBackups({ commitId? })`
- `compactBackups({ keepCommits?, keepDays?, maxBytes? })`
- `setBackupPolicy(policy)`
- `pinSnapshot({ commitId, pinned })`
- `exportLibrary({ commitId? })` → 临时文件/字节流
- `importLibrary({ source })`

### 12.2 HTTP

Go 服务新增 `/api/library/backups/*`：

| 方法 | 路径         | 作用                 |
| ---- | ------------ | -------------------- |
| GET  | `/status`    | 状态                 |
| POST | `/snapshots` | 立即快照             |
| GET  | `/commits`   | 历史列表             |
| POST | `/restore`   | 恢复                 |
| POST | `/verify`    | 校验                 |
| POST | `/compact`   | 轮换/GC              |
| POST | `/policy`    | 更新策略             |
| POST | `/pin`       | pin/unpin            |
| GET  | `/export`    | 导出 `.sqlite`（流） |
| POST | `/import`    | 导入 `.sqlite`       |

所有写接口需要现有库写权限；远程部署还需要认证。错误使用稳定代码，前端翻译。

### 12.3 Go 包

`src/backend/internal/librarybackup/`：

- `format.go`：版本、对象封装、JSON 结构、限制。
- `store.go`：`ObjectStore` 接口、文件实现、原子写、锁。
- `snapshot.go`：读 live DB、增量对象、提交/树/清单。
- `restore.go`：临时库构建、事务替换、intent 文件替换。
- `compact.go`：prune、squashAll、GC。
- `verify.go`：完整 hash 校验、损坏报告。
- `policy.go`：偏好策略、保留策略、配额估算。
- `service.go`：去抖、状态、错误退避、启动补偿。
- `migrate.go`：schema 迁移、旧 ZIP/.sqlite 辅助。
- `*_test.go` 和共享 fixture。

`store.Store` 增加 MutationHook；`librarybackup.Service` 注册回调，避免 store 反向依赖 backup。

### 12.4 TypeScript 包

`src/core/platform/browser/library/` 拆分：

- `backup/format.ts`：和 Go 对应的版本、JSON、对象头、限制。
- `backup/objectStore.ts`：OPFS 实现 + 内存实现（测试）。
- `backup/snapshot.ts`：读 live DB、增量对象。
- `backup/restore.ts`：临时库、事务替换、intent 回滚。
- `backup/compact.ts`：prune/squash/GC。
- `backup/verify.ts`。
- `backup/policy.ts`。
- `backup/service.ts`：去抖、状态、leader 生命周期。
- `db.worker.ts` 只保留 SQLite 和消息循环，导入备份命令；避免单文件超过 800 行。
- `browserLibrary.ts` 增加 RPC 方法；follower 通过 leader 转发。
- `assetUrlCache` 和资源 blob URL 逻辑不变。

### 12.5 前端

- 新增共享的“库历史”设置页，所有宿主可见；宿主存储页（浏览器配额、桌面数据目录）作为它的子区块或并列区块。
- 桌面 `Files & data` 页显示：库历史、现有完整 ZIP 备份、打开数据目录。
- 浏览器 `Browser storage` 页显示：持久化、配额、库历史、下载/导入 `.sqlite`。
- 操作：立即备份、恢复、校验、压缩、pin/unpin、下载当前/历史 `.sqlite`、导入 `.sqlite`。
- 恢复前展示：时间、原因、项目数、资产数、大小、来源宿主；确认后先自动写 pre-restore 快照。
- 进度：快照/恢复可能持续数秒；显示 busy 状态和非阻塞通知，不冻结编辑器。
- 错误：`quota_low`、`store_corrupt`、`head_damaged`、`schema_too_new`、`store_too_new`、`object_missing`、`restore_failed` 等映射到翻译文本。
- 首次启用：解释备份在本机，清理站点数据/删应用数据会一起删除；建议定期导出 `.sqlite`。

### 12.6 Tauri

- 保留 `export_app_backup` / `import_app_backup` 及 pre-update ZIP。
- 新增只做文件选择和复制的命令：
  - `pick_library_export_path`
  - `pick_library_import_file`
  - `copy_library_export`
  - `stage_library_import`
- 不把备份对象存储逻辑放进 Rust，避免 Go/TS/Rust 三份实现。
- 更新流程：先请求前端快照，再调用现有 `create_update_backup`。

## 13. 性能目标

| 场景                | 目标                       |
| ------------------- | -------------------------- |
| 空库/小库快照       | < 50 ms                    |
| 无变化快照          | < 100 ms（不读图表和资源） |
| 新增一个图表        | < 100 ms + 图表文本大小    |
| 新增 10 MB 资源     | 桌面 < 2 s，浏览器 < 5 s   |
| 恢复 1 GB 库        | 桌面 < 30 s，浏览器 < 60 s |
| GC 10,000 个对象    | < 1 s                      |
| 历史列表 100 个提交 | < 100 ms                   |

实现要点：

- 增量对象：不读已存在对象的字节。
- 项目清单/修订集按内容寻址，减少重复 JSON。
- 大资源流式读写；浏览器 v1 仍受 SQLite WASM 单次 BLOB 读取的内存限制，后续再做分块。
- 恢复在临时库构建，live 锁只覆盖最终事务。
- 不在 UI 线程做压缩或 hash；桌面在 Go，浏览器在 Worker。

## 14. 安全

- 备份目录权限：桌面 0700/0600；远程由服务账号和卷权限控制；浏览器同源私有。
- 远程备份 API 必须和库写接口使用同一认证；导出包含全部谱面，不能公开缓存。
- 路径：对象键只允许 64 位小写十六进制和固定文件名；导入文件先复制到服务目录，不接受任意路径。
- ZIP：保留现有条目数、单文件、总大小、路径穿越、符号链接、重复条目限制。
- 快照 JSON：限制大小、项目数、资产数、修订数、父链深度；拒绝重复 ID、重复资产名、非法名字。
- 解压：限制解码后大小和压缩比，防止 gzip bomb。
- 同意类设置绝不跨宿主恢复：代码执行、扩展免责声明等必须重新由用户确认。
- 远程备份默认不加密；依赖磁盘/对象存储的服务端加密。应用层加密作为后续可选功能，不能假装已经实现。
- 同源页面可以读 OPFS；需要隔离时用独立域名，文档和设置页都要说明。
- 不把备份内容写日志；诊断包只包含状态、计数和错误码。

## 15. 测试

### 15.1 单元和契约

- 对象封装：raw/gzip、hash 校验、截断、错误魔数、超限。
- 提交/根树/项目清单/修订集/偏好：序列化、排序、重复 ID、未知字段、版本过新。
- ref：checksum、generation、部分写入、重复 generation、损坏 JSON。
- 快照：增量对象、未变化项目复用、资产去重、修订集复用。
- 恢复：事务回滚、外键顺序、偏好合并、recovery 表保留。
- prune/squash/GC：可达性、pin、缺失 parent、GC 中途崩溃。
- 配额：空间不足、失败回退、孤儿对象。
- 迁移：10.8 矩阵。

### 15.2 跨语言一致性

共享 fixture 目录 `src/test/fixtures/library-backup/v1/`：

- 一个两项目、两资产、一个修订、混合偏好的库。
- Go 写出的对象/提交/ref；TypeScript 读取并恢复。
- TypeScript 写出的对象/提交/ref；Go 读取并恢复。
- 固定时钟和 appVersion，提交 ID 可预测。
- 崩溃 fixture：孤儿提交、半截 ref、截断对象、缺失 parent、pin 的 detached 提交。
- 迁移 fixture：v0 桌面库、v1 浏览器库、外部 `application_id`、新版本库、旧 ZIP v2。

### 15.3 浏览器 E2E

- 创建谱面 → 等待自动快照 → 返回首页 → 修改 → 恢复上一个快照 → 刷新后验证。
- 下载 `.sqlite` → 清空/新建库 → 导入 → 数据恢复。
- 两个标签页：leader 备份，follower 读历史；关闭 leader 后新 leader 继续备份。
- 配额模拟：`navigator.storage.estimate` 返回低空间，自动备份跳过并显示错误。
- 恢复 intent：在 import 后强制刷新，验证回滚或完成。

### 15.4 桌面 E2E

- 创建/修改/恢复；恢复后 recovery 草稿仍在。
- 旧 ZIP 导入 → 重启提升 → 根快照存在。
- 更新前快照和 ZIP 都存在。
- 迁移失败 → pre-migration 副本可恢复。
- 两个前端窗口共享一个 sidecar 时不重复快照。

### 15.5 远程

- 临时目录启动服务，自动快照、导出、导入、重启后历史仍在。
- 只读第二个实例不能写 ref。
- `--backup-dir` 不可写时健康检查报错，库仍可读写。

## 16. 分阶段实施

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| 0 | schema 归一化：`application_id`、`user_version=2`、`revisions.chart_hash`、`library_meta`、迁移框架和矩阵测试 | 旧库可迁移；旧应用仍能打开；迁移失败可回滚 |
| 1 | Go/TS `librarybackup` 核心：对象存储、格式、gzip、提交/树/清单、校验、共享 fixture | 两端可互读；对象损坏可诊断 |
| 2 | 手动快照/恢复：临时库、事务替换、pre-restore、intent 文件替换、API | 恢复失败不破坏 live DB；pre-restore 可回退 |
| 3 | 自动触发、去抖、保留、pin、GC、状态 API、共享设置页 | 保存后自动备份；空间可控；浏览器/桌面都能恢复 |
| 4 | 旧 ZIP/`.sqlite` 导入、跨宿主导出/导入、pre-update/pre-migration、迁移矩阵 | 旧用户升级不丢数据；桌面↔浏览器可搬运 |
| 5 | 远程对象存储（S3）、多实例租约、应用层加密、流式大文件 | 远程持久卷或对象存储可用 |

阶段 0–2 可以先在桌面落地，浏览器复用同一套格式；阶段 3 再把 UI 接到浏览器。功能开关 `library-history` 默认关闭，阶段 4 完成后默认开启；现有 `.sqlite` 下载/恢复和完整 ZIP 备份始终保留。

## 17. 当前进度（2026-11-10）

阶段 0–3 的核心已经落地，设置页的“库历史”列表尚未做。

已落地：

- Go `store.Open` 写入 `application_id = 0x52504552` 和 `user_version = 2`；浏览器 Worker 使用同一组版本号和迁移逻辑。
- `revisions.chart_hash`、`library_meta` 和迁移前原始副本已加入两端；外部 SQLite 和更新 schema 会被拒绝。
- Go `internal/librarybackup`：对象/提交/根树/项目清单/修订集/偏好对象、gzip 对象封装、只追加 ref、快照、事务恢复、校验、保留/GC、HTTP 状态和命令接口。
- 浏览器 Worker：同一格式的 OPFS 对象存储、自动/手动快照、状态/历史/校验/恢复/压缩、损坏 live DB 时的恢复模式（保留 Worker，让现有 `.sqlite` 恢复按钮可以替换坏库）。
- 自动循环：20 秒去抖 + 可配置的 **30–3600 秒最大延迟**（默认 120 秒），持续编辑也会在设定时间内落一次快照；启动补偿 24 小时；写入后到快照前的崩溃由 `dirty.json` 标记在下次启动补上。
- 设置页有“自动快照”开关和“快照间隔（秒）”；关闭开关会禁用间隔输入，并完全停止后台计时器。设置保存在 live 数据库，Go 服务和浏览器 Worker 在偏好保存后立即重读。
- 恢复：先写 `pre-restore` 快照，再在事务中替换库表；`recovery_*` 等宿主表保留。
- 现有 `.sqlite` 下载/恢复按钮保持不变；没有新增库历史 UI。

已验证：

- Go 测试：快照、资产去重、偏好过滤、恢复、recovery 表保留、校验、压缩、最大延迟触发。
- Rust 备份导入测试：拒绝更新 schema。
- 浏览器 E2E：自动快照、手动快照、历史、校验、恢复到旧快照、压缩；以及 v1 `.sqlite` 迁移。
- `npm run verify`：1393 个单元/契约测试 + Go 测试 + Prettier。

尚未落地：设置页库历史列表、pin/keepDays/空间阈值策略、旧 ZIP 自动导入历史、跨宿主快照存储同步、远程 S3、损坏 Go 数据库时的文件替换恢复、配额 UI。桌面损坏库仍可用现有完整 ZIP/`.sqlite` 导入恢复。

## 18. 决策和开放问题

### 已决定

- 不做完整 Git；只做内容寻址对象、提交、ref、prune/squash/GC。
- 快照是整库逻辑快照，`revisions` 包含在内。
- 备份存储和 live DB 分离。
- 正常恢复用事务替换库表；损坏库用 intent 文件替换。
- 旧 ref 不覆盖；新 ref 用新 generation。
- 对象文件名只用 hash；编码放在对象头，保证跨宿主去重。
- 媒体不压缩；文本按大小决定是否 gzip。
- 旧 ZIP 保留为完整应用备份；新历史只负责谱面库。
- 偏好按可移植策略过滤，同意类设置绝不跨宿主。

### 待定

- 默认自动备份是否在浏览器首次访问就开启，还是等用户申请持久化后再开启。
- `keepCommits` 默认 50 是否足够；桌面大库和浏览器小库是否用不同默认值。
- 手动快照默认 pin 的保留上限；pin 太多时如何提示。
- 是否在 v1 就实现 S3 对象存储，还是先只支持本地持久卷。
- 是否把旧 pre-update ZIP 自动导入历史，还是只保留 ZIP。
- 浏览器大文件导出/导入的流式实现；当前内存模型的上限。
- 应用层加密是否必要；远程部署是否只依赖磁盘加密。
- 是否支持“合并导入”而不是整库替换；v1 明确不做。
- 扩展设置在跨宿主时是否应该跟随扩展安装状态过滤，还是保留未知键。
- 历史列表是否需要 diff 预览（项目级变更），还是只显示计数和时间。
