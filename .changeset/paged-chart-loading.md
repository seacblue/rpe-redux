---
"rpe-redux": minor
---

### 中文

**改进**

- 对大谱面进行加载优化，优化音频加载与频谱生成的性能。
- 分页谱面在打开和导入时会先完成所有行物化，再进入编辑器；预览和时间线从首帧起就是完整谱面，索引中的总音符/总事件统计保持不变。
- 音频解码与谱面物化并行启动；可播放缓冲一就绪就立即启动波形和频谱 worker，不再等整张谱面读完再串行解码。
- 加载进度同时按已物化行和对象计数推进；首帧场景按帧预算分片编译并显示进度，密集谱面不会再长时间停在 80% 之后。浏览器行指纹由独立 worker 池并行计算，打开过程不再重复为每行计算对象摘要。
- 修复便携包中内置音符皮肤清单被 SPA 回退为 HTML、导致音符和判定线不显示的问题；预览可见性现在会从当前布局初始化并在区域切换时刷新。
- 修复分页行物化后复用只读空采样状态、导致 preview 绘制抛异常而只显示背景的问题。
- CRUD 提交只校验和哈希本次变更的判定线，不再全谱扫描负拍或对象；多行编辑的预览编译继续按帧预算分批完成。
- 导入采用 16MiB 的流式提交阈值，并按每个分块的字节数更新进度，导入进度条可以稳定走完最后 20%。

### English

**Improvements**

- Improved large-chart loading and the performance of audio loading and spectrum generation.
- A paged chart now materializes every line before the editor opens, so the preview and timeline see the complete chart from the first frame while the index keeps chart-wide note and event totals exact.
- Audio decoding starts beside line materialization, and the waveform and spectrum workers start as soon as the playable buffer exists instead of waiting for the whole chart to finish reading.
- Opening progress advances by both materialized lines and objects. The first scene compiles in bounded slices with visible progress, so dense charts no longer appear stuck past 80%; browser line fingerprints run in a separate worker pool and are not re-walked for object digests.
- Fixed the portable build serving the bundled note-skin manifest as the SPA HTML, which hid notes and judge lines; preview visibility now initializes from the current layout and refreshes when regions change.
- Fixed a frozen empty sample slot being reused after its paged line materialized, which made the preview draw throw and leave only the background visible.
- A CRUD commit validates and hashes only the lines it replaced instead of scanning the whole chart for negative beats or object identity; multi-line preview compilation still completes under a per-frame budget.
- Imports use a 16MiB streaming commit threshold and report byte progress per chunk, so the import bar reliably advances through its final 20%.
