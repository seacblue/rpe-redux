---
"rpe-redux": patch
---

### 中文

**改进**

- 多线编辑的「同屏事件窗数量」改为「多线窗口宽度」：改用 0.01 到 1、0.01 分度的滑块，按比例缩放每个窗口的宽度；同屏显示的窗口数量由窗口宽度决定，不再受数量上限限制。默认值 0.5，此时同屏正好对齐 3.5 个窗口。音符与事件两种多线区域共用同一宽度，窗口间距也按宽度等比缩放。

### English

**Improvements**

- Replace the multi-line "same-screen event-window count" with "Multi-line window width": a 0.01 to 1 slider in 0.01 steps that scales each window's width, so the number of windows on screen follows from their size instead of a count cap. The default 0.5 aligns three and a half windows across the timeline. The note and event multi-line areas share the same width, and their gaps scale with it.
