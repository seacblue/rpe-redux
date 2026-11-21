---
"rpe-redux": patch
---

### 中文

**修复**

- 禁止应用在更新或崩溃重启后自动打开谱面：重启、崩溃恢复、更新重启和刷新页面现在都停在谱面库，不再恢复上一次打开的谱面，相关设置项一并移除。命令行传入的谱面文件、文件关联、`rperedux://chart/<id>` 链接和显式谱面地址仍然会直接打开对应的谱面。

### English

**Fixes**

- The application no longer reopens a chart after an update or a crash restart: a restart, crash recovery, an update restart, and a page reload now all stop at the chart library instead of restoring the previous chart, and the related setting was removed. A chart passed on the command line, through the file association, a `rperedux://chart/<id>` link, or an explicit chart address still opens that chart.
