---
"rpe-redux": patch
---

### 中文

**修复**

- 多线合并视图下放置音符后立即出现在时间线上。分页谱面在编辑后复用同一个门面对象，行范围缓存只看谱面与行数组身份，因此不再扩展新增音符所在行的拍点范围，合并视图会跳过这一行；现在缓存按每行的音符数组重建。

### English

**Fixes**

- Notes placed in the merged multi-line view appear on the timeline immediately. A paged chart keeps one facade object across edits, so the cross-line range cache never widened the edited line's beat bounds and merged painting skipped it; the cache now rebuilds from each line's note array.
