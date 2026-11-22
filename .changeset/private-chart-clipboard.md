---
"rpe-redux": patch
---

### 中文

**新增**

- 跨谱面复制粘贴现在使用应用内剪贴板，不占用系统文本剪贴板；重启应用后也会恢复当前剪贴板内容。
- 时间轴中的剪贴板虚影预览使用当前 note/event 皮肤并以半透明方式显示，默认开启。
- 从其他实例或外部来源获取剪贴板内容时显示提示，并以 10 秒为间隔限流。

### English

**Added**

- Cross-chart copy and paste now uses the app-private clipboard instead of the operating system text clipboard, and restores the current contents after restart.
- The timeline clipboard ghost preview uses the active note and event skins with translucent alpha and is enabled by default.
- Receiving clipboard contents from another instance or external source shows a rate-limited notice.
