# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.7 (2026-11-08)

### 中文

**新功能**

- 新增时间轴缩放功能快捷键配置，默认 Alt + WheelUp / Alt + WheelDown。
- 新增“按住仅预览播放（松开返回）”与“按住仅预览播放（松开停留）”功能，使用 RPE 的用户肯定对它不陌生！默认快捷键 T / U。
- 早在 1.0.6 版本，我们就新增了“镜像粘贴”功能，这是另一处与 RPE 的功能对齐。默认快捷键 Ctrl + B——我去，不早说！
- 素材库支持对素材的外部修改。
- 素材库支持 Shader 相关的素材导入与预览。
- 支持对 Phira GLSL 1.00 接口的兼容。
- 音符皮肤改用 Phira respack 格式：可以导入 Phira 皮肤包，也可以把当前皮肤导出为标准 Phira 皮肤包。
- 新增皮肤工作台：按槽位编辑音符、事件条、判定线贴图、打击效果图和打击音，可从其他已安装皮肤复用素材。

**改进**

- 多线编辑与音符 / 事件的多线编辑状态切换的快捷键从 F / G 改为 J / K，与 RPE 对齐。
- 现在程序启动失败时，不会再允许后台的长任务执行。
- 优化了欢迎界面的列表骨架屏显示。
- 素材库的排列方式改回列表。
- 素材库去除了对图片的修改功能，“为什么我们不能使用外部工具修改呢？”
- 横线与竖线的高亮现在由颜色的叠加实现。
- 事件在多选时不会有虚线边框了。虽然我们用了实线边框代替，但是下个版本我们会删除的。
- 现在设置的搜索内容会匹配输入框、滑条与下拉框的内容。
- 哦对了。在上个版本，设置的搜索内容已经可以在会话内保存，但是我们忘记写进更新日志了。

**代码质量**

- 修复了 settings journey 产品断言的返回值错误问题。

**修复**

- 修复了 Alt + 鼠标滚轮缩放时间轴时的闪烁 Bug。
- 修复了播放头错误移动的 Bug。
- 修复了扩展安全模式对特定扩展失效的 Bug。
- 修复了不显示 Shader 的 Bug。
- 修复了音符时间轴不显示左边框的 Bug。
- 修复了竖线的计算不符合预期的 Bug。
- 修复了在事件时间轴上，横线未正确高亮的 Bug。
- 修复了使用划线多选与其他多选方案时，错误判断多选意图的 Bug。
- 修复了无法正确载入 PE 格式谱面的 Bug。
- 修复了状态栏的拖拽等事件无效且误触发程序内部点击事件的 Bug。

### English

**Features**

- Added shortcut configuration for timeline zoom, defaulting to Alt + WheelUp / Alt + WheelDown.
- Added "hold to preview only (release to return)" and "hold to preview only (release to stay)". RPE users will know exactly what this is! Default shortcuts T / U.
- We added Mirror paste back in 1.0.6 — another step toward RPE feature parity. Default shortcut Ctrl + B — oh wow, why didn't anyone say so earlier.
- The asset library now supports external edits to assets.
- The asset library can import and preview shader assets.
- Added compatibility with the Phira GLSL 1.00 interface.
- Note skins now use the Phira respack format: import a Phira skin package, or export the current skin as a standard Phira package.
- Added the skin workbench: edit notes, event bars, judge-line textures, hit-effect images, and hit sounds slot by slot, and reuse assets from other installed skins.

**Improvements**

- The shortcut for toggling multi-line editing, and multi-line editing of notes / events, changed from F / G to J / K to match RPE.
- When startup fails, long background tasks are no longer allowed to run.
- Improved the list skeleton screen on the welcome page.
- The asset library layout is back to a list.
- Removed image editing from the asset library — "why can't we just edit with external tools?"
- Highlighting for horizontal and vertical lines now uses colour blending.
- Events no longer get a dashed border when multi-selected. We replaced it with a solid border, but we will remove it next version.
- Settings search now matches the contents of input fields, sliders, and dropdowns.
- Oh, right: in the previous version, the settings search text already persisted within a session, but we forgot to mention it in the changelog.

**Code quality**

- Fixed an incorrect return value in a product assertion in the settings journey.

**Fixes**

- Fixed flicker when zooming the timeline with Alt + mouse wheel.
- Fixed the playhead moving incorrectly.
- Fixed extension safe mode not applying to certain extensions.
- Fixed shaders not being displayed.
- Fixed the note timeline not showing its left border.
- Fixed vertical-line calculations not behaving as expected.
- Fixed horizontal lines not highlighting correctly in the event timeline.
- Fixed misjudging the multi-select intent when mixing sweep selection with other selection methods.
- Fixed PE-format charts failing to load correctly.
- Fixed drag and other events on the status bar doing nothing and accidentally triggering the app's internal click events.

## 1.0.6 (2026-11-08)

### 中文

**新功能**

- 新增窗口、全屏和独占（兼容模式）显示设置，以及常用窗口分辨率选项。
- 编辑器视图支持在完整布局快照之间切换，并保留视图模式历史，方便恢复之前的布局。<inspired by @MatrixBlanchet's suggestion>
- 使用 Ctrl + 连续数字的快捷键，可以方便地切换线号。<inspired by @MuYan's suggestion>
- 颜色设置支持透明度编辑与 RGBA 颜色迁移。
- 支持在启动时指定前端、后端与 AI 功能的端口。
- 现在按下 Esc 可以取消选中的物件。
- 新增长按划线与取消功能。

**改进**

- 预览和画布渲染：现在会正确按照可见范围筛选音符。
- 预览和画布渲染：现在会正确缓存线条高度计算，并复用批量绘制数据。
- 协作编辑：改进资源传输的背压与限流。
- 协作编辑：远程修改不再重复执行完整谱面计算。
- 协作编辑：现在选区会在远程变更后正确映射。
- X 轴网格恢复支持小数值。
- 自动更新默认开启；关闭自动更新后，WiFi/流量更新下载策略会同步禁用。
- 更新下载默认使用 WiFi 策略，避免自动占用移动网络。
- 现在右上角的进度条终于不再那么靠近边缘。
- 现在在启动界面失败时，完整的报错信息将不再被折叠。
- 横线与竖线的高亮逻辑更加对齐 RPE。
- 在我们录制演示视频时，发现设置界面的启动是同步的，所以现在它变成异步的了。
- 卸载程序使用了更加精美的图标，以防有人打开软件时不小心点开卸载程序。
- 修复了一些很明显是由 AI 遗留而极度缺乏人情味的文本内容。
- 人类历史上曾经有一些关于使用 → 与 > 之间的强烈的争论，而我们已经做出了选择。

**代码质量**

- 将一些文件名从 kebab-case 改为 camelCase。
- 移除了过时的 MCP 编辑通道。
- 修改了 Markdown 文件的断行问题，现在它们看起来的效果不会这么可笑了。

**修复**

- 修复了一些原生 tooltip 的错误展示，与我们不知道为什么会改坏的 tooltip 相关代码。
- 修复了多线编辑下的物件缩放错误的 Bug。
- 对齐普通 WebView2 启动参数，修复相关桌面启动问题。
- 修复了卸载程序无法清理数据的 Bug，清理数据按钮一定要能清理数据。

### English

**Features**

- Added Windowed, Fullscreen, and Exclusive (compatibility mode) display settings, plus common window-resolution options.
- Editor views can now switch between complete layout snapshots and retain view-mode history, making previous layouts easier to restore.<inspired by @MatrixBlanchet's suggestion>
- Hold Ctrl and type a judge-line number to quickly switch to that line.<inspired by @MuYan's suggestion>
- Colour settings now support alpha editing and RGBA colour migration.
- The frontend, backend, and AI feature ports can now be specified at startup.
- Pressing Esc now deselects the selected objects.
- Added hold-and-drag sweep selection and deselection.

**Improvements**

- Preview and canvas rendering: notes are now culled correctly by visible range.
- Preview and canvas rendering: line-floor calculations are now cached correctly, and batch-drawing data is reused.
- Collaboration: improved backpressure and throttling for asset transfer.
- Collaboration: remote edits no longer repeat full-chart calculations.
- Collaboration: selections are now remapped correctly after remote changes.
- X-axis grids support fractional values again.
- Automatic updates are now enabled by default; disabling them also disables the Wi-Fi/metered download policy.
- Update downloads now default to the Wi-Fi policy, avoiding automatic use of metered networks.
- The progress bar in the top-right corner is finally no longer so close to the edge.
- When the startup screen fails, the full error message is no longer collapsed.
- The highlight behaviour for horizontal and vertical lines now aligns more closely with RPE.
- While recording the demo video, we found that the settings screen opened synchronously, so it now opens asynchronously.
- The uninstaller now uses a much nicer icon, so nobody opens it by accident when launching the app.
- Fixed some text that was clearly left over from AI and sorely lacking in human warmth.
- Human history has seen some fierce debates over using → versus >, and we have made our choice.

**Code quality**

- Renamed some files from kebab-case to camelCase.
- Removed the obsolete MCP editing transport.
- Changed line breaking in Markdown files; they no longer look so ridiculous.

**Fixes**

- Fixed some incorrect native tooltip displays, along with the tooltip-related code that we broke without knowing why.
- Fixed a bug where objects scaled incorrectly in multi-line editing.
- Aligned normal WebView2 startup arguments, fixing related desktop launch issues.
- Fixed a bug where the uninstaller could not clean up data; the clear-data button must actually clear data.
