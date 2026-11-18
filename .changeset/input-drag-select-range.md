---
"rpe-redux": patch
---

### 中文

**修复**

- 数字输入框的全选改为在松开鼠标时判定：原地点击仍然全选整个数值，按住拖选一部分文本时保留拖出的选区。
- 离开数字输入框时会清除浏览器记住的全选状态，再次进入时不会在按下的瞬间就全选。
- `Shift` + 点击不再被全选覆盖，扩展选区按原生行为生效。

### English

**Fixes**

- A numeric field now decides select-all when the button is released: an in-place click still selects the whole value, while dragging over part of it keeps the range the drag drew.
- Leaving a numeric field clears the full selection the browser remembers, so returning to it no longer selects everything on the press.
- A `Shift`-click extends the selection natively instead of being replaced by select-all.
