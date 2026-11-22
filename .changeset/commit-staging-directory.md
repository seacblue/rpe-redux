---
"rpe-redux": patch
---

### 中文

**修复**

- 修复了导入谱面时提示「本地素材库无法完成此请求」的问题：流式提交的暂存目录改在谱面库旁边创建，不再依赖系统临时目录的写权限；系统临时目录仍作为回退。
- 提交会话创建失败时会把被拒绝的目录写入后端日志，不再只留下一个空白的 500。

### English

**Fixes**

- Fixed chart imports failing with "the local library could not complete the request": streamed commit staging now lives beside the chart library instead of depending on write access to the system temp directory, which remains the fallback.
- A rejected staging directory is written to the backend log when a commit session cannot start, instead of surfacing as an empty 500.
