---
"rpe-redux": patch
---

### 中文

**新增**

- 时间偏移面板新增「对齐到横线」：点击后暂停播放、收起展开的检查器让时间轴显示出来，并提示操作方式；随后在时间轴上点击某条横线即可完成对齐。装填期间只高亮鼠标最近的那条横线（换成更醒目的蓝色），点击必须落在横线上才生效，并且不会触发音符的选中、拖动或放置。

**修复**

- 调整时间偏移不再移动播放头：音频位置保持不变，谱面相对音频整体滑动，立即生效，也不再需要重新载入音频。偏移设为负值时谱面从音频起点之前开始，前导区按既有的静音预卷播放。
- 调整时间偏移后打击音效不再错位。偏移会移动整条触发列表相对音频时钟的位置，因此调度游标随之重新对齐；此前播放中调整会让播放头附近的音符重复发声，往返调整后打击音效与画面不同步。
- 修复时值列表在修改时间偏移、新增或删除时值点后不刷新的问题。分页谱面在编辑后复用同一个门面对象，列表因此收不到变化；现在它跟随会话的内容修订号重建。

**变更**

- 「添加 BPM」改名为「添加时值点」，与列表里编辑的单位一致。

### English

**Added**

- The offset panel gains **Align to a timeline line**: it pauses the transport, collapses an expanded inspector so the timeline is visible, and explains the gesture; the next click on a grid line completes the alignment. While armed, only the line nearest the pointer is emphasized in a brighter blue, the click must land on that line, and no note selection, drag, or placement runs.

**Fixes**

- Editing the chart offset no longer moves the playhead: the audio position stays put while the chart slides against it, applied immediately and without reloading the audio. A negative offset starts the chart before the audio, played as the existing silent lead-in.
- Hit sounds no longer drift after an offset edit. The offset moves every trigger against the audio clock, so the scheduler re-anchors its cursor; previously an edit in mid-playback replayed notes at the playhead, and a round trip left hit sounds out of sync with the picture.
- The timing list now refreshes after an offset edit and after adding or deleting a timing point. A paged chart reuses one facade object across edits, so the list never saw a change; it now rebuilds from the session's content revision.

**Changed**

- "Add BPM" is now "Add timing point", matching the rows it creates.
