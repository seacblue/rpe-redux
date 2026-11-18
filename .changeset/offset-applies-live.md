---
"rpe-redux": patch
---

### 中文

**修复**

- 调整谱面时间偏移后立即生效，不再需要重新载入音频：提交偏移时播放头在谱面时间上保持不动，音频时钟随之平移，预览、时间轴和进度读数同步更新。

### English

**Fixes**

- Editing the chart time offset now takes effect immediately instead of requiring the audio to be reloaded: committing the offset keeps the playhead at the same chart time while the audio clock moves with it, and the preview, timeline, and progress readouts follow.
