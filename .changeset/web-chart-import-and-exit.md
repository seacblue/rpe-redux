---
"rpe-redux": patch
---

### 中文

**修复**

- 修复了网页端“载入谱面”只提示需要桌面版的问题：欢迎页和编辑器现在可以选择 JSON、PEZ 或 ZIP 谱面，解析后写入浏览器谱面库，归档内的多张谱面会逐个导入。
- 修复了浏览器谱面库新建项目时的 SQLite 错误（插入语句少一个字段值），该错误同时导致网页端保存失败、保存后无法返回谱面库或退出。
- 修复了浏览器谱面库中的项目无法打开的问题：不支持分帧读取的宿主现在直接读取整份谱面。
- 保存并返回、保存并退出现在以保存结果为准，保存完成后一定会离开编辑器，不会被滞后的未保存标记拦住。

### English

**Fixes**

- Fixed the web "import chart" action only reporting that desktop is required: the welcome page and editor can now pick JSON, PEZ, or ZIP charts, parse them, and write them into the browser library, importing every chart an archive contains.
- Fixed a SQLite error when the browser library created a project (the insert supplied one value fewer than its columns), which also made web saves fail and blocked returning to the library or quitting after a save.
- Fixed browser-library projects failing to open: hosts without the framed chart stream now read the whole project directly.
- Save and return / save and quit now follow the save result, so a completed save always leaves the editor instead of being held back by a lagging dirty flag.
