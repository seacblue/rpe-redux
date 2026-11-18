---
"rpe-redux": patch
---

### 中文

**修复**

- 音符/事件的批量调节手柄不再占据整组区域：只有三个控制球接收指针，球之间的间隙可以直接落到时间线上。
- 正在放置 Hold 或事件时批量调节手柄自动隐藏，完成放置的点击不会再被手柄拦截；鼠标经过手柄时，时间线光标仍跟随指针。
- 全局禁用浏览器默认的文本拖拽与中键自动滚动，输入框内的文本选择保持可用。

### English

**Fixes**

- Batch adjustment handles for notes and events no longer capture the whole group: only the three control balls accept pointer input, so clicks in the gaps reach the timeline.
- The handles hide while a Hold or event placement is pending, so the completing click is no longer intercepted; pointer movement over a handle keeps the timeline cursor current.
- The browser's native text drag and middle-click autoscroll are disabled globally while text selection inside inputs stays available.
