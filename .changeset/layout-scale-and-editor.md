---
"rpe-redux": minor
---

### 中文

**新功能**

- 工具栏、状态栏、检查器、侧栏和右上角进度卡的尺寸都可以单独调整，界面会按同一倍率缩放其中的按钮、文字与控件，不再只是拉长轨道。
- 在「设置 → 通用 → 界面 → 版面尺寸」中可以调节各区域的倍率；进度卡还可以直接拖动它左侧的分隔条调整宽度，双击恢复默认。
- 版面尺寸会跟随显示器像素密度补偿：把窗口移到更细腻的屏幕上时，会保持原本的视觉大小。
- 新增「自定义工具栏」与「自定义侧边栏」：打开后只有对应的一条工具栏或侧边栏被高亮，其余界面变暗。右侧列出尚未放置的指令，按来源扩展分组；从列表拖到工具栏即可添加，拖动条目可以排序、换行或移除，拖回列表或右键选择「移除」即删除。分隔线同样可以放置、移动和删除。
- 工具栏超出宽度时改用真实的水平滚动条，两行共享同一个滚动位置，较短的一行会自动补足滚动范围。

**改进**

- 工具栏按钮排布更紧凑，单元格由 41px 调整为 36px，同样宽度能放下更多指令。
- 自定义阶段中，分隔线悬停时会高亮，便于确认拖动位置。

**修复**

- 进度卡内的进度条与读数会随工具栏高度一起缩放，缩到最小倍率时不再被裁切。
- 侧边栏的滚动条不再占用布局宽度，条目始终居中，滚动条直接贴在界面最右侧，且不再显示上下箭头。
- Alt+滚轮调整时间轴纵向缩放时，数值连续变化，不再只在首尾跳变；纵向拉伸条的轨道可以完整包住圆球，并随界面缩放。

### English

**Features**

- The toolbar, status bar, inspector, sidebar, and transport card each carry their own size, and the interface scales the buttons, text, and controls inside them rather than only stretching the track.
- Settings → General → Interface → Panel sizes adjusts each region; the transport card can also be resized by dragging the seam on its leading edge, with a double click to restore the default.
- Panel sizes compensate for the display's pixel density, so a profile keeps its authored visual size when the window moves to a denser screen.
- Added Customize toolbar and Customize sidebar: only the toolbar or the rail being arranged stays lit while the rest of the interface dims. The list beside it holds the commands that are not placed yet, grouped by the Extension that contributes them; dragging one onto the bar adds it, dragging an item reorders it, moves it between rows, or removes it, and dropping it back on the list or choosing Remove from its context menu deletes it. Dividers can be placed, moved, and removed the same way.
- A toolbar wider than the window now scrolls under a real horizontal bar; both rows share one scroll position, and the shorter row is padded so it scrolls to the same place.

**Improvements**

- Toolbar buttons are denser: a cell is 36px instead of 41px, so more commands fit in the same width.
- A divider highlights under the pointer while the toolbar is being arranged, so the drop position is visible.

**Fixes**

- The scrubber and readouts inside the transport card scale with the toolbar height and are no longer clipped at the smallest size.
- The sidebar scrollbar no longer takes layout width: entries stay centred, the bar hugs the right edge, and it has no stepper arrows.
- Alt+wheel vertical zoom now changes the scale continuously instead of jumping between two values, and the vertical stretch rail is tall enough to hold its thumb and scales with the interface.
