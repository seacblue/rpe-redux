---
"rpe-redux": patch
---

### 中文

**修复**

- 修复从素材库导入音频时被错误写入谱面音轨、导致导出 JSON 缺少正确音频索引的问题。
- 修复保存素材库导入内容后仍被判定为存在未保存修改的问题。

### English

**Fixes**

- Fix asset-library audio being inferred as the chart song and missing the correct audio index in exported JSON.
- Fix asset-library imports remaining marked as unsaved after the chart is saved.
