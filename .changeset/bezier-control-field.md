---
"rpe-redux": patch
---

### 中文

**修复**

- 修复了 Bezier 手柄无法在 Y 方向超出 `[0, 1]` 范围的 Bug：手柄可以越过单位框，曲轴实时跟随缩放以保证手柄可见。

**改进**

- 优化了 Bezier 输入框的使用逻辑：四个控制点合成一个输入框，可粘贴任意文本并取前四个数字，超出 `[0, 1]` 的 x 自动夹到边界；手柄悬停放大变色，拖动时另有颜色，两者都带过渡动画。

### English

**Fixes**

- Fixed Bezier handles being unable to leave the `[0, 1]` range in Y: a handle may now cross the unit box, and the value axis rescales live to keep it visible.

**Improvements**

- Improved the Bezier input: the four control points share one field that accepts pasted text and takes its first four numbers, with x values outside `[0, 1]` clamped to the edge. Handles grow and change colour on hover, use a second colour while dragging, and animate both.
