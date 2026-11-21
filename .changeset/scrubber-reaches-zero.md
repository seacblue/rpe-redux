---
"rpe-redux": patch
---

### 中文

**修复**

- 修复了进度条向左无法拉伸到 0 的 Bug：指针现在按实际绘制的轨道换算，轨道最左端就是起点，不再残留一个像素对应的曲目时长，偏移也不会随曲目变长而变大。
- 修复了暂停时跳转到开始仍会残留约 52 毫秒提前量的问题：显式跳转会释放画面前导，位置读数与播放头停在跳转目标。

### English

**Fixes**

- Fixed the progress bar not reaching zero when dragged left: the pointer now maps to the painted track, so the track's left edge is the start instead of one pixel of song time, and the offset no longer grows with the song length.
- Fixed a paused seek reporting the display lead: an explicit seek now releases the picture lead, so a seek to the start reports exactly zero.
