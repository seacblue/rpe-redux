---
"rpe-redux": patch
---

### 中文

**修复**

- 谱面库读取元数据时不再把整份谱面解析成对象树，大型谱面保存阶段明显加快，内存占用大幅下降。
- 事件总数现在会把 `eventLayers` 与 `extended` 中的轨道一起计入；此前这种结构的谱面事件数一直显示为 0。

### English

**Fixes**

- The chart library reads metadata with one linear pass instead of decoding the whole chart, so saving a large chart is much faster and uses far less memory.
- The event total now counts the tracks inside `eventLayers` and `extended`; charts stored that way previously reported zero events.
