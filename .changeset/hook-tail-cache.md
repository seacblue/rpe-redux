---
"rpe-redux": minor
---

### 中文

**新增**

- 现在取消钩定时的事件尾部将会还原。勾选“首尾同步”（钩定）后事件仍按 10-10 渲染，但被替换的尾值会缓存下来；再次取消钩定即还原为 10-20。钩定期间只改起始值时，缓存的尾值不跟随，取消后得到“新起始值-原尾值”。导出文件仍写入 10-10，本编辑器重新打开时恢复缓存的尾值。

### English

**Added**

- Unhooking an event now restores its tail value. A hooked event still renders 10-10, but the replaced tail is cached and unhooking restores 10-20. Moving only the head while hooked leaves the cached tail alone, so unhooking yields the new head with the original tail. Exported files still carry 10-10, and reopening them in this editor restores the cached tail.
