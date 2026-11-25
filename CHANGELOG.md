# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use inline annotations: `@name` credits a GitHub user (rendered bold and underlined), `<red>text</red>` colours a run of text, and backticks render inline code. Triple-backtick fences render multiline code blocks with an optional language label; code content is shown literally. The colour tag name may be `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown colour tag, so the release page still reads as plain words.

Contributor credits are generated from the Changesets. A Changeset names them in a language-neutral `### Contributors` block, and one without that block credits the human author of the pull request that added it; bots, maintainers, and logins the note already names are left out. The release closes the change's last bullet with the names and ends each language section with a contributor category (`贡献者` / `Contributors`).

## 1.0.17

### 中文

**改进**

- 替换默认皮肤，增加内置可选皮肤。感谢 ziyang_51571 与 MuYan 提供的素材！
- 更新日志支持代码行渲染，并且添加可点击的 GitHub 链接。
- 为剪贴板虚影预览增加透明度调节。
- 增加音符过近时合并选项，并将音符合并距离默认值调整为 50。
- 优化时间线标记管理界面。
- 欢迎界面优化：统一新建谱面与导入谱面的按钮视觉层级。
- 优化了左上角 Logo 的退出功能提示。
- 增强插件检查器界面与设置项。

**修复**

- 修复了 attachUI 与素材文件嵌套相关的 Bug。
- 修复 `MirrorY` 只镜像选中音符、无法处理选中事件的问题，并为其默认绑定 `A` 快捷键。
- 网页版和开发版本不再检查、提示或自动下载版本更新；网页右下角版本号追加浏览器本地时区的构建时间。
- 修复多线编辑时使用 Ctrl +滚轮切换判定线会按编号排序的问题，现在会按照选择框中填写的判定线顺序循环切换。
- 修复并发保存持久化 values 时可能覆盖其他实例数据的问题。
- 修复应用在最大化状态下关闭后，再次打开恢复为普通窗口的问题。
- 修复了“事件属性”选项卡中，“1-3层”与“扩展事件”选项无效的问题。
- 修复了放置事件时钩定状态错误的问题。
- 判定线输入框支持对 `all` 的解析。
- 修复了选中区域未及时更新的问题，修复了框选时的渲染问题。
- 修复事件和音符多选虚影的刷新、选中颜色问题。
- 修复切换事件层后批量编辑误报没有匹配选中物件的问题。
- 修复了自定义 shader 预览与 WebGL 共享上下文相关的 Bug。（由 @pashippercode 贡献）
- 修复了恢复默认值按钮的触发条件问题。
- 优化 T/U 键的操作逻辑。
- 恢复并开放扩展脚本的 `chart.lines()`、`chart.notes()` 和 `chart.events()` 接口。

**新增**

- 新增 `api.chart.lineGroups()`，以及事务中的 `lineGroups.create/assign`，支持按 folder 名批量切换判定线，并保留预览、撤销和过期计划保护。
- 新增切换钩定快捷键，默认 `F`。

**优化**

- 优化欢迎界面的操作逻辑，重构新建、导入、打开、导出和删除谱面的边缘操作按钮，并改善选中状态下的操作反馈。
- 优化绑定按键逻辑。

**贡献者**

- @ziyang51571
- @pashippercode

### English

**Improvements**

- Replace the default skin and add selectable built-in skins. Thanks to ziyang_51571 and MuYan for the supplied assets!
- Make the in-app changelog render code lines and add a clickable GitHub link.
- Add an opacity control for the clipboard ghost preview.
- Add a nearby-note merge toggle and set the default note merge distance to 50.
- Improve the timeline marker management interface.
- Improve the welcome page by giving the new-chart and import actions the same visual weight.
- Improve the top-left Logo exit prompt.
- Enhance the Extension Inspector interface and related settings.

**Fixes**

- Fixed bugs involving attachUI and nested asset files.
- Fixed `MirrorY` so it mirrors selected event values as well as note positions, and added the default `A` shortcut.
- Web and development builds no longer check for, prompt about, or automatically download updates; the web status bar appends the build time in the browser's local timezone.
- Fixed multi-line editing so Ctrl+wheel line switching follows the order entered in the selection field instead of sorting line numbers.
- Fixed concurrent saves of persisted values overwriting data from another instance.
- Fixed the app reopening as a normal window after it was closed while maximized.
- Fixed the ineffective “Layers 1-3” and “Extended events” options in the Event Properties tab.
- Fixed an incorrect hooked state when placing events.
- Support parsing `all` in the judge-line input.
- Fixed the selected area not updating in time and fixed rendering issues during marquee selection.
- Fixed refresh and selected-color issues for multi-selected note and event ghosts.
- Fixed batch editing incorrectly reporting that no selected object matched after switching event layers.
- Fixed bugs related to custom shader preview and shared WebGL contexts. (contributed by @pashippercode)
- Fixed the reset-to-default button trigger condition.
- Improved the playback behavior of the T and U keys.
- Restore and expose the `chart.lines()`, `chart.notes()`, and `chart.events()` interfaces for Extensions.

**Added**

- Add `api.chart.lineGroups()` and transactional `lineGroups.create/assign` operations so scripts can switch lines by folder name with preview, undo, and stale-plan protection.
- Add the default `F` shortcut for toggling the hook state of selected events.

**Improvements**

- Improve welcome page interactions by restructuring the edge actions for creating, importing, opening, exporting, and deleting charts, with clearer selected-state feedback.
- Improve shortcut binding.

**Contributors**

- @ziyang51571
- @pashippercode
