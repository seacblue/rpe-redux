---
"rpe-redux": patch
---

### 中文

**修复**

- 打开谱面时，音乐在加载阶段完成解码，进入编辑器后即可播放；波形仍在后台生成，生成完成只重绘，不再改变播放头位置。

### English

**Fixes**

- Opening a chart decodes the music during the loading stage, so playback is available as soon as the editor opens; the waveform still builds in the background and only repaints when it finishes, without moving the playhead.
