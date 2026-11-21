---
"rpe-redux": patch
---

### 中文

**改进**

- 缓动预览不再在曲线框下方绘制首尾数值：横轴的含义已由「起始值」「结束值」字段表达，框内重复一遍只会挤占画面。
- 采样首尾值、粘合前一事件、切割事件、首尾交换四个事件操作按钮移到了「缓动 / Bezier」开关上方，选完事件即可先执行操作，再决定用哪种曲线。

### English

**Improvements**

- The easing preview no longer prints the start and end values below the plot: the start/end fields already name the axis, so repeating them inside the frame only crowded the drawing.
- The sampling, stick, cut, and swap event tool buttons now sit above the easing/Bezier switch, so an event can be acted on first and its curve chosen after.
