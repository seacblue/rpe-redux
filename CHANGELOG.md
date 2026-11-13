# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.9 (2026-11-13)

### 中文

**新功能**

- Inspector 现在可以展开成「工作室」。
- 判定线属性新增控制曲线编辑器。
- 网页端与桌面端共用一套路由。桌面端支持 rperedux://chart/<id> 深链。
- 重叠音符现在会按固定角度递增原地扇形展开。
- 欢迎界面与谱面库重做。新增今日运势功能。
- 新增 Q / E 在欢迎界面切换谱面的快捷键。新增重命名功能与新谱面标记。
- 新增 Esc 键快捷打开设置功能。
- 新增 Ctrl 快捷键：在时间轴上点选起止音符，就能在它们之间生成曲线音符。
- 曲线音符现在能生成 Hold 了，与 RPE 的又一处对齐。
- 现在应用会检测拖入的文件夹是否是 RPE 文件夹，自动导入并给出确认模态框。<贡献来源：@MatrixBlanchet>
- 侧边栏新增音量控制按钮。

**联机协作**

- 协作房间的二进制资源改为流式传输，不再把整包资源塞进内存。
- 重新加入房间时，内容没有变化的谱面会跳过重新下载，直接复用本地资源。
- 联机协作的提示更加人性化。

**网页端**

- 皮肤包等外部内容，现在会存入浏览器 SQLite 的 app_packages / app_package_files，随 .sqlite 导出和备份一起带走。
- 隐藏“打开应用数据文件夹”按钮。

**改进**

- 优化了谱面 CRUD、启动相关的逻辑。
- 优化重叠选择器，只显示必要信息。
- 事件属性的起始值与终值不再被夹取。
- 递增默认键改为 Ctrl + Wheel Up，递减默认键改为 Ctrl + Wheel Down。替换了部分快捷键的显示顺序。
- 放置事件、显示结果虚影时不再显示程序化生成的皮肤，显示结果虚影时的皮肤更加暗淡。
- 现在在播放时按下 T / U 键将会切换成仅预览界面。
- 调整了波形透明度与波形增幅的设置默认值。
- 竖线终于正确运用了小数参数。
- 顶部工具栏新增父线输入框。
- 导出诊断包现在会真的导出有用的东西。

**代码质量**

- 精简公开 API：移除 chart.placeNote、document.snapshot / document.fingerprint、库根级的 CRUD 接口、workspace 包句柄与 extensions getter。
- SDK 文档与示例（中英）同步更新。
- 移除 chrome.layout、chrome.metrics、titlebar.density 三个主题块，这些字段不再生效。
- 设计基础抽层：边缘 token、文本截断 mixin、FieldRows、浮层锚点跟踪与层级、按压与过渡动效都改成了共享实现。
- 路由契约补齐了 hash 路由与深链的单测，GitHub Pages 构建不再依赖 SPA 回退。

**修复**

- 修复了在素材库播放音频时，Space 按键错误控制谱面播放的 Bug。
- 修复了展开 Inspector 时封面与紧凑态的边缘、色差问题：两侧 inset 一致、去掉了多出来的 1px 边框，封面沿用同一套模糊与色调。
- 修复了展开与返回 Inspector 时 BPM 表单可能被清空的 Bug。
- 修复了 J 键无法打开多线编辑、K 键无法正确切换事件与音符编辑的 Bug。<贡献来源：@MatrixBlanchet>
- 修复了 Ctrl + 滚轮向上滑动判定线无法正确切换的 Bug。<贡献来源：@MatrixBlanchet>
- 修复了 Hold 与其他音符 z-order 错误的 Bug。
- 修复了多线编辑情况下的左键逻辑错误的 Bug。
- 修复了一些 checkbox 未正确更新的 Bug。
- Hold 尾部的问题终于修复了……？

### English

**Features**

- The Inspector can now expand into a Studio.
- Judge-line properties now include a control-curve editor.
- Web and desktop now share one routing layer. Desktop supports `rperedux://chart/<id>` deep links.
- Overlapping notes now fan out in place at a fixed incrementing angle.
- Reworked the welcome screen and chart library. Added the daily fortune feature.
- Added Q / E shortcuts to switch charts on the welcome screen. Added renaming and a new-chart marker.
- Added an Esc shortcut to open settings.
- Added a Ctrl shortcut: select the start and end notes on the timeline to generate curve notes between them.
- Curve notes can now generate Holds, another step toward RPE parity.
- The app now detects whether a dropped folder is an RPE folder, imports it automatically, and shows a confirmation modal. <contributed by @MatrixBlanchet>
- Added volume controls to the sidebar.

**Collaboration**

- Collaboration room binary assets now stream instead of loading the whole package into memory.
- Rejoining a room skips re-downloading charts whose contents are unchanged and reuses local assets.
- Collaboration prompts are friendlier.

**Web**

- External content such as skin packages is now stored in the browser SQLite `app_packages` / `app_package_files` tables, so it travels with `.sqlite` exports and backups.
- Hid the "Open app data folder" button.

**Improvements**

- Optimized chart CRUD and startup logic.
- Improved the overlap picker to show only necessary information.
- Event property start and end values are no longer clamped.
- The default increment shortcut is now Ctrl + Wheel Up, and decrement is Ctrl + Wheel Down. Adjusted the display order of some shortcuts.
- Procedurally generated skins no longer appear for pending events or result ghosts, and result ghosts are dimmer.
- Pressing T / U during playback now switches to the preview-only surface.
- Adjusted the default waveform opacity and waveform amplitude settings.
- Vertical lines now correctly apply fractional parameters.
- Added a parent-line input box to the top toolbar.
- Diagnostic bundles now actually export useful data.

**Code quality**

- Simplified the public API: removed `chart.placeNote`, `document.snapshot` / `document.fingerprint`, library-root CRUD interfaces, the workspace package handle, and the extensions getter.
- Updated the SDK documentation and examples in both languages.
- Removed the `chrome.layout`, `chrome.metrics`, and `titlebar.density` theme blocks; those fields no longer take effect.
- Design foundation extraction: edge tokens, the text-truncation mixin, FieldRows, floating anchor tracking and layering, and press/transition motion are now shared implementations.
- The router contract now covers hash routes and deep links with unit tests, and the GitHub Pages build no longer depends on an SPA fallback.

**Fixes**

- Fixed a bug where Space controlled chart playback while audio was playing in the asset library.
- Fixed edge and colour issues between the cover and compact states when expanding the Inspector: both sides use the same inset, the extra 1px border is gone, and the cover uses the same blur and tint.
- Fixed a bug where the BPM form could be cleared when expanding and returning to the Inspector.
- Fixed a bug where J could not open multi-line editing and K could not correctly switch between event and note editing. <contributed by @MatrixBlanchet>
- Fixed a bug where Ctrl + wheel up could not correctly switch judge lines. <contributed by @MatrixBlanchet>
- Fixed a bug with the z-order of Holds and other notes.
- Fixed incorrect left-click behaviour in multi-line editing.
- Fixed some checkboxes not updating correctly.
- The Hold tail issue is finally fixed...?
