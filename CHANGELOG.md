# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.13

### 中文

**修复**

- 素材库音频预览不再绘制频谱柱状图，选中行与播放器不再使用亮色背景；音频详情标题恢复紧凑的内边距。
- 素材库面板激活且选中音频时，空格键切换该音频的播放与暂停，不再触发谱面播放。
- 桌面端可直接用外部编辑器打开项目素材库中的图片、音频和着色器，不再误报“外部编辑仅在桌面应用中可用”。
- 移除重命名素材时与当前素材类型无关的说明文字。
- 音符/事件的批量调节手柄不再占据整组区域：只有三个控制球接收指针，球之间的间隙可以直接落到时间线上。
- 正在放置 Hold 或事件时批量调节手柄自动隐藏，完成放置的点击不会再被手柄拦截；鼠标经过手柄时，时间线光标仍跟随指针。
- 全局禁用浏览器默认的文本拖拽与中键自动滚动，输入框内的文本选择保持可用。
- 颜色选择器直接输入十六进制颜色时，输入过程中不再实时改写颜色；只有离开输入框或按回车后才提交。
- 不含 alpha 通道的三位或六位十六进制颜色不再改变已有透明度，只有四位或八位颜色才更新 alpha。
- 从谱面库打开的分页谱面在增删改音符后，预览音效会按文档内容修订重建触发时间表：删除或移动的音符不再按旧位置发声，新增音符立即生效；分页加载只更新列表，不会打断已排队的音效。`chart.snapshot()` 也会在编辑后返回最新内容，不再返回首次读取的旧快照。
- 数字输入框的全选改为在松开鼠标时判定：原地点击仍然全选整个数值，按住拖选一部分文本时保留拖出的选区。
- 离开数字输入框时会清除浏览器记住的全选状态，再次进入时不会在按下的瞬间就全选。
- `Shift` + 点击不再被全选覆盖，扩展选区按原生行为生效。
- 预览按 Phira 的方式绘制负数长度的长条：头尾顺序正常、但音符或判定线速度为负时，只画头部和尾部两个端点，不绘制反向的本体。两个端点固定锚在自己的位置、沿判定线自身的轴向向外摆放，既不跟随反向跨度翻转 UV，也不被镜像到另一侧。
- 负速度的长条不再整条消失。遮罩线（`isCover`）过去只比较尾端是否落到线后，判定线转负速度把尾端推到线下方就会裁掉整条。现在只有头尾两个端点都落到判定线后才隐藏，尾部穿过判定线后仍会显示，并随负速度从下方升回线上。本体是否绘制也按实时采样跨度判断，长条中途转为负速度时同样只画两个端点。
- 拖动“多线窗口宽度”时，时间轴窗口在拖动过程中实时改变宽度，不再等到松开鼠标。
- 多线分栏下，窗口宽度与横向滚动范围按左右两侧概览条之间的绘图区计算，位于两端的窗口不再被概览条遮挡。
- 移除悬停音符时弹出的“该音符来自 X 号线，点击切换”提示，并移除已无作用的“悬停音符显示来源线”设置项。
- 调整时间偏移不再移动播放头：音频位置保持不变，谱面相对音频整体滑动，立即生效，也不再需要重新载入音频。偏移设为负值时谱面从音频起点之前开始，前导区按既有的静音预卷播放。
- 调整时间偏移后打击音效不再错位。偏移会移动整条触发列表相对音频时钟的位置，因此调度游标随之重新对齐；此前播放中调整会让播放头附近的音符重复发声，往返调整后打击音效与画面不同步。
- 修复时值列表在修改时间偏移、新增或删除时值点后不刷新的问题。分页谱面在编辑后复用同一个门面对象，列表因此收不到变化；现在它跟随会话的内容修订号重建。
- 复制粘贴音符或事件后，粘贴出的副本拥有独立标识；对副本执行镜像等按标识寻址的编辑不再作用到原件。
- 快捷键录制弹窗只显示当前正在重绑的那个按键，不再列出该命令的全部绑定；使用加号新增绑定时不再显示「当前绑定」。
- 修复单字符按键键帽内容未居中、右侧留出多余空白的问题。
- 时间轴的图层切换条和音符区域的横向导航按钮静止时保持 25% 透明度，鼠标靠近或键盘聚焦时才完全显示，不再始终遮挡编辑区域。
- 打开谱面时，音乐在加载阶段完成解码，进入编辑器后即可播放；波形仍在后台生成，生成完成只重绘，不再改变播放头位置。
- 首页选中谱面后，左侧详情卡改用原图封面，不再放大显示低分辨率缩略图；谱面库列表仍使用缩略图。
- 事件时间线在分页谱面编辑后不再沿用旧的事件范围：曲线上下限和灰色数值标签会跟随新的开始/结束值刷新。
- 选中事件不再额外叠一层黑色数值标签；普通标签已经显示时只保留一套数值，避免和曲线范围不一致。
- 事件检查器在数值输入框聚焦时继续发布；缓动预览、同组字段和其他检查器内容不再停住，只保留当前输入框的草稿。
- Bezier 控制点用滚轮改值会立即写入谱面。

**新增**

- 判定线输入框支持 `X:Y/Z` 步长范围（省略 `/Z` 时为 1，尾端包含），并可直接输入分组名；点击分组也会整组加入或移除。
- 新建或重命名分组时会静默剔除逗号与括号（`,`、`，`、`()`、`（）`），不再报错，分组名始终可以写进线号列表。
- 线号列表保持手写顺序：单条加入追加到末尾，大段加入先去掉列表内的重叠再追加，删除在原文位置切分，不再自动合并或排序。
- 多线编辑、工具栏线号框和分组点击共享同一份保序表达式；保存时仍写回 RPE 可读的数字范围。
- 时间偏移面板新增「对齐到横线」：点击后暂停播放、收起展开的检查器让时间轴显示出来，并提示操作方式；随后在时间轴上点击某条横线即可完成对齐。装填期间只高亮鼠标最近的那条横线（换成更醒目的蓝色），点击必须落在横线上才生效，并且不会触发音符的选中、拖动或放置。
- 底部状态栏在「Bug 反馈」左侧显示当前版本号。

**变更**

- 「添加 BPM」改名为「添加时值点」，与列表里编辑的单位一致。
- 事件数值输入改为按 Enter 或失焦提交，打字过程中不逐字改写谱面和预览；滚轮、方向键与加减按钮仍然立即提交。
- 缓动预览在曲线下方显示当前值域的上下限，数值改变后可直接看到边界变化。

**改进**

- 减少时间线绘制每个音符和事件时的重复检查与分配：仅在重叠选择器打开时查询悬停项，协作选择为空时跳过查找，并复用绘制参数对象。
- 优化预览区每帧的可见音符查询：判定线音符的空间索引增加前缀包络剪枝，典型谱面下查询耗时降低约 31%，完整可见性计算降低约 26%；密集谱面下分别降低约 30% 和 24%。查询结果与原有实现逐项一致。

### English

**Fixes**

- Stop drawing spectrum bars in the library audio preview, remove the bright selected-row and player backgrounds, and restore a compact inset for the audio detail title.
- Space toggles the selected library audio preview while the assets inspector is active instead of starting chart playback.
- Desktop builds can open images, audio, and shaders from project libraries in the external editor; the incorrect “external editing is available in the desktop app” notice is gone.
- Remove the asset-kind-specific rename hint from the rename dialog.
- Batch adjustment handles for notes and events no longer capture the whole group: only the three control balls accept pointer input, so clicks in the gaps reach the timeline.
- The handles hide while a Hold or event placement is pending, so the completing click is no longer intercepted; pointer movement over a handle keeps the timeline cursor current.
- The browser's native text drag and middle-click autoscroll are disabled globally while text selection inside inputs stays available.
- The colour picker no longer rewrites the colour on every hex keystroke; the typed value commits when the field loses focus or Enter is pressed.
- A three- or six-digit hex colour without an alpha channel keeps the existing transparency; only four- and eight-digit values update alpha.
- Hit sounds in paged library charts now rebuild their trigger list from the document content revision after note edits: deleted or moved notes no longer sound at their old times and new notes apply immediately, while line materialization only refreshes the list without cutting queued voices. `chart.snapshot()` also returns the current chart after an edit instead of the first cached snapshot.
- A numeric field now decides select-all when the button is released: an in-place click still selects the whole value, while dragging over part of it keeps the range the drag drew.
- Leaving a numeric field clears the full selection the browser remembers, so returning to it no longer selects everything on the press.
- A `Shift`-click extends the selection natively instead of being replaced by select-all.
- Preview renders negative-length Holds the way Phira does: when the head still precedes the tail in time but the note or line speed is negative, only the head and tail caps are painted. Each cap stays anchored at its own Hold anchor and grows outward along the line's own axis, so the reversed span neither turns its UVs over nor mirrors it to the other side.
- A negative-speed Hold no longer disappears entirely. On a covering line (`isCover`) the old test compared only the tail against the line, so a tail pushed behind the line by a negative speed culled the whole Hold. A Hold is now hidden only once both of its anchors are behind the line, so a tail that has crossed the line stays visible while it climbs back toward it. Body painting also follows the sampled span, so a Hold that turns negative partway through paints only its two caps.
- Dragging the multi-line window width resizes the timeline windows during the drag instead of waiting for the pointer to be released.
- In split multi-line layouts, the window width and horizontal scroll range are measured between the two overview strips, so windows at either end are no longer hidden underneath a strip.
- Remove the “From judge line X, click to switch” notice shown when hovering a note, along with its now-inert “Mark the source line when hovering a note” setting.
- Editing the chart offset no longer moves the playhead: the audio position stays put while the chart slides against it, applied immediately and without reloading the audio. A negative offset starts the chart before the audio, played as the existing silent lead-in.
- Hit sounds no longer drift after an offset edit. The offset moves every trigger against the audio clock, so the scheduler re-anchors its cursor; previously an edit in mid-playback replayed notes at the playhead, and a round trip left hit sounds out of sync with the picture.
- The timing list now refreshes after an offset edit and after adding or deleting a timing point. A paged chart reuses one facade object across edits, so the list never saw a change; it now rebuilds from the session's content revision.
- A pasted note or event now receives its own identity, so identity-addressed edits such as a mirror transform apply to the copy instead of the source object.
- The shortcut recording dialog now shows only the binding being rebound instead of every binding of the command; adding a binding no longer shows a current binding.
- Single-character key caps now center their content instead of leaving trailing space on the right.
- The timeline layer strip and the note-range navigation buttons now rest at 25% opacity and become fully visible when the pointer approaches or keyboard focus enters them, so they no longer cover the editing field at all times.
- Opening a chart decodes the music during the loading stage, so playback is available as soon as the editor opens; the waveform still builds in the background and only repaints when it finishes, without moving the playhead.
- The selected chart's detail card on the home page now uses the full-size cover instead of an upscaled low-resolution thumbnail; library cards still use the thumbnail.
- The event timeline no longer reuses the old lane range after a paged-document edit: curve bounds and the regular value labels now follow the new start and end values.
- A selected event no longer adds a second black value label over the regular one; the lane keeps one set of numbers that matches the curve range.
- The event inspector keeps publishing while a numeric field has focus, so the easing preview, sibling fields, and other inspector content no longer freeze; only the focused input keeps its draft.
- Wheel edits to Bézier control points now commit immediately.

**Added**

- The judge-line field accepts `X:Y/Z` step ranges (`Z` defaults to 1 and the end is inclusive) and folder names; clicking a folder adds or removes the whole folder.
- Creating or renaming a folder silently strips commas and parentheses, so every folder name can be written in the line list without an error.
- The line list keeps the authored order: a single line appends, a block strips its overlap from the list and appends, and a removal splices the affected range in place. Tokens are never merged or sorted.
- Multi-line editing, the toolbar line field, and folder clicks share one ordered expression; saving still writes the numeric range syntax native RPE reads.
- The offset panel gains **Align to a timeline line**: it pauses the transport, collapses an expanded inspector so the timeline is visible, and explains the gesture; the next click on a grid line completes the alignment. While armed, only the line nearest the pointer is emphasized in a brighter blue, the click must land on that line, and no note selection, drag, or placement runs.
- The bottom status bar shows the current version to the left of the Bug feedback link.

**Changed**

- "Add BPM" is now "Add timing point", matching the rows it creates.
- Numeric event values commit on Enter or blur instead of rewriting the chart and preview on every keystroke; the wheel, arrow keys, and step buttons still commit immediately.
- The easing preview prints the current value bounds under the curve, so a start or end change is visible at a glance.

**Improvements**

- Reduce the per-note and per-event bookkeeping in the timeline paint loop: the overlap hover state is queried only while the overlap picker is open, remote collaboration selections are skipped when empty, and the paint options object is reused instead of allocated per item.
- Optimize the preview's per-frame visible-note query: the judge-line spatial index now prunes with prefix envelopes, reducing the query itself by about 31% and the full visibility pass by about 26% on a typical chart, and by about 30% and 24% on a dense chart. Results are identical to the previous implementation.
