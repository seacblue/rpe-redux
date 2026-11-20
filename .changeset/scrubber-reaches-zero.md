---
"rpe-redux": patch
---

### 中文

**修复**

- 修复了进度条向左无法拉伸到 0 的 Bug：指针现在按实际绘制的轨道换算，轨道最左端就是起点，不再残留一个像素对应的曲目时长，偏移也不会随曲目变长而变大。
- 修复了暂停时位置读数比实际位置多出约 52 毫秒的问题：显示提前量只在播放时生效，暂停时读数与播放头停在实际位置。

### English

**Fixes**

- Fixed the progress bar not reaching zero when dragged left: the pointer now maps to the painted track, so the track's left edge is the start instead of one pixel of song time, and the offset no longer grows with the song length.
- Fixed the paused position readout reporting about 52 ms past the held position: the display lead now applies only while the transport is moving, so a paused readout and playhead sit on the actual position.
