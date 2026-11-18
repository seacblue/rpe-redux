---
"rpe-redux": patch
---

### 中文

**修复**

- 预览按 Phira 的方式绘制负数长度的长条：头尾顺序正常、但音符或判定线速度为负时，只画头部和尾部两个端点，不绘制反向的本体。两个端点固定锚在自己的位置、沿判定线自身的轴向向外摆放，既不跟随反向跨度翻转 UV，也不被镜像到另一侧。
- 负速度的长条不再整条消失。遮罩线（`isCover`）过去只比较尾端是否落到线后，判定线转负速度把尾端推到线下方就会裁掉整条。现在只有头尾两个端点都落到判定线后才隐藏，尾部穿过判定线后仍会显示，并随负速度从下方升回线上。本体是否绘制也按实时采样跨度判断，长条中途转为负速度时同样只画两个端点。

### English

**Fixes**

- Preview renders negative-length Holds the way Phira does: when the head still precedes the tail in time but the note or line speed is negative, only the head and tail caps are painted. Each cap stays anchored at its own Hold anchor and grows outward along the line's own axis, so the reversed span neither turns its UVs over nor mirrors it to the other side.
- A negative-speed Hold no longer disappears entirely. On a covering line (`isCover`) the old test compared only the tail against the line, so a tail pushed behind the line by a negative speed culled the whole Hold. A Hold is now hidden only once both of its anchors are behind the line, so a tail that has crossed the line stays visible while it climbs back toward it. Body painting also follows the sampled span, so a Hold that turns negative partway through paints only its two caps.
