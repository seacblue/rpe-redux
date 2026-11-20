---
"rpe-redux": patch
---

### 中文

**修复**

- 现在在多线编辑下，文本不会压缩，检测到标题为“Untitled”时自动不显示标题。
- 标题过长时截断并以 `...` 结尾；音符与事件字段统一显示标题条。
- 事件数值和其他数字标签空间不足时逐个去掉小数位，整数仍放不下则保持原宽并允许重叠。

### English

**Fixes**

- In multi-line editing, text is no longer compressed, and a line title detected as "Untitled" is hidden automatically.
- An overlong title is truncated with `...`; note and event fields share the same header band.
- Event values and other numeric labels remove decimal places one by one, and keep their full width when the integer still does not fit.
