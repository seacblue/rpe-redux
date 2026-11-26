---
"rpe-redux": patch
---

### 中文

**修复**

- 区分主键区数字键与小键盘数字键，快捷键记录和匹配不再混淆两者。
- 将带前缀的数字序列改为可扩展的通用 token 序列。

### English

**Fixes**

- Keep top-row and numpad digit keys distinct when recording and matching shortcuts.
- Refactor prefixed digit input into an extensible generic token sequence.
