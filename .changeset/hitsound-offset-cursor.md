---
"rpe-redux": patch
---

### 中文

**修复**

- 调整谱面时间偏移后，打击音效不再错位：偏移改变会移动整条触发列表相对音频时钟的位置，因此调度游标随之重新对齐。此前播放中调整偏移会让播头附近的音符重复发声，往返调整后打击音效也会偏移且与画面不同步。

### English

**Fixes**

- Hit sounds no longer drift after a chart time offset edit. A committed offset moves every trigger against the audio clock, so the scheduler re-anchors its cursor; previously an edit in mid-playback replayed notes at the playhead, and a round trip left hit sounds offset and out of sync with the picture.
