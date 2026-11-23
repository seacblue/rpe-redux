---
"rpe-redux": patch
---

### 中文

**修复**

- 恢复并开放扩展脚本的 `chart.lines()`、`chart.notes()` 和 `chart.events()` 只读语法糖，避免官方内置插件因方法未注册而无法运行。

### English

**Fixes**

- Restore and register the read-only `chart.lines()`, `chart.notes()`, and `chart.events()` helpers so the official built-in Extension can run again.
