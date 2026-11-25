---
"rpe-redux": patch
---

### 中文

**修复**

- 将时间轴音符透明度的可见范围从 `51–255` 扩展为 `80–255`，不改变实时预览的音符透明度。
- 预加载谱面中所有被引用的自定义音效，避免较晚出现的音效因异步加载错过播放窗口。
- 音乐自然结束时不再截断仍在播放的长音符音效；手动暂停或跳转仍会停止音效。
- 默认打击音效下拉项改为 `(默认音效)` 并使用灰色文字。

### English

**Fixes**

- Extend the timeline note opacity range from `51–255` to `80–255` without changing preview note opacity.
- Preload every custom sound referenced by the chart so later entries do not miss the playback window while decoding.
- Let long note hit sounds finish when the music reaches its natural end while still stopping them on manual pause or seek.
- Show the default hit-sound option as `(Default hit sound)` in muted text.
