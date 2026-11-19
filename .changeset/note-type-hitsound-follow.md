---
"rpe-redux": patch
---

### 中文

**修复**

- 在音符检查器中修改音符类型后，打击音效立即跟随新类型：没有自定义音效的音符会按新类型显示并播放内置打击音，已写入的内置音效名会被清除，自定义音效文件保持不变。类型下拉框的顺序同时调整为 Tap、Drag、Flick、Hold。
- 修复暂停后修改或放置播放头附近的音符、再继续播放时该音符不发声的问题：编辑重建触发表时，调度游标会重新锚定到暂停时的播放位置，被中断的预读音效会重新排队。

### English

**Fixes**

- Changing a note's type in the note inspector now updates its hit sound immediately: a note without a custom sound shows and plays the built-in sound for the new type, a stale built-in sound name is removed, and a custom sound file stays attached. The type dropdown now lists Tap, Drag, Flick, Hold in that order.
- Editing or placing a note near the playhead while paused no longer leaves it silent when playback resumes: an edit rebuild re-anchors the scheduler cursor to the position where playback stopped and queues the interrupted look-ahead again.
