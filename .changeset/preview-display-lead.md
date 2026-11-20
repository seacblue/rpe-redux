---
"rpe-redux": patch
---

### 中文

**修复**

- 播放时声音比画面早约半帧到一帧的问题。画面在 `requestAnimationFrame` 里画完之后，还要经过合成、再等一次垂直同步才真正上屏，这段时间音频不会停下来等，于是听到的鼓点总比音符过判定线早一点。现在画面会按显示延迟提前绘制，让它在被看到的那一刻正好对上声音。
- 暂停后再播放时红线抖动。画面已经带上了显示延迟，而暂停时写入的时间轴锚点没带，两者相差一个提前量；现在两处使用同一个时间基准。
- 暂停后还会响一小段。停止只能阻止后续渲染，已经交给声卡的采样仍会播完；现在暂停时同时用 3 毫秒的渐变把主音量拉到零，把这段残留一起切掉。

**新增**

- 设置 → 播放 → 画面提前量（毫秒）。默认 0 表示使用内置校准值；不同显示器与合成路径的延迟不同，可按听感微调。

### English

**Fixed**

- The sound arrived about half a frame to a frame before the picture during playback. A frame painted inside `requestAnimationFrame` still has to be composited and presented at the next vertical blank, and the audio does not wait for that, so a drum hit was heard slightly before its note crossed the judgement line. The picture is now drawn ahead by that display delay, so it is correct at the moment it is seen.
- The playhead jittered when playback resumed after a pause. The picture already led by the display delay while the timeline anchor written on a pause did not, leaving the two one lead apart; both now use the same time basis.
- A short tail kept sounding after a pause. Stopping only prevents further rendering, so samples already handed to the device still played out; a pause now also ramps the master gain to zero over 3 ms, cutting that tail with it.

**Added**

- Settings → Playback → Picture lead (milliseconds). A value of 0 uses the built-in calibration; displays and compositors differ, so it can be adjusted by ear.
