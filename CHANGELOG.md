# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.16

### 中文

**修复**

- 移除了加载谱面弹窗里的「已下载 … · …/s」一行。谱面通常从本地磁盘打开，那里的字节数其实是同一台机器读取自身的文件，标成下载并不成立；真正的网络传输仍由启动页展示。
- 谱面库读取元数据时不再把整份谱面解析成对象树，大型谱面保存阶段明显加快，内存占用大幅下降。
- 事件总数现在会把 `eventLayers` 与 `extended` 中的轨道一起计入；此前这种结构的谱面事件数一直显示为 0。
- 修复了导入谱面时提示「本地素材库无法完成此请求」的问题：流式提交的暂存目录改在谱面库旁边创建，不再依赖系统临时目录的写权限；系统临时目录仍作为回退。
- 提交会话创建失败时会把被拒绝的目录写入后端日志，不再只留下一个空白的 500。
- 修复了时间轴吸附放置把精确拍值转成浮点数、再按万分之一量化，导致 12 分格下音符与事件起始拍漂移的问题。1/12 放置现在保存为 `0:1/12`，移动到 1/4 后保存为 `0:1/4`，不再出现 `7499/30000`。
- 音符与事件放置、双点 Hold、剪贴板粘贴、BPM 时间点、曲线拾取、批量编辑的时长与克隆偏移、Shader 参数轨对齐等写回路径现在都保留 Beat 三元组，使用通分约分代替浮点往返。
- 修复了 Windows 安装包构建失败的问题：内置 FFmpeg 8.1.2 的下载地址已被上游移除，现改为使用发布者的 GitHub 镜像，文件内容与校验值保持不变。
- 修复了不同 DPI 与宽高比下的窗口缩放逻辑。
- 工具栏、状态栏、检查器、侧栏和进度卡的默认尺寸现在跟随显示缩放比例；窗口移动到不同 DPI 的显示器时会立即更新，不再需要等待窗口尺寸变化。
- 面板拖到最小、最大或视口上限后，内部控件不再继续缩放或重排；检查器、进度卡等区域的拖动边界与绘制尺寸保持一致。
- 状态栏最小高度下调，并收紧其垂直内边距，底部栏可以压缩得更小。
- 进度卡宽度纳入显示密度和工具栏内容比例，拖动到内容下限时停止。
- 禁止应用在更新或崩溃重启后自动打开谱面：重启、崩溃恢复、更新重启和刷新页面现在都停在谱面库，不再恢复上一次打开的谱面，相关设置项一并移除。命令行传入的谱面文件、文件关联、`rperedux://chart/<id>` 链接和显式谱面地址仍然会直接打开对应的谱面。
- 修复了渲染导出在 250%/300% 缩放下按 2× 封顶像素比降采样、Shader 层按 CSS 像素渲染导致成片模糊的问题；导出现在按所选分辨率逐层渲染。
- 修复了长谱面分页载入后导出可能丢失未加载判定线的问题；导出前会先完整物化谱面。
- 修复了变速导出时音视频时长不一致留下尾部纯音频或冻结末帧的问题，并避免 H.264 B 帧导致的帧序错误。
- 修正了 `bpmfactor` 的语义：谱面时间统一使用全局 BPM（以首个 BPM 为基准），`bpmfactor` 只影响该判定线 Hold 打击特效的脉冲频率；此前按拍号导出会与音符时间错位。
- 导出画面现在保持成片观感：音符完整不透明，视野回到标准构图，不再混入编辑器的作者态状态。

**新增**

- 扩展 API 增加 Surface、文件选择、包内资源、recipe 与 playback；扩展包支持本地文件夹/ZIP 安装，资源提供尺寸与 atlas 元数据。
- 跨谱面复制粘贴现在使用应用内剪贴板，不占用系统文本剪贴板；重启应用后也会恢复当前剪贴板内容。
- 时间轴中的剪贴板虚影预览使用当前 note/event 皮肤并以半透明方式显示，默认开启。
- 从其他实例或外部来源获取剪贴板内容时显示提示，并以 10 秒为间隔限流。

**扩展**

- 移除内置的 `builtin.pet` 桌宠包；桌宠改为可独立安装的扩展，不再随应用内置。
- 拖入扩展 ZIP 现在直接打开安装审阅对话框，并预加载该包；此前只提示「检测到扩展」，不会安装任何内容。

**改进**

- 工具栏、状态栏、检查器、侧栏和进度卡的默认尺寸缩小 25%（默认倍率为 0.75），面板内容和盒子一起缩小；版面滑块步进改为 0.01，默认值正好落在滑块刻度上。状态栏与侧栏的最小倍率同步下调，仍可继续压缩。
- 网页版在相同倍率下比桌面端大 25%。网页版和桌面端还会随窗口或页面尺寸连续等比缩放：以 1440×900 为基准，取宽度和高度比例中较小的一项，直接使用、不设上下限，没有断点跳变。
- 桌面端与网页版现在使用同一套默认界面尺寸：桌面端的工具栏、状态栏、检查器、侧栏和进度卡在相同窗口下增大 25%，与网页版一致。
- 版面滑块读数不变，仍表示相对创作尺寸的倍率。
- 对大谱面进行加载优化，优化音频加载与频谱生成的性能。
- 分页谱面在打开和导入时会先完成所有行物化，再进入编辑器；预览和时间线从首帧起就是完整谱面，索引中的总音符/总事件统计保持不变。
- 音频解码与谱面物化并行启动；可播放缓冲一就绪就立即启动波形和频谱 worker，不再等整张谱面读完再串行解码。
- 加载进度同时按已物化行和对象计数推进；首帧场景按帧预算分片编译并显示进度，密集谱面不会再长时间停在 80% 之后。浏览器行指纹由独立 worker 池并行计算，打开过程不再重复为每行计算对象摘要。
- 修复便携包中内置音符皮肤清单被 SPA 回退为 HTML、导致音符和判定线不显示的问题；预览可见性现在会从当前布局初始化并在区域切换时刷新。
- 修复分页行物化后复用只读空采样状态、导致 preview 绘制抛异常而只显示背景的问题。
- CRUD 提交只校验和哈希本次变更的判定线，不再全谱扫描负拍或对象；多行编辑的预览编译继续按帧预算分批完成。
- 导入采用 16MiB 的流式提交阈值，并按每个分块的字节数更新进度，导入进度条可以稳定走完最后 20%。
- 加快网页端首屏速度，实现字体子集化与延迟加载。
- 网页版启动时立即绘制启动界面，并在下载初始脚本与样式时显示进度和速度；主样式表改为非阻塞加载，缩短首次绘制时间。
- 编辑器、设置界面和扩展/Code Cell 管道改为按需加载；较大的界面 chunk 按功能自动拆分并保持在 500KB 以下，首屏脚本总量明显下降。
- 内置 CJK 字体改为 UI 子集加 unicode-range 分片（UI 0.21MiB，其余按需加载）；编辑器 Shell 挂载后先加载 UI 子集，用户输入的文字只请求对应码位分片，系统字体仅作加载前或缺字回退。

**皮肤功能对齐 Phira**

- 预览音符大小改为 Phira 的 `note_scale` 语义：默认 `1.0`，范围 `0.8`–`1.2`，旧像素值会自动换算。
- Phira 资源包对齐：同时音符按 `click_mh` / `click` 宽度缩放；支持 `holdKeepHead`、`holdRepeat`、`holdCompact` 与零高度头尾切片；打击特效按 `hitFxDuration`、`hitFxScale`、`hitFxRotate`、`hitFxTinted`、`hideParticles` 绘制。
- 内置皮肤按 Phira 默认资源包的尺寸与图集边界重新采样，画面仍为 Redux 自有素材。
- 事件条扩展固定读取包根的 `event_hold.png`，不再需要 `info.yml` 的 `eventHold` 字段。

**对齐 Phira 的皮肤尺寸并统一录制时间输入**

- 预览默认判定线的长度与线粗按 Phira 的 RPE 逻辑尺寸校准，同时保留 Redux 自有素材。
- 录制谱面范围固定使用开始时间和结束时间，移除拍数输入与模式切换。
- 浏览器端导入现在也能识别并转换 PEC 与官谱 JSON，普通 RPE JSON/PEZ 继续走原有导入路径。
- 工具栏溢出改为左右 chevron 控件，命中效果和程序化粒子在暂停或跳转时独立播放至结束。

### English

**Fixes**

- Removed the "Downloaded … · …/s" line from the chart-loading overlay. A chart usually opens from local disk, so those bytes describe the same machine reading its own files; the startup splash still reports real network transfer.
- The chart library reads metadata with one linear pass instead of decoding the whole chart, so saving a large chart is much faster and uses far less memory.
- The event total now counts the tracks inside `eventLayers` and `extended`; charts stored that way previously reported zero events.
- Fixed chart imports failing with "the local library could not complete the request": streamed commit staging now lives beside the chart library instead of depending on write access to the system temp directory, which remains the fallback.
- A rejected staging directory is written to the backend log when a commit session cannot start, instead of surfacing as an empty 500.
- Fixed snapped timeline placement converting a precise beat to a float and re-quantizing it over 1/10000, which drifted note and event starts at a 12-line division. A 1/12 placement now stores `0:1/12`, and moving it to 1/4 stores `0:1/4` instead of `7499/30000`.
- Note and event placement, two-click Holds, clipboard paste, BPM timing points, curve picks, batch-edit durations and clone offsets, and shader parameter-track alignment now keep the exact Beat triple and use common-denominator arithmetic instead of a float round trip.
- Fixed the Windows installers failing to build: the bundled FFmpeg 8.1.2 download had been withdrawn upstream, so it now comes from the publisher's GitHub mirror with the same bytes and checksum.
- Fixed window scaling across different DPI settings and aspect ratios.
- The toolbar, status bar, inspector, sidebar, and transport card now derive their default sizes from the display scale, and update immediately when the window moves to a display with a different DPI instead of waiting for a window resize.
- A panel held at its minimum, maximum, or viewport ceiling no longer keeps scaling or reflowing its contents; the inspector, transport card, and other regions now keep the drag bound and the painted box on the same number.
- The status bar's minimum height is lower and its vertical padding is tighter, so the footer can compress further.
- The transport card width now includes the display density and the toolbar's content scale, and stops at its content floor.
- The application no longer reopens a chart after an update or a crash restart: a restart, crash recovery, an update restart, and a page reload now all stop at the chart library instead of restoring the previous chart, and the related setting was removed. A chart passed on the command line, through the file association, a `rperedux://chart/<id>` link, or an explicit chart address still opens that chart.
- Fixed rendered exports being downsampled on 250%/300% displays because the host divided by the raw device pixel ratio while the canvas capped it at 2, and shader layers being rendered at CSS resolution; every layer now renders at the selected output resolution.
- Fixed paged charts dropping lines that were not loaded yet: export now materializes the full chart before cloning.
- Fixed speed-changed exports leaving a trailing audio-only segment or a frozen last frame when the soundtrack and frame stream disagreed, and prevented H.264 B-frames from reordering copied frames.
- Corrected `bpmfactor` semantics: chart time always follows the global `BPMList` anchored at the first BPM, while `bpmfactor` only scales the Hold hit-effect pulse rate on its line. Beat-based export ranges previously drifted against note times.
- Export now renders the game view: notes stay fully opaque, the camera returns to the standard framing, and editor-only authoring state is not baked into the video.

**Added**

- Extension APIs add Surfaces, file picking, packaged assets, recipes, and playback; packages install from local folders/ZIPs, and assets expose dimensions and atlas metadata.
- Cross-chart copy and paste now uses the app-private clipboard instead of the operating system text clipboard, and restores the current contents after restart.
- The timeline clipboard ghost preview uses the active note and event skins with translucent alpha and is enabled by default.
- Receiving clipboard contents from another instance or external source shows a rate-limited notice.

**Extensions**

- Removed the bundled `builtin.pet` companion package; the pet is now a standalone installable Extension rather than a built-in.
- Dropping an Extension ZIP now opens the install review directly with that package preloaded; previously it only announced "Detected Extension" and installed nothing.

**Improvements**

- The toolbar, status bar, inspector, sidebar, and transport card now start 25% smaller than their authored sizes (the default scale is 0.75), with their contents shrinking with the boxes. The layout sliders step by 0.01 so the default sits on a real stop, and the status bar and sidebar minimums drop with their defaults so both can still compress.
- The web build paints 25% larger than the desktop app at the same scale. Both hosts now follow the window or page size directly and proportionally: the smaller of the width and height shares of a 1440×900 reference, used without a lower or upper band.
- The desktop app and the web page now share one set of default chrome sizes: the desktop toolbar, status bar, inspector, sidebar, and transport card paint 25% larger at the same window, matching the web page.
- The layout slider readings are unchanged; they still express the factor of the authored size.
- Improved large-chart loading and the performance of audio loading and spectrum generation.
- A paged chart now materializes every line before the editor opens, so the preview and timeline see the complete chart from the first frame while the index keeps chart-wide note and event totals exact.
- Audio decoding starts beside line materialization, and the waveform and spectrum workers start as soon as the playable buffer exists instead of waiting for the whole chart to finish reading.
- Opening progress advances by both materialized lines and objects. The first scene compiles in bounded slices with visible progress, so dense charts no longer appear stuck past 80%; browser line fingerprints run in a separate worker pool and are not re-walked for object digests.
- Fixed the portable build serving the bundled note-skin manifest as the SPA HTML, which hid notes and judge lines; preview visibility now initializes from the current layout and refreshes when regions change.
- Fixed a frozen empty sample slot being reused after its paged line materialized, which made the preview draw throw and leave only the background visible.
- A CRUD commit validates and hashes only the lines it replaced instead of scanning the whole chart for negative beats or object identity; multi-line preview compilation still completes under a per-frame budget.
- Imports use a 16MiB streaming commit threshold and report byte progress per chunk, so the import bar reliably advances through its final 20%.
- Speed up the web first paint and ship the CJK font as a lazy-loaded subset.
- The web build now paints the startup screen immediately and reports the progress and speed of the initial script and stylesheet download; the main stylesheet no longer blocks the first paint.
- The editor shell, settings UI, and Extension/Code Cell pipeline now load on demand; larger interface chunks are split by feature and kept below 500 KB, which cuts the startup script payload.
- The bundled CJK font is now a UI subset plus unicode-range slices (0.21 MiB UI face, the rest on demand); the shell loads the UI face after mounting, user-entered characters request only their slice, and the system CJK face remains the loading or missing-glyph fallback.

**Skin feature parity with Phira**

- Preview note size now uses Phira's `note_scale`: `1.0` by default in the `0.8`–`1.2` range, with automatic conversion of stored pixel values.
- Phira respack parity: simultaneous notes scale by `click_mh` / `click`; `holdKeepHead`, `holdRepeat`, `holdCompact`, and zero-height cap slices are honoured; hit effects follow `hitFxDuration`, `hitFxScale`, `hitFxRotate`, `hitFxTinted`, and `hideParticles`.
- The built-in skin is resampled to Phira's default respack dimensions and atlas boundaries while keeping Redux's own artwork.
- The event-bar extension always reads the fixed package-root `event_hold.png`; the `eventHold` info.yml entry is gone.

**Align skin sizing with Phira and use time-only recording ranges**

- Calibrate the preview judge-line defaults to Phira's RPE logical dimensions while keeping Redux's own artwork.
- Recording chart ranges now always use start and end times; beat inputs and the mode switch are removed.
- Browser file imports now detect and convert PEC and official chart JSON while keeping the existing RPE JSON/PEZ path.
- Replace the toolbar overflow bar with left/right chevron controls, and let hit effects and procedural particles finish independently of pause or seeking.
