# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.15

### 中文

**新增功能**

- 加入了备份恢复功能：自动保存现在会写进谱面库的分支树，「恢复为备份…」可以把谱面退回任意一个自动保存点，恢复前的谱面也会留成一条备份，所以随时能再走回来——你们不说我还真忘了要加！
- 设置项和快捷键绑定现在会记录用户是否主动修改过。即使改回默认值，该记录也会保留；点击“恢复默认”会清除记录。导入、迁移和自动修复不会把值标记为用户修改。
- 新增 `--without-bundled-tools` 参数：构建或 `npm run dev:desktop` 时跳过 FFmpeg 和 Cloudflared 下载。没装这两个工具也能启动，导出会提示不可用，开房会自动改用内网。
- 新增按 `G` 向后粘合事件：选中事件的结束值会取同一事件轨上下一事件的起始值，与 RPE 的粘合行为一致。事件检查器新增“粘合下一事件”按钮，执行同一命令。
- 外观设置新增「钩定事件颜色」，默认取主题的钩定颜色，可自行调整。
- 现在取消钩定时的事件尾部将会还原。勾选“首尾同步”（钩定）后事件仍按 10-10 渲染，但被替换的尾值会缓存下来；再次取消钩定即还原为 10-20。钩定期间只改起始值时，缓存的尾值不跟随，取消后得到“新起始值-原尾值”。导出文件仍写入 10-10，本编辑器重新打开时恢复缓存的尾值。
- 新增“多选判定线颜色”设置项：同时选中多条判定线时，除当前判定线外的选中线使用该颜色，默认 `#7DC87D`。
- 现在工具栏的播放按钮可以同时操作事件/音符时间轴的显隐了：开始播放时隐藏音符和事件编辑层，暂停时停在当前位置并恢复显示。该按钮与空格键相互独立，空格仍然是纯粹的播放/暂停。

**改进**

- 优化了 Bezier 输入框的使用逻辑：四个控制点合成一个输入框，可粘贴任意文本并取前四个数字，超出 `[0, 1]` 的 x 自动夹到边界；手柄悬停放大变色，拖动时另有颜色，两者都带过渡动画。
- 缓动预览不再在曲线框下方绘制首尾数值：横轴的含义已由「起始值」「结束值」字段表达，框内重复一遍只会挤占画面。
- 采样首尾值、粘合前一事件、切割事件、首尾交换四个事件操作按钮移到了「缓动 / Bezier」开关上方，选完事件即可先执行操作，再决定用哪种曲线。
- 现在多线编辑下的滚轮切换线号更加合理：只在多线线号内按线号顺序切换，不再超出列表。
- 优化时间标记功能与时间轴显示。

**变更**

- `G` / `B` 不再上下移动事件。时间方向移动改用 `↑` / `↓`（换线仍为 `Alt+↑` / `Alt+↓`）；`B` 改为向前粘合，即把选中事件的起始值改为上一事件的结束值。

**修复**

- 修复了未启用 AI 代码单元时「高级编辑」页面恢复默认值按钮漂浮在行中间的问题：单列权限矩阵改为贴着最右侧复选框排列，重置按钮因此紧邻复选框左侧。
- 修复了播放时三个拖动器跟随时明显抖动的问题：拖动器原本只按界面文字的刷新节奏（每秒约 12 次）重算位置，而且用的是上一帧的滚动位置，因此在播放头平滑移动时它一格一格地跳。现在它随每一帧重新定位，与播放头使用同一帧的时间，并且直接写入合成层位移，不再触发 React 重渲染。
- 去除了过时的 BeatInput 控件。
- 现在节拍输入支持对所有 `X:Y/Z` 等数值的解析。
- 修复了 Bezier 手柄无法在 Y 方向超出 `[0, 1]` 范围的 Bug：手柄可以越过单位框，曲轴实时跟随缩放以保证手柄可见。
- Ctrl+滚轮切换线号的逻辑与RPE保持一致。
- 桌面端打开和保存谱面时不再反复读取并哈希整包歌曲、背景和视频：未变化的文件按大小与修改时间复用摘要，磁盘快照在阻塞线程计算，保存成功后也不再额外探测一次。
- 歌曲、图片和自定义背景的读取移到阻塞线程，`redux://` 媒体响应支持 ETag 复用，打开谱面和选择纹理时不再因同步文件读取卡住界面。
- 主题、皮肤和扩展文件夹只在对应设置页可见时按五秒间隔扫描，窗口隐藏时暂停；删除这些文件夹不会因为应用占用文件而失败，运行时继续使用已加载的主题文档、皮肤位图和扩展代码。主题选择页重新扫描时会把已删除的活动主题退回内置主题；皮肤页保留当前已解码的位图并标记缺失；扩展页会卸载已删除的扩展。扩展入口源码也改为按原始字节读取，不再经过 JSON 数字数组。
- 拖动窗口边缘与点击标题栏不再每个事件都发一次 IPC 或强制一次布局。
- 事件时间线现在用钩定事件颜色绘制钩定事件条，钩定事件不再和普通事件使用同一种材质。
- 首尾拍相同的事件不再被接受：放置、编辑、时间线渲染和谱面问题面板都把零长度区间视为非法，钩定事件也不例外。
- 事件层第一个事件的缓动曲线现在会向左延拓到第一个事件开始之前，因此没有垫底事件的谱面在 0 拍和负数拍上会按该曲线取值，而不是回落到类型默认值。例如把 quad in 的 0→300 事件放在 3–4 拍，0 拍处的值现在是 2700，整条轨迹是一条抛物线。第一个事件是钩定事件时，初始值直接取该钩定事件的值；贝塞尔事件沿起点切线延拓；轨迹事件保持起始值。事件之间的空隙不受影响，仍保持前一个事件的结束值；0 拍的垫底事件会终止延拓。
- 修复了选谱主页左侧卡片跳变的 Bug。
- 现在在多线编辑下，文本不会压缩，检测到标题为“Untitled”时自动不显示标题。
- 标题过长时截断并以 `...` 结尾；音符与事件字段统一显示标题条。
- 事件数值和其他数字标签空间不足时逐个去掉小数位，整数仍放不下则保持原宽并允许重叠。
- 更换判定线的三角形指示标记，在低透明度下更好辨认方向。新标记是等边三角形：底边贴合判定线、尖端沿判定线法线朝上，底边正中再挖掉一个小的等边三角形，底边因此分成两只脚；相比原先重心浮在线之上的等腰三角形，即使线条本身完全透明，也能看出它在哪条线上、朝哪个方向。
- 标记缩小至原来的四分之三，并沿法线抬离判定线，留出自身高度四分之一的间距，不再贴着线放置。
- 选中判定线时，预览里的指示标记在默认的 GPU 绘制路径上完全不显示。贴图按一个不存在的目录加载，取不到时纹理分支会直接放弃这次提交；关闭「显示判定线编号」后连整帧都会被跳过。现在标记作为应用自带资源随安装包发布，两条绘制路径都会画出它。
- 标记不再被主题色忽略。贴图是白色透明蒙版，原先用 `fillStyle` 上色对 `drawImage` 无效，深色与浅色主题都会画出白色标记；现在按 `--canvas-preview-line-selected` 着色。
- 修复了合并音符下添加音符时，音符所在线号错误的 Bug。
- 修复了开发服务器对开发者模式的影响。开发者界面不再随构建模式自动打开，所有宿主（包括 `npm run dev` 的浏览器循环）都从关闭状态开始；在非开发者模式下，相关的快捷键将不会生效——按 F3 不会打开性能监视窗口，开发者设置页也不会出现，只有宿主策略或「关于」页对 logo 连续点击十次显露开发者界面之后，这些入口才会恢复。
- 播放时的时间跳动更加稳定：暂停、恢复和跳转不再出现约 52 毫秒的前后跳动，起播时画面超前量在输出延迟窗口内平滑建立。
- 修复了进度条向左无法拉伸到 0 的 Bug：指针现在按实际绘制的轨道换算，轨道最左端就是起点，不再残留一个像素对应的曲目时长，偏移也不会随曲目变长而变大。
- 修复了暂停时跳转到开始仍会残留约 52 毫秒提前量的问题：显式跳转会释放画面前导，位置读数与播放头停在跳转目标。
- 修复了数字输入框的步进按钮会被步长文字撑宽的问题。
- 修复了网页端“载入谱面”只提示需要桌面版的问题：欢迎页和编辑器现在可以选择 JSON、PEZ 或 ZIP 谱面，解析后写入浏览器谱面库，归档内的多张谱面会逐个导入。
- 修复了浏览器谱面库新建项目时的 SQLite 错误（插入语句少一个字段值），该错误同时导致网页端保存失败、保存后无法返回谱面库或退出。
- 修复了浏览器谱面库中的项目无法打开的问题：不支持分帧读取的宿主现在直接读取整份谱面。
- 保存并返回、保存并退出现在以保存结果为准，保存完成后一定会离开编辑器，不会被滞后的未保存标记拦住。

### English

**Features**

- Added backup restore: autosave now also appends to a branch tree in the chart library, and "Restore from backup…" walks the chart back to any autosaved point — while keeping the chart it replaced as its own backup, so the way back is one more restore.
- Settings values and shortcut bindings now record whether the user explicitly modified them. The record survives a value returning to its default, and the row's reset action clears it. Imports, migrations, and automatic repairs do not mark a value as user-modified.
- The toolbar play button now controls the note and event timelines too: starting playback hides the note and event regions, and pausing holds the current position and shows them again. The button is independent of Space, which stays a plain play/pause toggle.
- Added `--without-bundled-tools` for `npm run build` and `npm run dev:desktop`, which skips the FFmpeg and Cloudflared downloads. The app still starts; export says it is unavailable, and hosting a room falls back to the LAN bridge.
- Added backward event sticking on `G`: the selected event's end value takes the start value of the next event on the same track, matching RPE's stick command. The event inspector carries a "stick to the next event" button that runs the same command.
- Appearance settings gain a "Hooked event colour" row; it starts at the theme's hooked colour and can be changed.
- Unhooking an event now restores its tail value. A hooked event still renders 10-10, but the replaced tail is cached and unhooking restores 10-20. Moving only the head while hooked leaves the cached tail alone, so unhooking yields the new head with the original tail. Exported files still carry 10-10, and reopening them in this editor restores the cached tail.
- Added the "Multi-select judgement-line colour" setting: selected judge lines other than the current line use this colour, defaulting to `#7DC87D`.

**Improvements**

- Improved the Bezier input: the four control points share one field that accepts pasted text and takes its first four numbers, with x values outside `[0, 1]` clamped to the edge. Handles grow and change colour on hover, use a second colour while dragging, and animate both.
- The easing preview no longer prints the start and end values below the plot: the start/end fields already name the axis, so repeating them inside the frame only crowded the drawing.
- The sampling, stick, cut, and swap event tool buttons now sit above the easing/Bezier switch, so an event can be acted on first and its curve chosen after.
- Wheel line switching while multi-line editing is more sensible: it stays inside the multi-line line set and follows line-number order instead of leaving the list.
- Improved the time marker editor and timeline display.

**Changed**

- `G` / `B` no longer move events in time. Time nudging stays on `↑` / `↓` (`Alt+↑` / `Alt+↓` still change the line), and `B` now sticks backward by writing the previous event's end value into the selected event's start.

**Fixes**

- Fixed the advanced-editing reset button floating mid-row while AI code cells are disabled: the one-column permission matrix now ends at the trailing edge, so the reset button sits directly left of the rightmost checkbox.
- Fixed the three drag handles visibly jittering while they follow playback: the handle group only repositioned at the HUD cadence (about 12 times a second) and used the previous frame's scroll position, so it stepped while the playhead moved smoothly. It now repositioned on every frame, against the same time the playhead uses for that frame, and writes a composited transform instead of committing a React render.
- Removed the obsolete BeatInput control.
- Beat input now parses every `X:Y/Z` form and its numeric variants.
- Fixed Bezier handles being unable to leave the `[0, 1]` range in Y: a handle may now cross the unit box, and the value axis rescales live to keep it visible.
- Ctrl+Wheel line switching now follows RPE's direction: Wheel Down advances the line number and Wheel Up goes back.
- Opening and saving a desktop chart no longer re-reads and re-hashes every song, background, and video: unchanged files reuse a digest keyed by size and modification time, snapshots run on the blocking pool, and a successful save no longer probes the disk again.
- Song, image, and custom-background reads move off the main thread, and `redux://` media responses revalidate with an ETag, so opening charts and picking textures no longer stall on synchronous file reads.
- Theme, skin, and Extension folder scans run only while the matching settings page is visible, every five seconds, and pause while the window is hidden. Deleting those folders never fails because the app holds the files open, and the live session keeps using the theme document, skin bitmaps, and Extension code it already loaded. A theme-picker rescan moves a deleted active theme back to the built-in; the skin page keeps the decoded bitmaps and marks the package missing; the Extensions page unloads a deleted package. Extension entry code now crosses IPC as raw bytes instead of a JSON number array.
- Resizing a window edge or pressing the title bar no longer sends an IPC call per event or forces a layout on every press.
- The event timeline now paints hooked event bars in the hooked-event colour instead of sharing the ordinary event material.
- An event whose start and end beat are identical is no longer accepted: placement, edits, timeline rendering, and the chart issues panel all treat an empty span as invalid, including hooked events.
- The first event of a layer now extends its easing curve to the left of its own start, so a chart without a padding event follows that curve at beat zero and at negative beats instead of falling back to the channel default. A `quad in` ramp from 0 to 300 placed at beats 3-4 now reads 2700 at beat zero and traces a parabola. When the first event is hooked, the initial value is that hooked event's own value; bezier events extend along their start tangent and trajectory events hold their start value. Gaps between events are unaffected and keep holding the earlier event's end value; a padding event at beat zero ends the extension.
- Fixed the selected-chart card on the home screen jumping on hover.
- In multi-line editing, text is no longer compressed, and a line title detected as "Untitled" is hidden automatically.
- An overlong title is truncated with `...`; note and event fields share the same header band.
- Event values and other numeric labels remove decimal places one by one, and keep their full width when the integer still does not fit.
- Fixed notes added in merged multi-line mode landing on the wrong judge line.
- Playback timing is more stable: pausing, resuming, and seeking no longer jump by about 52 ms, and starting playback establishes the picture lead over the output-latency window.
- Fixed the progress bar not reaching zero when dragged left: the pointer now maps to the painted track, so the track's left edge is the start instead of one pixel of song time, and the offset no longer grows with the song length.
- Fixed a paused seek reporting the display lead: an explicit seek now releases the picture lead, so a seek to the start reports exactly zero.
- Fixed number input step buttons widening to fit their step labels.
- Fixed the web "import chart" action only reporting that desktop is required: the welcome page and editor can now pick JSON, PEZ, or ZIP charts, parse them, and write them into the browser library, importing every chart an archive contains.
- Fixed a SQLite error when the browser library created a project (the insert supplied one value fewer than its columns), which also made web saves fail and blocked returning to the library or quitting after a save.
- Fixed browser-library projects failing to open: hosts without the framed chart stream now read the whole project directly.
- Save and return / save and quit now follow the save result, so a completed save always leaves the editor instead of being held back by a lagging dirty flag.
- Replaced the judge line's triangle marker so its direction stays readable at low opacity. The new marker is an equilateral triangle: its base sits on the judge line, its apex points along the line's normal, and a smaller equilateral triangle is cut out of the middle of that base so it splits into two feet. Unlike the old centred isosceles triangle whose centroid floated above the line, it still shows which line it belongs to and which way it faces when the line itself is fully transparent.
- The marker is a quarter smaller and now sits a quarter of its own height above the judge line instead of resting on it.
- The selected judge line's marker was missing entirely on the default GPU path. Its sprite was loaded from a directory that does not exist, and a missing source made the textured arrow give up its submission; with line numbers switched off the whole frame was skipped too. The marker now ships as an application resource and both paths draw it.
- The marker no longer ignores the theme colour. The sprite is a white alpha mask, and the old code set `fillStyle` before `drawImage`, which has no effect on an image, so both themes painted a white marker; it is now tinted with `--canvas-preview-line-selected`.
- The development server no longer affects developer mode. The developer section no longer opens with the build mode; every host, including the `npm run dev` browser loop, starts closed. Outside developer mode the related shortcuts do nothing: F3 does not open the performance monitor and the developer settings page stays hidden, until the host policy or ten activations of the About-page logo reveal the section.
