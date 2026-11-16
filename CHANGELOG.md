# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.10

### 中文

**新功能**

- 新增谱面分类功能。
- 谱面会自动生成缩略图，供欢迎界面使用。
- 版本更新现在允许暂停和启动了。
- 批量编辑的历史记录功能。
- Easing 的滚轮功能。
- 平移音符区与界外音符的提示。
- 测试一下新的步进器输入框。

**改进**

- 性，能，优，化。
- 欢迎界面左上角不会再出现三个点的按钮。
- 优化了长任务的逻辑与批量载入逻辑。
- 现在载入谱面不会出现模态框阻挡了。分离了载入谱面与打开谱面的行为。
- 现在项目不再对外显示为 WebView 应用。
- 把横竖辅助线的设置项加回来了。
- 现在开启时间轴时不会显示背景预览的打击特效。
- 更好看的欢迎界面。

**修复**

- 修复了左上角 Logo 位置错误且出现 Tooltip 的 Bug。
- 修复了事件首尾值相关的渲染与行为 Bug。
- 修复了无法打开非 RPE 谱面的 Bug。
- 修复了按下预览试听按键的时候，对应按键不会亮起的 Bug。
- 修复了可以电表倒转从而影响欢迎界面音符和事件计数的 Bug。
- 修复了一些报错 Toast 的标题名错误使用原始值而不是 i18n 的 Bug。
- 修复了自由视角下的 UI 错误的 Bug。
- 修复了打击音效在一些情况下不会播放的 Bug。<贡献来源：@MatrixBlanchet>

### English

**Features**

- Added chart categorization.
- Charts now generate thumbnails automatically for use on the welcome screen.
- Version updates can now be paused and resumed.
- Added history for batch editing.
- Added mouse-wheel support for Easing.
- Added prompts for panning the note area and for notes outside the chart bounds.
- Try out the new stepper input.

**Improvements**

- Performance optimization.
- Removed the three-dot button from the top-left corner of the welcome screen.
- Optimized long-running task logic and batch-loading logic.
- Loading a chart is no longer blocked by a modal. Separated loading a chart from opening a chart.
- The project is no longer presented externally as a WebView application.
- Restored the settings for horizontal and vertical guide lines.
- Background preview hit effects are no longer shown when the timeline is enabled.
- A better-looking welcome screen.

**Fixes**

- Fixed a bug where the top-left Logo was in the wrong position and showed a Tooltip.
- Fixed rendering and behaviour bugs related to event start and end values.
- Fixed a bug that prevented non-RPE charts from being opened.
- Fixed a bug where the corresponding key did not light up when pressing the preview-audition key.
- Fixed a bug where a meter could run backwards, affecting the welcome-screen note and event counts.
- Fixed a bug where some error Toast titles incorrectly used raw values instead of i18n.
- Fixed a UI bug in free-view mode.
- Fixed a bug where hit sounds did not play in some situations. <contributed by @MatrixBlanchet>
