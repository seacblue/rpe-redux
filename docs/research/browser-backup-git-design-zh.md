# 浏览器自动备份：类 Git 快照存储设计

本文回答自动备份能不能做成 Git 风格、轮换能不能 squash、备份期间崩溃如何恢复，以及 gzip 是否足够。它延续 [`github-pages-web-deployment-zh.md`](github-pages-web-deployment-zh.md) 里的浏览器 SQLite 方案，只讨论 `BrowserLibrary` 的备份层，不改动当前手动 `.sqlite` 下载/恢复。

## 结论

可以做，而且现有数据模型很适合：

- 项目、图表和资源已经按 SHA-256 做内容寻址；备份层可以直接复用这些 hash，不需要重新设计去重。
- 备份对象放在**独立的 OPFS 目录**，不要放回同一个 SQLite 数据库。否则数据库损坏时备份会一起损坏。
- 不需要实现完整 Git。一个“内容寻址对象 + 提交对象 + refs”的快照图就足够，复杂度远低于 packfile、delta、branch、merge。
- `squash` 等价于：写一个 `parent = null` 的根提交，更新 ref，然后删除不可达的旧提交和对象。保留最近 N 个提交作为操作历史，更早的合并进这个根快照。
- 崩溃安全靠“先写对象，再写提交，最后写 ref”+ 内容校验。崩溃最多留下孤儿对象或孤儿提交，不会破坏上一个有效 ref。
- gzip 对图表 JSON、偏好、提交清单有效；对 PNG/JPEG/MP3 几乎没有收益。真正省空间的是内容去重，gzip 只是补充。压缩失败或浏览器不支持 `CompressionStream` 时回退 raw。

## 现有 revisions 为什么不是备份

`revisions` 表保存的是**单个项目的图表 JSON 快照**，不含：

- 项目名称、分组、归档状态、背景/音乐引用等元数据；
- 资源 BLOB 的独立副本；
- 偏好设置；
- 整个谱面库的一致性视图。

它适合“单谱面历史”，不适合“整库恢复到某个时间点”。备份层应该是整库快照，`revisions` 只是快照里的一个字段。

## 数据模型

```text
backup/
  objects/
    <sha256>.<gz|raw>        # 不可变对象；hash 是未压缩内容的 SHA-256
  commits/
    <commit-id>.json         # 提交对象；小文件，可 gzip
  refs/
    00000001.json            # 代际 ref；只追加，不原地改写
    00000002.json
  tmp/
    <uuid>                   # 写入中的临时文件
  meta.json                  # 上次备份时间、计数、版本
```

对象类型：

- `asset`：资源 BLOB 原字节。命名/读取沿用 `assets.hash`，与 SQLite 里的内容寻址一致。
- `chart`：图表 JSON 文本。hash 对应 `projects.chart_hash`；同一图表未修改时多个提交共享一个对象。
- `preferences`：偏好 JSON 文本。
- `commit`：提交清单，单独放 `commits/`，避免和内容对象混淆。

提交清单示例：

```json
{
  "format": "rpe-redux-backup",
  "version": 1,
  "createdAt": "2026-11-10T12:00:00.000Z",
  "parent": "previous-commit-id",
  "reason": "auto",
  "projects": [
    {
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
      "revisions": [
        {
          "id": "revision-id",
          "label": "v1",
          "createdAt": "...",
          "chart": { "hash": "<sha256>", "encoding": "gzip", "size": 1234 },
          "assets": [{ "name": "cover.png", "hash": "<sha256>" }]
        }
      ]
    }
  ],
  "preferences": { "hash": "<sha256>", "encoding": "gzip", "size": 789 },
  "stats": { "projects": 1, "assets": 2, "bytes": 1234 }
}
```

ref 文件：

```json
{
  "generation": 2,
  "commitId": "<commit-id>",
  "checksum": "<sha256 of generation + commitId>",
  "createdAt": "..."
}
```

`generation` 单调递增。启动时从大到小读 refs，校验 JSON、checksum、commit 文件和对象引用；第一个有效的就是 HEAD。这样不需要依赖 OPFS 的原子 rename。

## 写入协议与崩溃恢复

一次备份：

1. 读取当前库状态：项目、图表文本、资源 BLOB、偏好、修订。
2. 对每个内容对象计算 hash；如果 `objects/<hash>.<encoding>` 已存在且校验通过，跳过。
3. 新对象写入 `tmp/<uuid>`，flush，再复制/移动到最终名字。若最终文件已存在但校验失败，覆盖它。
4. 写入 commit JSON；它只能引用已经写完并校验过的对象。
5. 写入 `refs/<generation>.json`；这是唯一让新快照“生效”的步骤。
6. 删除 tmp 文件；可选地清理不可达对象。

崩溃点分析：

| 崩溃位置 | 结果 | 恢复 |
| --- | --- | --- |
| 对象写一半 | 孤儿 tmp 或损坏的 hash 文件 | 启动时删除 tmp；读到损坏对象时忽略并按需重写 |
| 对象写完、commit 未写 | 孤儿对象 | 启动/压缩时 GC |
| commit 写完、ref 未写 | 孤儿提交 | 启动/压缩时 GC；HEAD 仍是旧提交 |
| ref 写一半 | 无效 ref | checksum/JSON 校验失败，回退到上一个 ref |
| ref 写完但 flush 未完成 | 可能丢失最新 ref | 回退到上一个 ref；不保证最新一次备份存在，但不破坏旧备份 |
| 压缩/序列化异常 | 当前备份失败 | 保留旧 ref；下次重试 |

关键点：**旧 ref 永远不被原地覆盖**。新 ref 以新 generation 文件出现；失败时旧文件仍然有效。读取端对 commit、对象和 ref 都做内容校验，宁可使用旧备份，也不接受半写文件。

live SQLite 数据库始终是当前数据源；备份过程只读 live DB，不修改它。备份失败不会影响当前编辑。

## squash / 轮换

轮换不是“删除最旧文件”，而是“重写历史”：

1. 从当前 live DB 生成一个新的 **root commit**（`parent = null`，`reason = "compact"`）。
2. 确保它引用的对象都存在且校验通过。
3. 写 commit + 新 generation ref。
4. 保留最近 N 个提交（例如 20 个自动/手动提交），以及这个 root commit；删除不可达的旧提交。
5. 从 `objects/` 删除不再被任何保留提交引用的对象。

这等价于“把之前的操作树 squash 成一个基线快照，再继续记录新的操作”。它不会保留逐次操作历史，但能：

- 控制提交数量；
- 回收旧图表/旧资源对象；
- 把“无限增长的历史”变成“基线 + 最近历史”。

可以选择保留策略：

- `keepCommits`：保留最近 N 个提交；
- `keepDays`：保留最近 N 天；
- `maxBytes`：对象目录超过阈值时触发 compact；
- 手动“压缩备份”按钮。

注意：如果用户需要审计每一次保存，不能 compact 掉所有历史；应保留 N 个最近提交，或把旧提交导出为独立归档。

## gzip 的边界

适合 gzip：

- 图表 JSON（大量重复键名、空白、坐标文本）；
- 偏好 JSON；
- commit manifest；
- 未压缩的文本资源或小体积 BMP/WAV。

不适合 gzip：

- PNG/JPEG/WebP/GIF；
- MP3/OGG/M4A/AAC；
- 已经压缩的 ZIP/PEZ。

实现建议：

- 只在 worker 里压缩，避免阻塞 UI。
- 用 `CompressionStream("gzip")` / `DecompressionStream("gzip")`；不支持时存 raw。
- 先压缩，比较大小；只有更小才用 gzip，否则 raw。
- 对象文件名带编码后缀，commit 里也记录 `encoding`，恢复时不靠猜测。
- 不要对整个数据库快照 gzip 来替代去重：数据库里资源 BLOB 会重复出现在每个快照中，gzip 无法跨快照去重。对象级内容寻址才是关键。

预计效果：

- 图表文本通常能压到原大小的 10%–30%；
- 资源目录的大小基本由媒体文件决定，gzip 收益接近 0；
- 一个只改图表的提交通常只有几 KB 到几十 KB（新 chart 对象 + commit）；
- 新增一张 10 MB 音乐时，备份增加约 10 MB（对象只存一次）。

## 自动备份策略

- 触发点：成功的 `commit`、带 chart 的 `update`、`remove`、`createRevision`、偏好保存。
- 去抖：最后一次写入后 15–30 秒执行；备份期间再有写入，标记 dirty，当前备份结束后再跑一次。
- 启动补偿：如果 `lastBackupAt` 超过 24 小时且有数据，启动后延迟执行一次。
- 不要在每个键入/拖动事件上备份；保存提交才是稳定时间点。
- `pagehide` 不启动新备份；如果上一次备份没完成，旧 ref 仍有效。
- 手动“立即备份”始终可用。

## 恢复流程

1. 读取并校验 ref → commit → 所有引用对象。
2. 在独立 OPFS 路径构建一个新的 SQLite 文件（例如 `/restore-<uuid>.db`）：
   - 建 v1 schema；
   - 插入项目、资源 BLOB、修订、偏好；
   - 跑 `PRAGMA integrity_check`；
   - 校验行数与 commit 统计一致。
3. 关闭 live DB，先把 live DB `VACUUM INTO` 到 `/pre-restore-<uuid>.db`。
4. 用 `pool.importDb` 把新库导入 `/redux.db`，重新打开并校验。
5. 失败则重新导入 pre-restore 库；成功则保留 pre-restore 一段时间。
6. 重新加载页面，刷新浏览器库和 UI。

事务式恢复（`BEGIN; DELETE; INSERT; COMMIT`）也可行，崩溃会回滚；但大资源插入会让事务很长，独立库 + 校验 + 交换更稳。

“崩溃期间恢复”分两种：

- **备份期间崩溃**：live DB 不受影响；用上一个有效 ref 恢复即可。
- **备份期间 live DB 崩溃/损坏**：如果备份对象已经完整，下一次启动可检测 `PRAGMA integrity_check` 失败并提示从最新有效备份恢复；不要自动覆盖，先让用户确认。

## 空间与配额

- 备份对象与 live DB 共享同一个 OPFS quota；备份大约增加“资源总大小 + 文本对象”的空间。
- 资源只存一次，跨项目、跨提交去重；图表文本按内容去重。
- 设置页显示：live DB 大小、备份对象大小、提交数、上次备份时间、配额。
- 超过阈值（例如 quota 的 20% 或固定 500 MB）时提示 compact 或删除旧提交。
- 浏览器清理站点数据会同时删除 live DB 和备份；自动备份不能替代下载 `.sqlite`。外部备份仍然是唯一能跨设备/跨浏览器保留的副本。

## 与“用 Git 本体”的区别

不建议引入 `isomorphic-git` 或文件系统 Git：

- 浏览器里没有真实文件系统，Git 的 index/pack/ref 操作需要 OPFS 适配；
- 资源是二进制 BLOB，Git 的 delta 压缩对媒体帮助有限；
- 我们只需要快照、去重、压缩、GC，不需要 branch/merge/rebase；
- 自建对象层可以复用现有 SHA-256 和 `assets` 表，代码量更小。

## 原型验证（2026-11-10）

在 Edge/Chromium 里用独立 OPFS 目录验证了协议，不接 SQLite，只验证对象/提交/ref 的崩溃语义：

| 场景                                                 | 结果                            |
| ---------------------------------------------------- | ------------------------------- |
| 写入对象 A → commit A → ref 1                        | HEAD = A                        |
| 写 commit B 但不写 ref（模拟备份中途崩溃）           | HEAD 仍是 A，B 是孤儿提交       |
| 写半个 ref（JSON 截断）                              | 校验失败，HEAD 仍是 A           |
| 写有效 ref 2 → HEAD = B                              | 成功                            |
| 写截断对象并让 commit 引用它                         | 对象校验失败，HEAD 回退到 B     |
| squash：写 root commit + 新 ref，删除旧 commits/refs | HEAD = 新 root；不可达对象被 GC |
| 984,933 字节的合成图表 JSON                          | gzip 后 7,645 字节，约 0.8%     |

这验证了“先对象、再 commit、最后 ref”的写入顺序和“从新到旧校验 ref”的恢复策略；真实 SQLite 快照、跨标签页、配额和真正断电仍需在产品实现里补测。

## 实施阶段

1. **对象存储**：`BackupStore` 类，负责 OPFS 目录、object 写读、hash/encoding、gzip、ref 列表和校验。
2. **快照**：从 live SQLite 读取项目/资源/偏好/修订，写 commit；`snapshot()`、`head()`、`listCommits()`。
3. **恢复**：校验链、构建独立库、`importDb` 交换、失败回滚。
4. **自动触发**：在 `BrowserLibrary` 的写操作后去抖；`lastBackupAt`。
5. **compact**：root commit + 可达性 GC；手动按钮和阈值触发。
6. **设置页**：状态、立即备份、压缩、恢复历史、下载 `.sqlite`。
7. **测试**：对象损坏、孤儿提交、ref 校验失败、压缩回退、恢复中途失败、配额不足。

## 开放问题

- 是否保留每次自动保存的提交，还是只保留手动备份点？
- 备份是否包含 `revisions` 历史？包含会让 commit 更大，但不包含则恢复后丢失单谱面历史。
- 默认保留策略（N 个提交 / N 天 / 字节上限）取什么值？
- 是否允许用户选择“只备份图表文本，不备份媒体”以节省空间？
- `CompressionStream` 在目标浏览器（尤其 Safari）的可用性和性能需要实测。
