---
"rpe-redux": patch
---

### 中文

**修复**

- 移除了加载谱面弹窗里的「已下载 … · …/s」一行。谱面通常从本地磁盘打开，那里的字节数其实是同一台机器读取自身的文件，标成下载并不成立；真正的网络传输仍由启动页展示。

### English

**Fixes**

- Removed the "Downloaded … · …/s" line from the chart-loading overlay. A chart usually opens from local disk, so those bytes describe the same machine reading its own files; the startup splash still reports real network transfer.
