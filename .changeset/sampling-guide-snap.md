---
"rpe-redux": patch
---

### 中文

**修复**

- 采样浮层不再被自由相机层遮挡，引导线与浮动缓动面板可以正常接收鼠标操作。
- 采样时高亮的辅助线现在直接决定吸附取值，两者始终一致；XY 轴按各自最近的辅助线独立吸附。
- 拖拽采样时辅助线保持高亮；已完成一次采样后可以直接在画布上重新拉线替换。
- 采样浮动面板改用指针捕获拖拽，移动更跟手，也不会被采样层的指针处理截断。
- 展开的检查器保持在浮层层级，不会落在工作区指针层下面。

### English

**Fixes**

- The sampler overlay is no longer covered by the free-camera pointer layer, so its guides and floating easing panel receive pointer input.
- A highlighted sampling guide now supplies the snapped value directly; XY axes snap independently to their nearest guide.
- Guides stay highlighted while dragging, and a completed sample can be replaced by drawing a new line directly on the canvas.
- The sampling panel drag now uses pointer capture, so it follows the pointer without being cut off by the sampler's own pointer handling.
- The expanded inspector stays on the floating rung instead of sitting below workspace pointer layers.
