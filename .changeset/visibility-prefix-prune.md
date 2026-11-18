---
"rpe-redux": patch
---

### 中文

**改进**

- 优化预览区每帧的可见音符查询：判定线音符的空间索引增加前缀包络剪枝，典型谱面下查询耗时降低约 31%，完整可见性计算降低约 26%；密集谱面下分别降低约 30% 和 24%。查询结果与原有实现逐项一致。

### English

**Improvements**

- Optimize the preview's per-frame visible-note query: the judge-line spatial index now prunes with prefix envelopes, reducing the query itself by about 31% and the full visibility pass by about 26% on a typical chart, and by about 30% and 24% on a dense chart. Results are identical to the previous implementation.
