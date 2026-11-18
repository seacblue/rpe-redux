---
"rpe-redux": patch
---

### 中文

**修复**

- 数字输入框在聚焦后直接点击仍会全选整个数值；在框内拖选一部分文本时不再触发全选，保留拖选出的选区。
- `Shift` + 点击不再被全选覆盖，扩展选区按原生行为生效。

### English

**Fixes**

- A numeric field still selects its whole value on a plain click after focus, but dragging over part of the value no longer triggers select-all; the range the drag drew is kept.
- A `Shift`-click extends the selection natively instead of being replaced by select-all.
