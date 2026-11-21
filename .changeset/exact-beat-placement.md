---
"rpe-redux": patch
---

### 中文

**修复**

- 修复了时间轴吸附放置把精确拍值转成浮点数、再按万分之一量化，导致 12 分格下音符与事件起始拍漂移的问题。1/12 放置现在保存为 `0:1/12`，移动到 1/4 后保存为 `0:1/4`，不再出现 `7499/30000`。
- 音符与事件放置、双点 Hold、剪贴板粘贴、BPM 时间点、曲线拾取、批量编辑的时长与克隆偏移、Shader 参数轨对齐等写回路径现在都保留 Beat 三元组，使用通分约分代替浮点往返。

### English

**Fixes**

- Fixed snapped timeline placement converting a precise beat to a float and re-quantizing it over 1/10000, which drifted note and event starts at a 12-line division. A 1/12 placement now stores `0:1/12`, and moving it to 1/4 stores `0:1/4` instead of `7499/30000`.
- Note and event placement, two-click Holds, clipboard paste, BPM timing points, curve picks, batch-edit durations and clone offsets, and shader parameter-track alignment now keep the exact Beat triple and use common-denominator arithmetic instead of a float round trip.
