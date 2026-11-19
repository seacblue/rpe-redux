---
"rpe-redux": patch
---

### 中文

**修复**

- 暂停播放时播放头（判定线）出现的一次跳动。播放期间时间轴锚点每帧跟随视觉时钟，而暂停时传输会冻结在权威音频时间上；上一帧画出的视觉时间最多领先一帧，暂停后锚点不再刷新，于是网格停在插值位置、播放头回到采样值，差值被画成一次位移。现在暂停时会重新发布一次定位，让锚点与播放头对齐到同一个时刻。
- 定位操作只报告一次最终位置，避免同一帧内重复触发视图刷新。

### English

**Fixed**

- A jump in the playhead at the judgement line when playback stops. During playback the timeline anchor follows the visual clock every frame, while pausing freezes the transport at the authoritative audio time. The last drawn frame used a visual time up to one display frame ahead, and no further anchor update follows a pause, so the grid kept the interpolated position while the playhead returned to the sampled one — drawn as a single displaced frame. A pause now republishes the position so the anchor and the playhead settle on the same instant.
- A seek reports the final position once instead of reporting the intermediate frozen position as well.
