---
"rpe-redux": patch
---

### 中文

**修复**

- 事件时间线在分页谱面编辑后不再沿用旧的事件范围：曲线上下限和灰色数值标签会跟随新的开始/结束值刷新。
- 选中事件不再额外叠一层黑色数值标签；普通标签已经显示时只保留一套数值，避免和曲线范围不一致。
- 事件检查器在数值输入框聚焦时继续发布；缓动预览、同组字段和其他检查器内容不再停住，只保留当前输入框的草稿。
- Bezier 控制点用滚轮改值会立即写入谱面。

**变更**

- 事件数值输入改为按 Enter 或失焦提交，打字过程中不逐字改写谱面和预览；滚轮、方向键与加减按钮仍然立即提交。
- 缓动预览在曲线下方显示当前值域的上下限，数值改变后可直接看到边界变化。

### English

**Fixes**

- The event timeline no longer reuses the old lane range after a paged-document edit: curve bounds and the regular value labels now follow the new start and end values.
- A selected event no longer adds a second black value label over the regular one; the lane keeps one set of numbers that matches the curve range.
- The event inspector keeps publishing while a numeric field has focus, so the easing preview, sibling fields, and other inspector content no longer freeze; only the focused input keeps its draft.
- Wheel edits to Bézier control points now commit immediately.

**Changed**

- Numeric event values commit on Enter or blur instead of rewriting the chart and preview on every keystroke; the wheel, arrow keys, and step buttons still commit immediately.
- The easing preview prints the current value bounds under the curve, so a start or end change is visible at a glance.
