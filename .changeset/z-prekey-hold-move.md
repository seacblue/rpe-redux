---
"rpe-redux": patch
---

### 中文

**修复**

- 按住 `Z` 准备拖拽时不再触发左移/上一行，避免多线编辑中的 Hold 被键盘自动重复挪动；单击 `Z` 仍在松开时执行一次移动，按住到自动重复或按下鼠标都会取消这次待执行移动。
- `Z` 拖拽 Hold 头时，头边缘改为跟随鼠标所在行，不再按指针移动距离偏移。

### English

**Fixed**

- Holding `Z` to prepare a drag no longer triggers left-nudge/previous-line, preventing Holds in multi-line editing from moving under keyboard auto-repeat. A short `Z` tap still moves once on release; auto-repeat or a mouse press cancels that pending movement.
- A `Z` Hold-head drag now places the head on the pointer row instead of offsetting it by the pointer travel distance.
