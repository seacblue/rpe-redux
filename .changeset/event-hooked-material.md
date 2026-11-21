---
"rpe-redux": patch
---

### 中文

**修复**

- 事件时间线现在用钩定事件颜色绘制钩定事件条，钩定事件不再和普通事件使用同一种材质。
- 首尾拍相同的事件不再被接受：放置、编辑、时间线渲染和谱面问题面板都把零长度区间视为非法，钩定事件也不例外。

**新增**

- 外观设置新增「钩定事件颜色」，默认取主题的钩定颜色，可自行调整。

### English

**Fixes**

- The event timeline now paints hooked event bars in the hooked-event colour instead of sharing the ordinary event material.
- An event whose start and end beat are identical is no longer accepted: placement, edits, timeline rendering, and the chart issues panel all treat an empty span as invalid, including hooked events.

**Added**

- Appearance settings gain a "Hooked event colour" row; it starts at the theme's hooked colour and can be changed.
