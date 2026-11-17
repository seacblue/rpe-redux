---
"rpe-redux": patch
---

### 中文

**修复**

- 修复自由视角下预览白框不跟随缩放/偏移且溢出编辑器的问题；白框现在跟随相机投影并裁剪在预览视口内，白框外的物件和判定线仍可显示。
- 移除自由视角下铺满舞台的静态灰底，框外直接显示编辑器底色。
- 修复自由视角缩放或调整预览大小时打击粒子、命中特效脱离音符位置的问题；粒子扩散距离和尺寸现在随相机缩放。
- 修复曲线轨迹生成的白框在预览内被遮挡、只在预览外显示的问题；曲线编辑层恢复到预览之上，并移除曲线自己绘制的更亮白框，改用统一的预览白框。

### English

**Fixes**

- Fix the free-camera chart frame not following zoom/pan and spilling outside the editor; the frame now follows the camera projection and is clipped to the preview viewport while objects and judge lines beyond the frame remain visible.
- Remove the stage-wide static grey backdrop in free camera so the editor base shows outside the projected frame.
- Fix hit particles and hit effects drifting away from notes when the free-camera zoom or preview size changes; burst travel and size now scale with the camera.
- Fix the curve trajectory frame being hidden inside the preview and only visible outside it; the curve editing layer now sits above the preview, and the curve's brighter duplicate frame is removed in favor of the shared preview frame.
