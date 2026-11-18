---
"rpe-redux": patch
---

### 中文

**新增**

- 时间偏移面板新增「对齐到横线」：点击后暂停播放、强制显示时间轴并把横线换成醒目的蓝色，随后在时间轴上点击横线或音符即可完成对齐，并以提示说明操作方式。

**修复**

- 调整时间偏移不再移动播放头：音频位置保持不变，谱面相对音频滑动。偏移设为负值时谱面会从音频起点之前开始，前导区按既有静音预卷播放。

### English

**Added**

- The offset panel gains **Align to a timeline line**: it pauses the transport, reveals the timeline, and highlights every line in an emphasized blue; the next click on a line or note completes the alignment, and a notice explains the gesture.

**Fixes**

- Editing the chart offset no longer moves the playhead: the audio position stays put while the chart slides against it. A negative offset starts the chart before the audio, played as the existing silent lead-in.
