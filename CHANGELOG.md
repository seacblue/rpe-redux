# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use inline annotations: `@name` credits a GitHub user (rendered bold and underlined), `<red>text</red>` colours a run of text, and backticks render inline code. Triple-backtick fences render multiline code blocks with an optional language label; code content is shown literally. The colour tag name may be `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown colour tag, so the release page still reads as plain words.

Contributor credits are generated from the Changesets. A Changeset names them in a language-neutral `### Contributors` block, and one without that block credits the human author of the pull request that added it; bots, maintainers, and logins the note already names are left out. The release closes the change's last bullet with the names and ends each language section with a contributor category (`贡献者` / `Contributors`).

## 1.0.18

### 中文

**改进**

- 发布构建会自动使用 FFmpeg 和 Cloudflare Tunnel 的最新稳定资源，本地测试不再要求下载或锁定这些工具版本。
- 增加判定线状态快捷键，默认 `Tab`。
- 优化开发文档界面、导航层级与语言下拉菜单。
- 优化撤回与资源缺失时的 Toast 提示逻辑。

**调整**

- 调整判定线选择逻辑，使单击、Ctrl/Cmd、多选范围和框选行为保持一致。

**新增**

- 新增“切换横向网格”“切换纵向网格”按钮与快捷键。
- 在多线编辑界面支持使用 `Ctrl+Shift+鼠标滚轮` 横向滚动当前面板。
- 新增分层着色器渲染 API。
- 将 GitHub Star 提醒改为每打开程序 10 次弹出一次，并移除定时反馈 Bug 提醒。

**修复**

- 修复内置 `ToHold` 扩展使用数字转换处理拍三元组，导致 Hold 转换失败的问题；同时为扩展 SDK 增加精确的拍三元组加减法接口。
- 修复网页版无法导入 RPE 类型谱面的 Bug。
- 修复一些会让界面变丑的 UI 设计问题。
- 修复判定线在相同角度且接近合并距离移动时，判定线编号在分离与合并之间频繁切换的问题。
- 修复连续 Shift 选择判定线时范围起点不断变化的问题：保留首条判定线作为范围起点，并让每次点击的判定线成为当前焦点。
- 修复非 3:2 画面比例下，倾斜判定线上的音符落点与判定线不一致的问题。
- 修复拖动音符时按下 T 或 U 会让播放头持续漂移并带动音符位置偏移的问题；修复谱面重新打开后播放头错误保留关闭前位置的问题。
- 优化快捷键记录和匹配，区分主键区数字键与小键盘数字键，并将带前缀的数字输入改为可扩展的通用 token 序列。
- 修复桌面端用空格形式传入端口参数（如 `--backend-port 48121`）时直接崩溃的问题；现在 `--flag value` 和 `--flag=value` 两种写法都能启动第二个副本。
- 修复多线编辑合并音符视图下无法单击选中非当前判定线音符的问题：合并面板里的单击现在会命中所有选中判定线。
- 修复多线编辑下框选事件时只选中当前屏幕内事件的问题：框选现在按完整拍范围查询每条可见轨道，屏幕外的事件不再被丢弃。
- 修复多线编辑退出重进后横向滚动位置跳回最左侧的问题，并在返回时恢复面板、按当前选中判定线数量夹取位置；切换音符/事件模式也不再丢失位置。
- 修复多线编辑下剪贴板粘贴预览只显示一条轨道的问题：现在每条被粘贴的轨道都在自己的面板上预览，粘贴结果与预览一致。
- 移除应用内剪贴板历史，谱面选区改用兼容 RPE 的 notes/events JSON 系统剪贴板，并支持跨谱面实时同步；启动时首次读取保持静默。
- 将音符 Alpha 透明度编辑控件改为数值输入框，支持精确输入。
- 修复从素材库导入音频时被错误写入谱面音轨、导致导出 JSON 缺少正确音频索引的问题；修复保存素材库导入内容后仍被判定为存在未保存修改的问题。
- 修复点击谱面错误定位时 note 与 event timeline 被错误收缩的问题。
- 修复全局同屏音符过多提示错误显示判定线的问题。

**贡献者**

- @MatrixBlanchet

### English

**Improvements**

- Release builds now resolve the latest stable FFmpeg and Cloudflare Tunnel assets, while local testing no longer requires downloading or pinning those tools.
- Add a judge-line status shortcut, bound to `Tab` by default.
- Improve the developer documentation interface, navigation hierarchy, and language dropdown.
- Improve toast behavior for undo actions and missing resources.

**Adjustments**

- Adjust judge-line selection logic so plain, Ctrl/Cmd, range, and marquee selection stay consistent.

**Added**

- Add toolbar buttons and keyboard shortcuts for toggling the horizontal and vertical grids.
- Support horizontal scrolling of the active multi-line panels with `Ctrl+Shift+mouse wheel`.
- Add a layered shader rendering API.
- Show the GitHub Star reminder every ten application launches and remove the timed bug-feedback prompt.

**Fixes**

- Fix the built-in `ToHold` Extension failing when converting exact beat triples through numeric coercion, and add exact beat-triple arithmetic helpers to the Extension SDK.
- Fix web imports failing to create a task for RPE charts.
- Fix several UI design issues that made the interface look inconsistent.
- Fix judge-line numbers flickering between separate and merged labels when similarly angled lines move near the merge distance.
- Fix repeated Shift selection in judge-line lists by keeping the first line as the range origin and moving focus to each clicked line.
- Fix notes landing off tilted judge lines at non-3:2 preview aspect ratios.
- Fix T or U auditions pulling the playhead and shifting a note during an active drag, and fix charts reopening with the playhead left at the position from the previous session.
- Keep top-row and numpad digit keys distinct when recording and matching shortcuts, and refactor prefixed digit input into an extensible generic token sequence.
- Fix the desktop app crashing when a port argument used the spaced form (for example `--backend-port 48121`): both `--flag value` and `--flag=value` now start a second copy.
- Fix single-click selection of notes on a judge line other than the active one in the merged multi-line note view: a click in the merged panel now hits every selected line.
- Fix multi-line event marquee selection only taking the events currently on screen: the marquee now queries every visible track over the whole dragged beat range, so events outside the viewport are no longer dropped.
- Fix the multi-line horizontal position jumping back to the left after leaving and re-entering multi-line editing: the previous panels are restored and clamped to the current line selection, and switching the visible field no longer discards it.
- Fix the clipboard paste preview showing only one track in multi-line editing: every pasted track now previews on its own panel, and the paste result matches the preview.
- Replace the app-private clipboard history with RPE-compatible notes/events JSON in the system clipboard, including live cross-chart syncing with a silent initial read.
- Replace the note Alpha slider with a numeric input for precise editing.
- Fix asset-library audio being inferred as the chart song and missing the correct audio index in exported JSON, and fix asset-library imports remaining marked as unsaved after the chart is saved.
- Fix chart-issue navigation collapsing a note-and-event timeline layout.
- Fix global on-screen note-density warnings showing a judge line.

**Contributors**

- @MatrixBlanchet
