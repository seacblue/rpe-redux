# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.8 (2026-11-10)

### 中文

**新功能**

- Hello, GitHub Pages!
- 多线编辑部分新增对于 X、Y、Rotate、Alpha、Speed 轨道的隐藏功能。这是一项与 RPE 的功能对齐。
- 按下 Esc 键可以取消仍未放置终点的 Hold 与事件操作。另一项我常用的功能对齐。
- 改进了自动测量 BPM 与偏移值的功能，并且新增了“BPM 翻倍”“BPM 减半”“偏移值提前一拍”“偏移值延后一拍”的快捷按键。
- Shader 现在会在选择之后进入预编译，减少预览播放时的卡顿。
- 新增快捷键“时间轴快退（一整个节拍）”“时间轴快进（一整个节拍）”，默认 Shift + WheelUp / Down。我们知道有的用户想要将它们与时间轴缩放进行交换……
- 新增快捷键“清空剪贴板”，默认 Ctrl + Shift + Delete。
- 新增快捷键“应用采样草稿”“跳转到剪贴板开头”“跳转到剪贴板末尾”。
- 新增设置项“撤销/重做时自动跳转”，撤销或重做后，把播放头/视图自动跳到被改动的位置。
- 新增设置项“选中事件颜色”“协作选中音符颜色”“协作选中事件颜色”。
- 新增自动保存设置项。
- 新增光标渐显设置项，上一次放置的音符或事件，与鼠标附近的横线与竖线会显示，而其他的不显示。<建议来源：大只黄毛狗狗>
- 为 Code Cell 提供截图功能，可以根据时间或拍数获取到对应谱面的截图。<建议来源：大只黄毛狗狗>
- 时间轴左右的概览条现在会显示剪贴板与粘贴的区域了。新增设置项“在概览条显示剪贴板与粘贴范围”。
- 可以通过左上角的 Logo 快速退回到谱面库了，我觉得可能有人还不知道我们可以退回到谱面库……
- 可以通过欢迎界面右上角的协作按钮，快速加入到其他用户开启的房间。
- 加入 gzip 压缩策略并已默认在数据库保存、联机协作启用。
- 加入 HTTP 传输与分块逻辑，由于性能原因暂时不启用。
- 谱面新增只读模式。
- 右下角新增“Bug 反馈”按钮，请大家多多宣传 RPE Redux（可怜）。

**联机协作**

- 创建房间会弹出过程模态框，且用户在完整获取到谱面包之前不会进入谱面。
- 对于除房主之外的成员，谱面将不会保存到本地谱面库。
- 删除协作 protocolVersion 握手和全部协议版本规则，能否进入房间只取决于与房主的版本是否一致。
- 其他成员的播放头从进度条上方移动至下方。
- 允许任意成员上传与修改资源文件。
- 通过 rperedux:// 协议进入房间时，支持调整用户名和光标颜色。
- 除房主之外的成员掉线时，重新加入会出现恢复提示且支持自动恢复。
- 新增共享选中功能。
- 现在在用户拥有与房间素材 hash 相同的文件时，会复用本地的文件。
- 协作场景下的冲突与锁提示得到优化。

**改进**

- 谱面的渲染、修改与保存现在采用流式模式。打开谱面时的 JSON 解析时长可降低至 50 ~ 100 ms。
- 对数据库存储规范进行大规模优化。
- 现在在非桌面应用情况下，右上角的最小化、最大化与关闭按钮将会隐藏。
- 谱面数据库实现增量更新，减少磁盘占用与复制开销。
- 下载更新时，与更新相关的按钮都会失效。
- 下载完成的更新包会缓存在本地，不再重复下载。
- 后端会分析拖入的文件为谱面、皮肤包或插件包。
- 改进了 Shader 轨道的渲染，我们将会在之后的大更新中重新优化故事板设计。
- 音符时间轴与事件时间轴的框选颜色现在已经统一。
- 删除了事件选择时的边框。
- 删除了大部分开发者选项。新增“启用音符边框”“导出诊断包”与“一键复制摘要”开发者选项。
- 优化了关闭应用时的提示框逻辑。
- 谱面被占用时的提示文案更加清晰易懂。
- 大谱面的保存不会阻塞 UI。
- 因为 Esc 太通用，所以我们不会提供 Esc 的改键了，桀桀桀。
- 移除了相当多的无用文案。

**代码质量**

- 现在可以方便地启动浏览器调试功能，而无需重复构建应用。
- 修改 AGENTS.md 以适应新的解决需求流程。
- 现在可以在启动时指定 --collab-port 实例端口与 LAN/隧道房间端口。
- 更新了部分依赖包。

**修复**

- 修复了因为长条距离计算错误而导致的渲染 Bug。
- 修复了协作写谱无法正常创建房间的 Bug。
- 修复了底部红线层级在音符与事件之上的 Bug。
- 修复了 RPE 元数据语义 background 与 illustration 混淆的 Bug。
- 修复了一些下拉框或展开菜单的行为 Bug。

### English

**Features**

- Hello, GitHub Pages!
- Multi-line editing now supports hiding the X, Y, Rotate, Alpha, and Speed tracks. This is another RPE parity feature.
- Pressing Esc now cancels an in-progress Hold or event before its endpoint is placed. Another feature alignment I use often.
- Improved automatic BPM and offset detection, and added shortcuts for "Double BPM", "Halve BPM", "Move offset one beat earlier", and "Move offset one beat later".
- Shaders now begin precompiling after selection, reducing stutter during preview playback.
- Added "Rewind timeline (one full beat)" and "Advance timeline (one full beat)" shortcuts, defaulting to Shift + WheelUp / Down. We know some users want to swap them with timeline zoom...
- Added a "Clear clipboard" shortcut, defaulting to Ctrl + Shift + Delete.
- Added shortcuts for "Apply sampling draft", "Jump to clipboard start", and "Jump to clipboard end".
- Added the "Jump to the changed time after undo or redo" setting. After an undo or redo, the playhead and view move to the edited position automatically.
- Added the "Selected event colour", "Collaboration selected note colour", and "Collaboration selected event colour" settings.
- Added autosave settings.
- Added a cursor fade-in setting: the most recently placed note or event, plus the horizontal and vertical lines near the pointer, are shown while everything else is hidden.<suggested by 大只黄毛狗狗>
- Code Cell can now capture chart screenshots by time or beat.<suggested by 大只黄毛狗狗>
- The overview bars on both sides of the timeline now show the clipboard and paste ranges. Added the "Show clipboard and paste ranges on overview bars" setting.
- The top-left logo can now return to the chart library quickly. I suspect some people still don't know we can go back to the library...
- The collaboration button in the top-right corner of the welcome screen can now quickly join rooms opened by other users.
- Added gzip compression, enabled by default for database saves and collaboration.
- Added HTTP transport and chunking, currently disabled for performance reasons.
- Added a read-only mode for charts.
- Added a "Bug report" button in the bottom-right corner. Please help spread the word about RPE Redux (poor us).

**Collaboration**

- Creating a room now shows a progress modal, and the user does not enter the chart until the full chart bundle has been received.
- For members other than the host, the chart is no longer saved to the local chart library.
- Removed the collaboration protocolVersion handshake and all protocol version rules. Admission now depends only on matching the host's version.
- Other members' playheads have moved from above the progress bar to below it.
- Any member can now upload and modify asset files.
- Joining a room through the rperedux:// protocol now supports adjusting the username and cursor colour.
- When a non-host member disconnects, rejoining shows a recovery prompt and supports automatic recovery.
- Added shared selection.
- Local files with the same hash as a room asset are now reused.
- Improved conflict and lock messages in collaboration.

**Improvements**

- Chart rendering, editing, and saving now use a streaming mode. JSON parsing time when opening a chart can drop to 50 ~ 100 ms.
- Large-scale optimization of database storage conventions.
- The minimize, maximize, and close buttons in the top-right corner are now hidden outside the desktop app.
- Chart database updates are now incremental, reducing disk usage and copy overhead.
- Update-related buttons are disabled while an update downloads.
- Downloaded update packages are cached locally and are no longer downloaded repeatedly.
- The backend now classifies dropped files as charts, skin packs, or extension packages.
- Improved Shader track rendering. We will reoptimize the storyboard design in a later major update.
- Note and event timeline marquee colours are now unified.
- Removed the border on event selection.
- Removed most developer options. Added the "Enable note borders", "Export diagnostic bundle", and "Copy summary" developer options.
- Improved the close-app prompt logic.
- Occupied-chart messages are clearer and easier to understand.
- Saving large charts no longer blocks the UI.
- Because Esc is too ubiquitous, we will not offer rebinding for Esc. Mwahaha.
- Removed quite a lot of useless copy.

**Code quality**

- Browser debugging can now be started easily without rebuilding the app repeatedly.
- Updated AGENTS.md for the new request-resolution workflow.
- The --collab-port instance port and the LAN/tunnel room port can now be specified at startup.
- Updated some dependencies.

**Fixes**

- Fixed a rendering bug caused by incorrect hold distance calculations.
- Fixed a bug where collaboration chart editing could not create a room.
- Fixed the bottom red line layer appearing above notes and events.
- Fixed confusion between the RPE metadata semantics of background and illustration.
- Fixed behaviour bugs in some dropdowns and expanded menus.
