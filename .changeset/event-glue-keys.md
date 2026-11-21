---
"rpe-redux": patch
---

### 中文

**新增**

- 新增按 `G` 向后粘合事件：选中事件的结束值会取同一事件轨上下一事件的起始值，与 RPE 的粘合行为一致。事件检查器新增“粘合下一事件”按钮，执行同一命令。

**变更**

- `G` / `B` 不再上下移动事件。时间方向移动改用 `↑` / `↓`（换线仍为 `Alt+↑` / `Alt+↓`）；`B` 改为向前粘合，即把选中事件的起始值改为上一事件的结束值。

### English

**Added**

- Added backward event sticking on `G`: the selected event's end value takes the start value of the next event on the same track, matching RPE's stick command. The event inspector carries a "stick to the next event" button that runs the same command.

**Changed**

- `G` / `B` no longer move events in time. Time nudging stays on `↑` / `↓` (`Alt+↑` / `Alt+↓` still change the line), and `B` now sticks backward by writing the previous event's end value into the selected event's start.
