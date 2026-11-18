---
"rpe-redux": patch
---

### 中文

**新增**

- 时间偏移面板新增「对齐到横线」：点击后暂停播放、强制显示时间轴并提示操作方式；随后在时间轴上点击某条横线即可完成对齐。装填期间只高亮鼠标最近的那条横线（改用更醒目的蓝色），点击必须落在横线上才会生效，并且不会触发音符的选中、拖动或放置。

**修复**

- 调整时间偏移不再移动播放头：音频位置保持不变，谱面相对音频滑动。偏移设为负值时谱面会从音频起点之前开始，前导区按既有静音预卷播放。

### English

**Added**

- The offset panel gains **Align to a timeline line**: it pauses the transport, reveals the timeline, and explains the gesture; the next click on a grid line completes the alignment. While armed, only the line nearest the pointer is emphasized in a brighter blue, the click must land on that line, and no note selection, drag, or placement runs.

**Fixes**

- Editing the chart offset no longer moves the playhead: the audio position stays put while the chart slides against it. A negative offset starts the chart before the audio, played as the existing silent lead-in.
