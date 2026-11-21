---
"rpe-redux": minor
---

### 中文

**重构**

- 重构了谱面错误的分析逻辑。检查改为在后台 worker 中运行，编辑不再等待检查，连续编辑只触发一次；结果按判定线、层级、轨道与时钟时间定位，并按问题类型分开统计错误与警告。
- 检查类型各自可以关闭，关闭后的类型不再出现在筛选器中；新增「谱面问题」设置页集中管理总开关与同屏音符上限。

**新功能**

- 新增「同屏音符过多」的谱面错误项，估算同一时刻同屏的音符数，超过阈值时以黄色警告提示，不会计入侧栏的错误数量。

### English

**Refactor**

- Reworked how chart issues are analyzed. Checks now run in a background worker, so an edit never waits for a scan and a burst of edits costs one. Results locate by judge line, layer, track, and clock time, and errors are counted apart from warnings.
- Each issue kind can be turned off, a disabled kind leaves the filter entirely, and a new Chart issues settings page owns the master switch and the on-screen note limit.

**Features**

- Added a "too many notes on screen" chart issue: it estimates how many notes share the screen at once and reports a passage above the limit as a yellow warning, which stays out of the sidebar's error count.
