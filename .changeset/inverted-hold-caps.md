---
"rpe-redux": patch
---

### 中文

**修复**

- 预览按 Phira 的方式绘制负数长度的长条：头尾顺序正常、但音符或判定线速度为负时，只画头部和尾部两个端点，不绘制反向的本体，两个端点也保持原本的正立朝向，不再跟随反向跨度翻转。

### English

**Fixes**

- Preview renders negative-length Holds the way Phira does: when the head still precedes the tail in time but the note or line speed is negative, only the head and tail caps are painted. The reversed body is skipped and both caps keep their upright orientation instead of following the reversed span.
