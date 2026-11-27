---
"rpe-redux": patch
---

### 中文

**修复**

- 修复桌面端用空格形式传入端口参数（如 `--backend-port 48121`）时直接崩溃的问题：现在 `--flag value` 和 `--flag=value` 两种写法都能启动第二个副本。

### English

**Fixes**

- Fixed the desktop app crashing when a port argument used the spaced form (for example `--backend-port 48121`): both `--flag value` and `--flag=value` now start a second copy.
