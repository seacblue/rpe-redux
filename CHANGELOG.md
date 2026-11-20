# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.14

### 中文

**新增功能**

- 工具栏、状态栏、检查器、侧栏、进度卡可分别调整尺寸，内部按钮、文字、控件按同一倍率缩放。
- 自定义工具栏与侧边栏功能。
- 进度条下方新增纵向拉伸条，可在“编辑器 → 时间轴布局”中开关。
- 更好的节拍检测，噪声环境下相位稳定性提高。
- 新增“设置 → 播放 → 画面提前量（毫秒）”。

**改进**

- 工具栏单元格由 41px 调整为 36px。
- 工具栏超宽时使用真实水平滚动条。
- 多线编辑事件区顶部，每条判定线窗口顶部居中显示编号与名称。
- 桌面构建锁定 FFmpeg 与 Cloudflared 精确版本。

**修复**

- 修复播放开始时播放头跳动、暂停时判定线跳动、暂停后恢复播放红线抖动。
- 修复时间偏移后打击音效错位、播放中调整导致附近音符重复发声。
- 修复时值列表在偏移修改、增删时值点后不刷新。
- 修复多线合并视图放置音符后不立即显示，行范围缓存改为按每行音符数组重建。
- 播放中按 J 开关多线编辑、按 K 切换音符/事件模式会立即更新时间轴和检查器。
- 多选控制球跟随时间轴滚动、多线平移和纵向缩放。
- 多线分栏窗口宽度与横向滚动范围按概览条之间的绘图区计算。
- 按住 Z 准备拖拽不再触发左移/上一行；Z 拖拽 Hold 头时头边缘跟随鼠标所在行。
- 修复分页谱面编辑后事件时间线沿用旧范围、选中事件叠黑色数值标签、事件检查器聚焦时停止发布、Bezier 控制点滚轮改值不立即写入等问题。
- 采样浮层不再被自由相机层遮挡，引导线与浮动缓动面板可正常接收鼠标操作。
- 高亮辅助线直接决定吸附取值，XY 轴独立吸附并保持一致。
- 拖拽采样时辅助线保持高亮，完成后可直接重画替换。
- 采样浮动面板改用指针捕获拖拽；展开检查器保持在浮层层级。
- 时间轴图层切换条与音符横向导航按钮静止时保持 25% 透明度。
- 判定线输入框支持 X:Y/Z 步长范围与分组名，点击分组整组加入或移除。
- 音符检查器修改类型后打击音效立即跟随，类型下拉顺序调整为 Tap、Drag、Flick、Hold。
- 负长度 Hold 按 Phira 方式渲染。
- 移除悬停音符的“该音符来自 X 号线”提示及无用设置项。
- 素材库音频预览不再绘制频谱柱状图，空格键切换音频播放/暂停。
- 文件菜单“返回谱面库”改用统一保存询问窗口。

### English

**Features**

- The toolbar, status bar, inspector, sidebar, and transport card are sized separately, and the buttons, text, and controls inside them scale by the same factor.
- Customize toolbar and Customize sidebar.
- A vertical stretch bar below the progress bar, switched on or off under Editor → Timeline layout.
- Better beat detection, with steadier phase under noise.
- Settings → Playback → Picture lead (milliseconds).

**Improvements**

- Toolbar cells are 36px instead of 41px.
- A toolbar wider than the window scrolls under a real horizontal bar.
- Each judge-line window centers its number and name in the header of the multi-line event area.
- Desktop builds pin FFmpeg and Cloudflared to exact versions.

**Fixes**

- Fixed the playhead jumping at the start of playback, the judgement line jumping on pause, and the playhead jittering when playback resumes after a pause.
- Fixed hit sounds drifting after a time-offset change, and notes near the playhead repeating when the offset is adjusted during playback.
- Fixed the timing list not refreshing after an offset change or an added or removed timing point.
- Fixed notes placed in the merged multi-line view not appearing immediately; the range cache now rebuilds from each line's note array.
- Pressing J to toggle multi-line editing or K to switch its notes/events field during playback now updates the timeline and Inspector immediately.
- The batch control balls follow timeline scrolling, multi-line panning, and vertical zoom.
- Multi-line window width and horizontal range are measured between the overview bars.
- Holding Z to prepare a drag no longer triggers left-nudge/previous-line, and a Z Hold-head drag places the head on the pointer row.
- Fixed the event timeline keeping a stale range after editing a paged chart, a second dark value label on a selected event, the event inspector stopping while a field had focus, and a Bezier control point changed by the wheel not being written immediately.
- The sampler overlay is no longer covered by the free-camera pointer layer, so its guides and easing panel receive pointer input.
- A highlighted guide supplies the snapped value directly, with XY axes snapping independently.
- Guides stay highlighted while dragging, and a completed sample can be redrawn to replace it.
- The sampling panel drag uses pointer capture, and the expanded inspector stays on the floating rung.
- The timeline layer switch strip and note navigation buttons sit at 25% opacity until hovered or focused.
- The line field accepts X:Y/Z ranges and group names, and clicking a group adds or removes the whole group.
- Changing a note's type in the inspector updates its hit sound immediately, and the type dropdown now lists Tap, Drag, Flick, Hold.
- Negative-length Holds are rendered the way Phira draws them.
- Removed the hover note's source-line prompt and its now-unused setting.
- The asset library audio preview no longer draws spectrum bars, and Space toggles that audio.
- File → Return to chart library asks with the same save prompt as every other library trip.
