---
"rpe-redux": patch
---

### 中文

**修复**

- 播放过程中按 `J` 开关多线编辑、按 `K` 切换音符/事件模式现在会立即更新时间轴和检查器；此前这些改动会等到暂停播放后才显示。

**改进**

- 多线编辑的事件区顶部不再重复显示每个事件的类型列名，改为在每个判定线窗口顶部居中显示该线的编号与名称；音符分栏窗口同样居中显示编号与名称。

### English

**Fixes**

- Pressing `J` to toggle multi-line editing or `K` to switch its notes/events field during playback now updates the timeline and Inspector immediately; previously the change stayed invisible until playback paused.

**Improved**

- Multi-line event editing no longer repeats the event-type column names at the top of every window; each judge-line window now shows that line's number and name centered in its header. Split multi-line note windows show the same centered number and name.
