---
"rpe-redux": patch
---

### 中文

**修复**

- 修复多线编辑退出重进后横向滚动位置跳回最左侧的问题：返回时恢复原来显示的面板，并按当前选中判定线数量夹取；切换音符/事件模式也不再丢失位置。
- 修复多线编辑下剪贴板粘贴预览只显示一条轨道的问题：现在每条被粘贴的轨道都在自己的面板上预览；多线编辑下的粘贴只写入当前可见的判定线，预览与结果一致。

### English

**Fixes**

- Fixed the multi-line horizontal position jumping back to the left after leaving and re-entering multi-line editing: the previous panels are restored and clamped to the current line selection, and switching the visible field no longer discards it.
- Fixed the clipboard paste preview showing only one track in multi-line editing: every pasted track now previews on its own panel, and a multi-line paste writes only the tracks the field shows, so the preview matches the result.
