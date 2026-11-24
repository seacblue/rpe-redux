---
"rpe-redux": patch
---

### 中文

**改进**

- 自动测量时同时运行两种定拍检测器，由共享证据评分自动选择最准的一个，并始终将结果作为单个固定 BPM 与 offset 应用到 BPMList。

### English

**Improvements**

- Run both fixed-tempo detectors for automatic timing, rank their shared evidence, and always apply the strongest single BPM and offset to BPMList.
