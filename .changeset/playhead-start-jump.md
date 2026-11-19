---
"rpe-redux": patch
---

### 中文

**修复**

- 播放开始时播放头出现的一次跳动：起始后的一个输出延迟窗口内音频尚未出声，视觉时钟却按播放速度继续外推，等音频时钟开始走动时又退回取样值，画面上表现为短暂停顿后回跳。现在这个窗口内直接报告音频位置，不再外推。
- 视觉时钟插值改用锚点处记录的偏移量，而不是当前帧的偏移量。两者属于不同时刻，混用会在偏移变化的帧上产生误差。

### English

**Fixed**

- A jump in the playhead at the start of playback. For one output-latency window after a start the audio has not reached the speaker yet, but the visual clock kept extrapolating at the playback rate; when the audio clock began to move the picture fell back to the sampled value, which read as a brief stall followed by a step backwards. That window now reports the audio position directly instead of extrapolating through it.
- The visual clock interpolates with the offset captured at the anchor rather than the current frame's. The two belong to different instants, and mixing them introduced error on any frame where the offset moved.
