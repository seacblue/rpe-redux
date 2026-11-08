# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.7 (2026-11-08)

### 中文

**新功能**

- 音符皮肤改用 Phira respack 格式：可以导入 Phira 皮肤包（ZIP，或包含 `info.yml` 的文件夹），也可以把当前皮肤导出为标准 Phira 皮肤包。内置皮肤已按同一格式重制。
- 新增皮肤工作台：按槽位编辑音符、事件条、判定线贴图、打击效果图和打击音，可从其他已安装皮肤复用素材；Hold 槽位用切割器记录头、身、尾边界，打击效果槽位记录图集网格。
- 皮肤包支持两个 Redux 扩展：事件条贴图 `event_hold.png` 与判定线贴图 `line.png`；导出时会自动补齐事件条，并把判定线贴图规范到包根路径。
- 新增「删除皮肤」按钮和确认框。删除内置皮肤时，移除的是用户覆盖副本，随版本附带的皮肤会重新出现。
- 皮肤工作台可以直接拖入皮肤包打开。

**改进**

- 皮肤工作台改为固定高度并支持内部滚动，底部只保留「删除皮肤」和「保存皮肤」。
- 导入、导出皮肤包的结果改为在左下角以 toast 提示；取消文件或保存对话框时不提示。
- 不完整的皮肤仍可保存为部分包：运行时按槽位先从内置皮肤、再从其他已安装皮肤补齐缺失素材。

**修复**

- 修复编辑内置皮肤后「保存皮肤」会新建一份重复皮肤、皮肤选择器里出现第二个条目的问题：保存始终沿用打开的包 id。
- 导入前完整校验 Phira 包结构、图片尺寸、Hold 图集边界与打击效果网格，避免坏包进入皮肤库。

**移除**

- 旧版 `skin.json` / `manifest.json` 音符皮肤格式不再读取，也不再随版本分发；不提供旧格式转换。

### English

**Features**

- Note skins now use the Phira respack format: import a Phira skin package (a ZIP, or a folder containing `info.yml`), or export the selected skin as a standard Phira package. The built-in skin was rebuilt in the same format.
- Added the skin workbench: edit notes, event bar, judge line, hit effect, and hit sounds slot by slot, reuse a slot from another installed skin, record Hold head/body/tail boundaries with the cutter, and record the hit-effect atlas grid.
- Skin packages support two Redux extensions: the `event_hold.png` event-bar texture and the `line.png` judge-line texture; export fills in the event bar and normalizes the judge-line texture to the package root.
- Added a Delete skin button with a confirmation dialog. For the built-in skin it removes the user override, so the shipped skin comes back.
- A skin package can be dragged onto the workbench to open it.

**Improvements**

- The skin workbench now has a fixed height with internal scrolling, and its footer keeps only Delete skin and Save skin.
- Import and export results are reported in the bottom-left toast stack; cancelling a file or save dialog reports nothing.
- An incomplete skin still saves as a partial package: the runtime fills missing slots from the built-in skin first, then from the first installed skin that provides them.

**Fixes**

- Fixed saving the built-in skin creating a duplicate package and a second picker entry: saving always reuses the package id the workbench opened.
- Imports now validate the Phira package layout, image sizes, Hold atlas boundaries, and the hit-effect grid before installing a package.

**Removed**

- The former `skin.json` / `manifest.json` note-skin format is no longer read or distributed, and no converter for it ships.

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
