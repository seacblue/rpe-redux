---
"rpe-redux": patch
---

### 中文

**修复**

- 修复曲线轨迹编辑与采样借用自由视角后，把普通自由视角保存的视角覆盖掉的问题：普通自由视角的缩放与平移会保留在舞台上，借用自由视角的编辑界面在关闭时恢复进入前的视角。

### English

**Fixes**

- Fix the curve trajectory editor and sampling overwriting the free camera view saved by the standalone mode: the standalone zoom and pan stay on the stage, and a surface that borrows the camera restores the view it found when it closes.
