# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.12

### 中文

**修复**

- 将设置项中的自定义背景图片选择按钮内容居中显示。
- 修复带 `attachUI`（`pause`、`combo`、`score` 等）或缺失可选资源的谱面无法导入的问题：宿主不再把谱面目录内不存在的文件当作可读资源，导入时读不到的资源会跳过，而不是让整次导入以 `os error 2` 失败。
- 统一 modal 中标签字段的控件宽度，避免导出谱面字段例外拉伸。
- 审计并统一中文界面文案，修正保存提示、素材库、着色器、扩展、检查器、时间线、预览、撤销和历史回退等术语。
- 修复多选编辑历史通知显示原始 i18n key 的问题。
- 调整缓动字段的控件顺序，将 In/Out 放到缓动主体选择框之前，并保持主体选择框的宽度。
- 修复 I 键第二次按下无法退出播放预览、O 键在编辑页播放时无法只隐藏编辑页的问题。
- RPE 迁移重新导入时保留并补回判定线切换的滚轮手势，避免 Ctrl+滚轮上失效。
- 修复事件时间线两侧边界线的颜色与层级，使其使用统一的灰色边框并覆盖顶部参数标题。
- 修复按下 Esc 时意外打开设置界面的问题。
- 修复框选或划线选中物件后多选编辑面板没有立即打开的问题。
- 修复事件时间线右侧重复绘制黄色边界的问题。
- 合并音符时禁用多线窗口宽度设置，并让非合并多线窗口铺满时间线区域。
- 修复多线编辑切换事件层级后批量编辑失效，以及合法跨面板选择时拖拽控制器误消失的问题。
- 调整播放倍速选项顺序，使 1x 位于顶部、0.25x 位于底部。
- 修复后台自动保存进行中点击“保存并退出”后，保存完成却仍提示存在未保存修改的问题。
- 隔离普通保存、另存为、导出和后台备份的并发请求，避免不同保存意图复用错误结果。
- 修复更新包下载完成后更新按钮消失，以及重启确认弹窗可通过点击外部关闭的问题。
- 修复自由视角下预览白框不跟随缩放/偏移且溢出编辑器的问题；白框现在跟随相机投影并裁剪在预览视口内，白框外的物件和判定线仍可显示。
- 移除自由视角下铺满舞台的静态灰底，框外直接显示编辑器底色。
- 修复自由视角缩放或调整预览大小时打击粒子、命中特效脱离音符位置的问题；粒子扩散距离和尺寸现在随相机缩放。
- 修复曲线轨迹生成的白框在预览内被遮挡、只在预览外显示的问题；曲线编辑层恢复到预览之上，并移除曲线自己绘制的更亮白框，改用统一的预览白框。
- 修复曲线轨迹编辑与采样借用自由视角后，把普通自由视角保存的视角覆盖掉的问题：普通自由视角的缩放与平移会保留在舞台上，借用自由视角的编辑界面在关闭时恢复进入前的视角。
- 多线编辑时只在屏幕最左侧可见面板显示拍号数字，避免其他面板重复显示。
- 拖动事件区的一个控制点时，只移动当前控制点，另外两个控制点保持独立。
- 修复 Inspector 展开和收缩按钮的圆角与其他控件不一致的问题。
- 修复新建判定线的 Alpha 默认值为 0。
- 修复判定线删除后会残留引用的问题，并统一新建判定线的默认名称为 `Untitled`。
- 分页谱面新增、删除或重命名判定线和分组后，判定线树、工具栏判定线选择器和多行列表会立即同步；空分组也会显示。
- 导入或编辑资产后，资源树立即刷新，不再停留在旧内容。
- 新增判定线时自动展开所属分组并将新行滚入视野；新增分组后滚动到该分组。
- 分组左侧的折叠箭头不再绘制独立的悬停/按下底色，选中分组时跟随强调色。
- 判定线名称输入框按 Enter 立即提交。
- 修复多选编辑的 StartTime 和 EndTime 使用三段式 Beat 输入，并移除 Duration 与 Order 数值类型。
- 禁止音符和事件使用小于 0 的拍数，并在谱面错误面板中报告已有的负拍数。
- 持久化多线编辑的线号选择，移除线号显示中的活动线标记，将同屏事件窗数量改为最多 20 个的滑块，并统一事件轨道标题样式。
- 修复从谱面库或流式导入打开的谱面在编辑器中放键或放事件后预览区不刷新的问题，并让高频放置走增量更新。
- 修复预览区与时间线同时显示时，预览从隐藏切换到可见后画布停留在 1×1、不绘制谱面的问题。
- 修复旧版 RPE 快捷键导入后，`Ctrl+滚轮向上` 无法递增判定线、只有 `Ctrl+滚轮向下` 仍能递减的问题。
- 编辑器现在会在首次启动时补回迁移命令丢失的滚轮手势，并把旧版本“重置快捷键”写入的旧滚轮方向更新为当前默认值。
- 修复预览中选中判定线顶部三角形指示器颜色错误的问题，使其与选中判定线颜色保持一致。
- 修复设置 modal 在设置标题和“搜索设置项”之间切换焦点时背景亮度变化的问题。
- 修复负拍播放启动时拍数可能跳变的问题，并让播放中的时间轴红线保持在固定锚点。
- 修复启用 XY 绑定时修改事件起止时间不会同步到另一轴的问题。

**代码质量**

- 依赖更新不再被要求附带 changeset：Dependabot 提交的 PR 不涉及用户可见的改动，之前每个依赖 PR 都会因此出现一个红色的检查项。
- 新增 `npm run release:prepare`：一条命令同步五个版本文件、从待发布的 changeset 重建双语更新说明、删除已消费的 changeset 并自检，同时提供可在 Actions 里一键运行的「Release preparation」工作流。
- 新增「Pull request title」检查，确保 squash 合入后 main 上的提交标题符合约定式提交格式。
- 依赖升级按 patch/minor 分组为每周一个 PR；新增每周发布的依赖审计工作流。

**新增**

- 事件区按 Q 键使用与 R 键相同的放置流程，并放置钩定事件；钩定事件的首尾值保持相等且允许有长度。
- 时间轴按住 Z 键左键拖动事件或 Hold 的头部、右键拖动事件或 Hold 的尾部进行边缘编辑；普通边缘拖动与 Ctrl+左键拖事件头、Ctrl+右键拖 Hold 尾同样可用。边缘按鼠标所在行定位，右键拖动结束不会弹出菜单或打开编辑页。
- 为多选编辑增加事件类型下拉选择，可在混合事件选择中只编辑指定类型，并保持完整事件类型列表的固定顺序。
- 快捷键现在支持多个非装饰键同时按住，例如长按 `E` 再右键，或 `Ctrl+E+右键`。
- 鼠标左右中键、侧键与滚轮方向在快捷键提示中改用固定内联图标，不再受主题影响。

**改进**

- 桌面构建在打包时解析并校验 FFmpeg 与 Cloudflare Tunnel 的最新上游发布版本，不再固定旧版本：视频导出随附最新版 FFmpeg，联机大厅随附最新版 Cloudflare Tunnel 客户端，下载仍对照上游公布的 SHA-256 校验；新增 `npm run deps:check` 可在不下载大文件的情况下查看最新版本与当前已内置版本。
- 统一判定线树与资源树的子项行距，移除多选编辑中的冗余批量提示。
- 多线编辑的「同屏事件窗数量」改为「多线窗口宽度」：改用 0.01 到 1、0.01 分度的滑块，按比例缩放每个窗口的宽度；同屏显示的窗口数量由窗口宽度决定，不再受数量上限限制。默认值 0.5，此时同屏正好对齐 3.5 个窗口。音符与事件两种多线区域共用同一宽度，窗口间距也按宽度等比缩放。
- 快捷键冲突只在作用域可能同时生效时报告；编辑器和模态框、绘制表面等不重合的作用域不再误报。
- 冲突的快捷键键帽使用 urgent 边框与红色 inset 提示，并按具体按键而不是整条命令标记。

### English

**Fixes**

- Center the custom background image picker content in settings.
- Fix charts that name `attachUI` UI bindings (`pause`, `combo`, `score`, and the like) or missing optional resources failing to import: the host no longer advertises non-existent in-folder files as readable resources, and an unreadable resource is skipped instead of failing the whole import with `os error 2`.
- Keep modal labelled-field controls at the shared width instead of stretching the export field.
- Audit and unify Chinese UI copy for save notices, the asset library, shaders, extensions, the inspector, timeline, preview, undo, and history navigation.
- Fix multi-edit history notices displaying the raw i18n key instead of the localized operation label.
- Reorder the easing field so In/Out appears before the easing family selector while keeping the family selector wider.
- Make the I key leave playback preview and pause on its second press, and make O hide the editor without stopping an in-editor playback.
- Preserve and restore wheel gestures for judge-line navigation when re-importing RPE settings, so Ctrl+wheel up keeps stepping lines.
- Fix event timeline edge lines so both layouts use the shared gray border styling and keep the edges above the parameter headers.
- Prevent Escape from opening the settings screen.
- Open the multi-edit Inspector immediately after selecting objects with a marquee or sweep.
- Remove the duplicate yellow boundary drawn at the right edge of the event timeline.
- Disable the multi-line window width control for merged notes and let split multi-line windows fill the timeline area.
- Keep multi-line batch edits usable after switching event layers, and keep drag controls visible for valid selections on other panels.
- Order playback-rate options with 1x at the top and 0.25x at the bottom.
- Fix “Save and Exit” reporting unsaved changes when a background backup was already in progress.
- Keep regular saves, Save As, exports, and background backups from sharing results across different persistence intents.
- Keep the update button visible until the downloaded package's restart choice is made, and prevent the restart prompt from closing when its scrim is clicked.
- Fix the free-camera chart frame not following zoom/pan and spilling outside the editor; the frame now follows the camera projection and is clipped to the preview viewport while objects and judge lines beyond the frame remain visible.
- Remove the stage-wide static grey backdrop in free camera so the editor base shows outside the projected frame.
- Fix hit particles and hit effects drifting away from notes when the free-camera zoom or preview size changes; burst travel and size now scale with the camera.
- Fix the curve trajectory frame being hidden inside the preview and only visible outside it; the curve editing layer now sits above the preview, and the curve's brighter duplicate frame is removed in favor of the shared preview frame.
- Fix the curve trajectory editor and sampling overwriting the free camera view saved by the standalone mode: the standalone zoom and pan stay on the stage, and a surface that borrows the camera restores the view it found when it closes.
- Show beat labels only in the leftmost visible panel during multi-line editing instead of repeating them across every panel.
- Keep the other event control points stationary when dragging one control point.
- Match the Inspector expand and collapse button radius to the other controls.
- Set the default alpha of newly created judge lines to 0.
- Remove stale judge-line selections after deletion and use `Untitled` for every newly created judge line by default.
- Sync the judge-line tree, toolbar picker, and multi-line list immediately after adding, deleting, or renaming lines and groups in a paged chart; empty folders are listed too.
- Refresh the asset tree immediately after importing or editing assets instead of leaving stale rows.
- Expand a newly created line's folder and reveal the new row; reveal a newly added folder.
- Stop the folder disclosure chevron from painting its own hover/press fill and tint it with the folder selection instead.
- Commit the line name field on Enter.
- Use three-part Beat inputs for StartTime and EndTime in multi-edit, and remove the Duration and Order field types.
- Reject negative beats for notes and events, and report existing negative beats in the chart issues panel.
- Persist multi-line editor line selections, remove the active-line marker from line labels, replace the event-window count with a slider capped at 20, and align the event-track heading with the shared section style.
- Refresh the preview after notes or events are placed or undone in a chart opened from the library or a streamed import, with incremental updates for rapid placement.
- Repaint the preview underlay after it becomes visible alongside the timeline instead of leaving a 1x1 canvas.
- Fix the selected judge-line triangle indicator using the wrong colour so it matches the selected judge line.
- Keep the settings modal background brightness stable when focus moves between the dialog and its search field.
- Fix negative-beat playback handoff jumps and keep the timeline playhead anchored during playback.
- Synchronize the other axis' event start and end times when XY binding is enabled.

**Code quality**

- Dependency updates no longer need to carry a changeset: a Dependabot pull request changes no user-visible behavior, and every one of them used to show a failing check.
- Add `npm run release:prepare`: one command syncs the five version files, rebuilds the bilingual release notes from the pending changesets, deletes the consumed files, and validates the result, together with a **Release preparation** workflow that runs it from the Actions tab.
- Add the **Pull request title** gate so the squashed commit subject on `main` follows the conventional commit format.
- Group dependency upgrades into one weekly pull request per ecosystem, and add a weekly dependency audit workflow.

**Added**

- Use the same placement flow for Q as for R in the event area, with Q creating a hook event whose values stay locked while its span may have length.
- Hold Z and drag an event or Hold head with the primary button, or an event or Hold tail with the secondary button, to edit timeline edges; plain edge drags and Ctrl+left on an event head or Ctrl+right on a Hold tail also work. Edges follow the pointer row, and a right-drag release opens no menu or editor page.
- Add an event type selector to multi-edit so mixed event selections can edit one chosen type while keeping the complete event list in a stable order.
- Shortcuts can now hold several non-modifier keys together, such as holding `E` and right-clicking, or `Ctrl+E+right-click`.
- Mouse left/middle/right, side buttons, and wheel directions draw as fixed inline icons in shortcut chips instead of theme-dependent glyphs.

**Improvements**

- Desktop builds now resolve and verify the newest upstream FFmpeg and Cloudflare Tunnel releases while packaging instead of pinning an old version: video export bundles the latest FFmpeg and the collaboration tunnel the latest Cloudflare Tunnel client, every download is still checked against the checksum the publisher ships, and the new `npm run deps:check` reports the latest and staged versions without downloading the archives.
- Align row spacing in the judge-line and asset trees, and remove the redundant multi-select batch banner.
- Replace the multi-line "same-screen event-window count" with "Multi-line window width": a 0.01 to 1 slider in 0.01 steps that scales each window's width, so the number of windows on screen follows from their size instead of a count cap. The default 0.5 aligns three and a half windows across the timeline. The note and event multi-line areas share the same width, and their gaps scale with it.

**Fixed**

- Fix `Ctrl+Wheel Up` no longer increasing the judge line after an older RPE hotkey import, which left only `Ctrl+Wheel Down` decreasing it.
- The editor now restores the wheel gesture a migrated command lost on the first launch, and updates the old wheel directions a previous Reset wrote to the current defaults.

**Improved**

- Shortcut conflicts are reported only when their scopes can be active at the same time; disjoint scopes such as editor and modal, or editor and a drawn surface, no longer raise false conflicts.
- A conflicting key cap uses the urgent border and a red inset ring, and the editor marks the specific binding rather than every binding of the command.
