# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.15

### 中文

**新增功能**

- 加入了备份恢复功能，你们不说我还真忘了要加！
- 设置项和快捷键绑定现在会记录用户是否主动修改过。
- 新增按 `G/B` 向后/向前粘合事件。
- 事件时间线现在用钩定事件颜色绘制钩定事件条。
- 外观设置新增「钩定事件颜色」。
- 取消钩定时的事件尾部将会还原。
- 新增“多选判定线颜色”设置项：同时选中多条判定线时，除当前判定线外的选中线使用该颜色，默认 `#7DC87D`。
- 现在工具栏的播放按钮可以同时操作事件/音符时间轴的显隐了。
- 多事件编辑新增“编辑 / 克隆”切换与克隆页：按线号序列克隆选中事件，七个通道各自设置上下缓扰与周期数列，支持保留源和结果虚影。
- 事件现在可以在检查器里直接改类型，数值保持不变。
- 新增「同屏音符过多」的谱面错误项：超过阈值时给黄色警告，不计入错误数量。

**网页端**

- 修复了网页端“载入谱面”只提示需要桌面版的问题。
- 修复了网页端谱面库新建项目时的 SQLite 错误。
- 修复了网页端谱面库中的项目无法打开的问题。

**改进**

- 优化了 Bezier 输入框与界面的使用逻辑。
- 缓动预览不再在曲线框下方绘制首尾数值。
- 采样首尾值、粘合前一事件、切割事件、首尾交换四个事件操作按钮移到了「缓动 / Bezier」开关上方。
- 现在多线编辑下的滚轮切换线号更加合理。
- 优化时间标记功能与时间轴显示。
- 重写了「今日运势」的条目文案，让宜忌更贴近写谱场景，英文同步重译。

**修复**

- 修复了未启用 AI 代码单元时「高级编辑」页面恢复默认值按钮漂浮在行中间的问题。
- 修复了播放时三个拖动器跟随时明显抖动的问题。
- 现在节拍输入支持对所有 `X:Y/Z` 等数值的解析。
- 修复了 Bezier 手柄无法在 Y 方向超出 `[0, 1]` 范围的 Bug。
- Ctrl + 滚轮切换线号的逻辑与 RPE 保持一致。
- 桌面端打开和保存谱面时不再反复读取并哈希整包歌曲、背景和视频：未变化的文件按大小与修改时间复用摘要，磁盘快照在阻塞线程计算，保存成功后也不再额外探测一次。
- 歌曲、图片和自定义背景的读取移到阻塞线程，`redux://` 媒体响应支持 ETag 复用，打开谱面和选择纹理时不再因同步文件读取卡住界面。
- 主题、皮肤和扩展文件夹只在对应设置页可见时按五秒间隔扫描，窗口隐藏时暂停。
- 拖动窗口边缘与点击标题栏不再每个事件都发一次 IPC 或强制一次布局。
- 事件层第一个事件的缓动曲线现在会向左延拓到第一个事件开始之前。
- 修复了选谱主页左侧卡片跳变的 Bug。
- 现在在多线编辑下，文本不会压缩，检测到标题为“Untitled”时自动不显示标题。
- 更换判定线的三角形指示标记，在低透明度下更好辨认方向。
- 修复了合并音符下添加音符时，音符所在线号错误的 Bug。
- 播放时的时间跳动更加稳定。
- 修复了进度条向左无法拉伸到 0 的 Bug。
- 修复了数字输入框的步进按钮会被步长文字撑宽的问题。
- 修复了缓动预览在缓动左边界大于右边界时不绘制截取后曲线的问题。
- 修复了缓动预览与 Bézier 画布观感不一致的问题。
- 修复了缓动预览横轴不是线性的问题。
- 修复了缓动预览高亮切面方向错误的问题，并把左右边界改成各自的主题色。
- 修复了 Bézier 编辑区上下多出空隙的问题，并补上 y = ±1 两条参考线。
- 修复了拖动缓动左/右边界滑块时预览卡顿与闪烁的问题。
- 修复了 125% 等非整数显示缩放时工具栏两行之间出现过宽空隙的问题。
- 修复了“简化渲染”图标不随工具栏缩放的问题。
- 保存并返回、保存并退出现在以保存结果为准，保存完成后一定会离开编辑器。

**变更**

- 按住 `Z` 时，只要事件或 Hold 处于单选状态，就可以在时间轴任意位置按下：单击把对应头/尾落到指针所在拍，拖动则实时预览并在松开时提交，与 RPE 一致。

**代码优化**

- 新增 `--without-bundled-tools` 参数：构建或 `npm run dev:desktop` 时跳过 FFmpeg 和 Cloudflared 下载。
- 去除了 BeatInput 控件。
- 修复了开发服务器对开发者模式的影响。开发者界面不再随构建模式自动打开，所有宿主（包括 `npm run dev` 的浏览器循环）都从关闭状态开始。
- 重构了谱面错误的分析逻辑：检查改在后台运行，连续编辑只触发一次；每类检查可以单独关闭，并新增「谱面问题」设置页集中管理。

### English

**Features**

- Backup restore is in, and you had to remind me to add it.
- Settings values and shortcut bindings now record whether you changed them yourself.
- `G` / `B` now stick events backward and forward.
- The event timeline now paints hooked event bars in the hooked-event colour.
- Appearance settings gain a "Hooked event colour" row.
- Unhooking an event now restores its tail.
- Added the "Multi-select judgement-line colour" setting: when several judge lines are selected, the lines other than the current one use this colour, defaulting to `#7DC87D`.
- The toolbar play button now also shows and hides the note and event timelines.
- Multi-event editing gains an Edit/Clone switch and a clone page: selected events are cloned onto a line sequence, each of the seven channels has its own lower/upper/easing and cycle sequences, and keep-source and result ghosts are supported.
- Events can now change type directly in the inspector, keeping their values.
- Added a "too many notes on screen" chart issue: a passage above the limit gets a yellow warning and stays out of the error count.

**Web**

- Fixed the web "import chart" action only reporting that the desktop build is required.
- Fixed the SQLite error when the web chart library created a project.
- Fixed web-library projects failing to open.

**Improvements**

- The Bezier input field and the interface around it are easier to use.
- The easing preview no longer prints the start and end values below the plot.
- The sample start/end, stick previous event, cut event, and swap start/end buttons now sit above the easing/Bezier switch.
- Wheel line switching while multi-line editing now behaves more sensibly.
- Improved the time marker editor and the timeline display.
- Rewrote the daily-fortune entries so the suitable and avoid notes fit charting better, with matching English.

**Fixes**

- Fixed the advanced-editing reset button floating mid-row while AI code cells are disabled.
- Fixed the three drag handles visibly jittering while they follow playback.
- Beat input now parses every `X:Y/Z` form and its numeric variants.
- Fixed Bezier handles being unable to leave the `[0, 1]` range in Y.
- Ctrl + Wheel line switching now follows RPE's direction.
- Opening and saving a desktop chart no longer re-reads and re-hashes every song, background, and video: unchanged files reuse a digest keyed by size and modification time, snapshots run on the blocking pool, and a successful save no longer probes the disk again.
- Song, image, and custom-background reads move off the main thread, and `redux://` media responses revalidate with an ETag, so opening charts and picking textures no longer stall on synchronous file reads.
- Theme, skin, and Extension folders are scanned every five seconds only while their settings page is visible, and pause while the window is hidden.
- Resizing a window edge or pressing the title bar no longer sends an IPC call per event or forces a layout on every press.
- The first event of a layer now extends its easing curve to the left of its own start.
- Fixed the selected-chart card on the home screen jumping on hover.
- In multi-line editing, text is no longer compressed, and a line title detected as "Untitled" is hidden automatically.
- Replaced the judge line's triangle marker so its direction stays readable at low opacity.
- Fixed notes added in merged multi-line mode landing on the wrong judge line.
- Playback timing is more stable.
- Fixed the progress bar not reaching zero when dragged left.
- Fixed number input step buttons widening to fit their step labels.
- Fixed the easing preview dropping the cut curve when the left bound is greater than the right bound.
- Fixed the easing preview and the Bezier editor looking inconsistent.
- Fixed the easing preview's horizontal axis not being linear.
- Fixed the easing preview highlighting the wrong dimension, and gave the left and right bounds their own theme colours.
- Fixed the Bezier editor carrying extra vertical gap, and added the y = ±1 reference lines.
- Fixed the easing preview stuttering and flashing while a bound slider is dragged.
- Fixed the toolbar rows drifting apart on 125% and other fractional display scales.
- Fixed the simplified-rendering icon not scaling with the toolbar.
- Save and return / save and quit now follow the save result, so a completed save always leaves the editor.

**Changed**

- With `Z` held, a single selected event or Hold can be trimmed from anywhere in the timeline: a click moves that edge to the pointer row, and a drag previews live and commits on release, matching RPE.

**Code**

- Added `--without-bundled-tools`, which skips the FFmpeg and Cloudflared downloads for `npm run build` and `npm run dev:desktop`.
- Removed the BeatInput control.
- Fixed the development server affecting developer mode. The developer section no longer opens with the build mode; every host, including the `npm run dev` browser loop, starts closed.
- Reworked how chart issues are analyzed: the checks now run in the background, a burst of edits costs one scan, each kind can be turned off, and a new Chart issues settings page owns them.
