---
"rpe-redux": patch
---

### 中文

**修复**

- 修复旧版 RPE 快捷键导入后，`Ctrl+滚轮向上` 无法递增判定线、只有 `Ctrl+滚轮向下` 仍能递减的问题。
- 编辑器现在会在首次启动时补回迁移命令丢失的滚轮手势，并把旧版本“重置快捷键”写入的旧滚轮方向更新为当前默认值。

### English

**Fixed**

- Fix `Ctrl+Wheel Up` no longer increasing the judge line after an older RPE hotkey import, which left only `Ctrl+Wheel Down` decreasing it.
- The editor now restores the wheel gesture a migrated command lost on the first launch, and updates the old wheel directions a previous Reset wrote to the current defaults.
