---
"rpe-redux": patch
---

### 中文

**修复**

- 修复了缓动预览在缓动左边界大于右边界时不绘制截取后曲线的问题：预览现在与时间轴曲线使用同一套归一化采样，边界反转时也会绘制实际播放的截取段，而不再回退到未截取的完整曲线。
- 修复了缓动预览与 Bézier 画布观感不一致的问题：两者的框、主题取色、框外淡出与坐标映射现在由同一套共享绘制器 `easingCanvas.ts` 提供，共用同一个绘图区，切换模式不再出现框高、背景或曲线粗细不一致。
- 修复了缓动预览横轴不是线性的问题：横轴改为按进度 0–1 线性铺开、纵轴表示缓动输出，缓动左/右边界现在固定落在对应比例的位置（如 0.18 就在 18% 宽度处），不再随所选缓动曲线而漂移。
- 修复了缓动预览高亮切面方向错误的问题：截取区间改为垂直切面，只把左右边界之间的那一竖条曲线画成不透明，边界之外仍为半透明。
- 调整了缓动预览的边界竖线配色：左边界与右边界各自使用独立的主题色，两线交叉时仍能分辨是哪一侧。
- 修复了 Bézier 编辑区上下多出空隙的问题：它不再覆盖缓动预览的间距，切换模式时下方控件不再跳动。
- 为 Bézier 编辑区补上 y = -1 与 y = +1 两条水平参考线；只有控制点真正超出该范围时才显示，未超出时框边本身就是边界。
- 修复了拖动缓动左/右边界滑块时预览卡顿与闪烁的问题：拖动过程只更新本地草稿并即时重绘预览，松手时才提交一次事件编辑；草稿保留到事件值追上，切值不再回弹。

### English

**Fixes**

- Fixed the easing preview dropping the cut curve when the left bound is greater than the right bound: the preview now samples the same normalized segment as the timeline curve, so a reversed range draws the segment the animation actually plays instead of falling back to the uncut curve.
- Fixed the easing preview and the Bézier editor looking inconsistent: both now paint through one shared painter in `easingCanvas.ts` for the frame, theme colours, overshoot fade, and coordinate mapping, so switching modes no longer changes the plot height, background, or curve weight.
- Fixed the easing preview's horizontal axis not being linear: progress now runs left to right across the frame and the curve's output sets the height, so the easing bounds sit at their own share of the width (0.18 is at 18%) instead of drifting with the selected curve.
- Fixed the easing preview highlighting the wrong dimension: the cut is now a vertical slice, so only the strip of curve between the bounds is opaque and everything outside it stays translucent.
- Changed the easing preview's bound guides to use distinct theme inks, so the left and right bounds stay distinguishable where they cross.
- Fixed the Bézier editor carrying extra vertical gap: it no longer overrides the easing preview's spacing, so switching modes keeps the rows below the plot in place.
- Added the `y = -1` and `y = +1` reference lines to the Bézier editor; a line only appears once a control point actually leaves that range, because inside it the frame edges are the limits.
- Fixed the easing preview stuttering and flashing while a range slider is dragged: the drag now updates a local draft and repaints the preview immediately, one event edit commits when the gesture ends, and the draft survives until the stored value catches up so the value never snaps back.
