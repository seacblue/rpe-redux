---
"rpe-redux": patch
---

### 中文

**新增**

- 多事件编辑新增“编辑 / 克隆”切换与克隆页：按线号序列复制选中事件，支持时间增量、X/Y/旋转/透明/速度/缩放 X/缩放 Y 七个通道的上下缓扰与周期数列、保留源、结果虚影与参数历史。通道区只显示当前选中事件中实际存在的类型；线号序列保留重复项，可在同一条线上叠加多次克隆。
- 结果虚影使用事件皮肤和整条事件链的缓动曲线；关闭保留源时只在虚影预览开启期间隐藏源事件，关闭预览立即恢复。虚影只存在于时间轴画布，不进入预览或实际谱面的计算与执行。

### English

**Added**

- Added an Edit/Clone switch and a clone page to multi-event editing: copy selected events onto a target line sequence with a time increment, per-channel lower/upper/easing/disturbance and cycle sequences for X, Y, rotation, opacity, speed, scale X, and scale Y, keep-source, result ghosts, and parameter history. The channel rows only show track types present in the current selection, and repeated target lines stay separate copies so one line can receive several clones.
- Result ghosts use the event skin and each event chain's easing curve. With keep-source off, source events are hidden only while the ghost preview is on; turning it off restores them immediately. Ghosts stay on the timeline canvas and never enter the preview stage or the live chart's calculation and execution.
