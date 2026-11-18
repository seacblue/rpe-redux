---
"rpe-redux": patch
---

### 中文

**修复**

- 预览按 Phira 的方式绘制负数长度的长条：头尾顺序正常、但音符或判定线速度为负时，只画头部和尾部两个端点，不绘制反向的本体。两个端点固定锚在自己的位置、沿判定线自身的轴向向外摆放，既不跟随反向跨度翻转 UV，也不被镜像到另一侧。

### English

**Fixes**

- Preview renders negative-length Holds the way Phira does: when the head still precedes the tail in time but the note or line speed is negative, only the head and tail caps are painted. Each cap stays anchored at its own Hold anchor and grows outward along the line's own axis, so the reversed span neither turns its UVs over nor mirrors it to the other side.
