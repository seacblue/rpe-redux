---
"rpe-redux": patch
---

### 中文

**新增**

- 快捷键现在支持多个非装饰键同时按住，例如长按 `E` 再右键，或 `Ctrl+E+右键`。
- 鼠标左右中键、侧键与滚轮方向在快捷键提示中改用固定内联图标，不再受主题影响。

**改进**

- 快捷键冲突只在作用域可能同时生效时报告；编辑器和模态框、绘制表面等不重合的作用域不再误报。
- 冲突的快捷键键帽使用 urgent 边框与红色 inset 提示，并按具体按键而不是整条命令标记。

### English

**Added**

- Shortcuts can now hold several non-modifier keys together, such as holding `E` and right-clicking, or `Ctrl+E+right-click`.
- Mouse left/middle/right, side buttons, and wheel directions draw as fixed inline icons in shortcut chips instead of theme-dependent glyphs.

**Improved**

- Shortcut conflicts are reported only when their scopes can be active at the same time; disjoint scopes such as editor and modal, or editor and a drawn surface, no longer raise false conflicts.
- A conflicting key cap uses the urgent border and a red inset ring, and the editor marks the specific binding rather than every binding of the command.
