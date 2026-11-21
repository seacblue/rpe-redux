---
"rpe-redux": patch
---

### 中文

**修复**

- 修复了播放时三个拖动器跟随时明显抖动的问题：拖动器原本只按界面文字的刷新节奏（每秒约 12 次）重算位置，而且用的是上一帧的滚动位置，因此在播放头平滑移动时它一格一格地跳。现在它随每一帧重新定位，与播放头使用同一帧的时间，并且直接写入合成层位移，不再触发 React 重渲染。

### English

**Fixes**

- Fixed the three drag handles visibly jittering while they follow playback: the handle group only repositioned at the HUD cadence (about 12 times a second) and used the previous frame's scroll position, so it stepped while the playhead moved smoothly. It now repositioned on every frame, against the same time the playhead uses for that frame, and writes a composited transform instead of committing a React render.
