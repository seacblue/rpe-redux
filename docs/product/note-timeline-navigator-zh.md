# Note timeline 横向归位导航（设定稿）

- 状态：讨论稿，推荐方案已标出
- 日期：2026-11-15
- 范围：音符时间线的多线横向浏览，不改变谱面数据
- 相关原型：[note-timeline-navigator.html](../prototypes/note-timeline-navigator.html)
- 相关示意图：[主方案](./note-timeline-navigator.svg)、[状态图](./note-timeline-navigator-states.svg)

## 1. 结论先行

在 **note timeline 的底部增加一条只在必要时出现的横向导航 rail**：

- 左右各一个按钮，点击后按“一个判定线面板的 stride”移动，并自动吸附到面板边界。
- 当左侧仍有被裁切的判定线面板时，在 note timeline 的左内边缘显示一条短白色提示条；右侧同理。
- 中间显示当前可见的判定线范围，例如 `0–2 / 8`，帮助用户理解“当前移动的是判定线面板，不是歌曲时间”。
- rail 只在 **多线、分屏（非合并音符）且确实存在横向溢出** 时出现；单线、合并音符、所有面板刚好可见时完全不占空间。
- 现有左右竖向 overview strip 继续只负责歌曲时间定位、密度/历史提示；不把它改造成横向面板滚动条。

推荐主方案的详细图解见 [note-timeline-navigator.svg](./note-timeline-navigator.svg)。交互原型提供三个结构差异明显的方案，推荐 `?variant=a`：

- A：底部按钮 + 边缘白条（推荐，兼顾发现性和画布空间）。
- B：底部 mini-map（信息最完整，但更重）。
- C：悬浮 reveal 控制（最省空间，但发现性较弱）。

## 2. 已有实现提供的事实

这不是重新发明一套横向布局。`origin/main` 已经具备以下基础：

1. `TimelineViewport.panelLayout()` 根据选中的判定线数量、可见窗口数量和 note gap 计算面板宽度与间距。
2. `viewportOffset()` 计算并 clamp 横向 offset；`panMultiLine()` 已支持空白区拖拽平移。
3. `multiLineScroll` 已按 `notes/events` 分开保存，并在 workspace session 中恢复。
4. `syncMultiLineChrome()` 已把 `visible / max / value` 发布到 `multiLineScrollState`；这正好可以作为底部 rail 的状态源。
5. 现有 `.timeline-note-density` 与 `.timeline-history-strip` 位于时间轴左右两侧，按歌曲秒数上下映射；它们不是判定线 panel 的横向范围。

因此，本需求的最小正确切入点是“补齐 chrome 和动作”，而不是改 note 的投影、命中测试或时间坐标系统。参考代码：

- [`timelineGeometry.ts`](../../src/frontend/screens/editor/workspace/timeline/viewport/timelineGeometry.ts)
- [`multiLineChrome.ts`](../../src/frontend/screens/editor/workspace/timeline/multiLine/multiLineChrome.ts)
- [`multiLineScrollBinding.ts`](../../src/frontend/screens/editor/workspace/timeline/multiLine/multiLineScrollBinding.ts)
- [`multiLinePresentation.ts`](../../src/frontend/screens/editor/workspace/timeline/multiLine/multiLinePresentation.ts)
- [`TimelineCanvases.tsx`](../../src/frontend/screens/editor/workspace/timeline/surface/TimelineCanvases.tsx)
- [`timeline.less`](../../src/frontend/screens/editor/workspace/timeline/surface/timeline.less)

## 3. 用户问题与设计目标

### 用户要解决什么

多线编辑时，一个 note panel 代表一条判定线；选中的判定线多于当前宽度能容纳的数量后，后面的 panel 在右侧被裁切。用户需要知道：

- 还有没有 panel 在左边或右边。
- 点击一次按钮会移动多少。
- 当前看到的是哪几条判定线。
- 这条控制是移动歌曲时间，还是移动判定线 panel。

### 目标

- 不覆盖 note，避免和选择、拖拽、hold 调整发生冲突。
- 与现有 `panelWidth / panelGap / panelStride / max` 使用同一套几何值。
- 单线编辑不增加任何视觉噪声；没有溢出时不留下空白。
- 键盘、鼠标、已有空白区拖拽得到同一个 offset 结果。
- 控件在窄窗口和高密度多线选择下仍然可理解。

### 非目标

- 不移动 chart time / playhead，不改变 `origin`。
- 不创建新的 note 数据、不写入编辑历史。
- 第一版不增加独立的水平缩放滑块。
- 不把左右竖向 overview strip 变成 panel navigator。

## 4. 状态模型

### 4.1 是否显示 rail

设 `area = notes`，由同一帧布局计算：

```text
showRail = session.multiLineActive
        && session.multiLineMode === "notes"
        && session.notesMode === "multi"
        && chrome.max > 0
```

其中：

- `notesMode === "multi_merged"` 时只有一个合并 panel，`panelCount()` 为 1，rail 隐藏。
- `chrome.max` 是 `totalPanelWidth - canvasWidth`，不要用“选中判定线数量 > 1”直接判断，因为两个 panel 也可能刚好 fit。
- note area 被隐藏、切换到 events、离开多线模式时，rail 立即收起，canvas 恢复原高度。

### 4.2 当前滚动状态

建议把现有 snapshot 扩展为：

```ts
interface MultiLineScrollSnapshot {
  visible: boolean;
  max: string;
  value: string;
  step: string;
  firstPanel: string;
  lastPanel: string;
  panelCount: string;
}
```

`step` 使用当前 note 的 `panelStride(width, "notes")`。`firstPanel/lastPanel` 来自 `visiblePanelRange()`，只用于文案和可访问性，不参与第二套布局计算。

### 4.3 左右白条的判定

```text
hasLeftOverflow  = value > 0
hasRightOverflow = value < max
```

使用一个很小的 epsilon（建议 `0.5px`）避免浮点误差导致两端闪烁。白条不是可点击控件，也不代表“有 note”；它只代表还有判定线 panel 未出现在视口内。

| 状态   | 左白条 | 右白条               | 左按钮   | 右按钮   |
| ------ | ------ | -------------------- | -------- | -------- |
| 起点   | 隐藏   | 显示（若 `max > 0`） | disabled | enabled  |
| 中间   | 显示   | 显示                 | enabled  | enabled  |
| 终点   | 显示   | 隐藏                 | enabled  | disabled |
| 无溢出 | 隐藏   | 隐藏                 | 不渲染   | 不渲染   |

白条建议使用 `var(--foreground)` 或主题前景色，而不是硬编码 `#fff`；默认不透明度约 `0.48`，滚动、hover、focus 时提升到 `0.9`。

## 5. 交互规格

### 5.1 底部 rail

推荐结构：

```text
┌──────┐   0–2 / 8   ┌───────────────┐   ┌──────┐
│  ◀   │              │  ··· viewport │   │  ▶   │
└──────┘              └───────────────┘   └──────┘
```

实际第一版可压缩成 `左按钮 + 范围文案 + 右按钮`，中间 mini-map 只保留为可选增强；不要让 rail 变成第二条复杂时间轴。

- rail 高度：`28px`，使用设计 token；只在 `showRail` 时占位。
- 左右按钮触控/点击区域：最小 `32 × 24px`。
- 按钮移动到 `snap(value ± step)`；最后一段不足一个 step 时直接到 `max`，所以终点永远能一次到达。
- 连续按住不做自定义加速，浏览器按钮的重复行为足够；若后续需要加速，应统一放入 action 层而不是组件内计时器。
- 点击 rail 不改变 active line，只改变横向 viewport；active line 的高亮 panel 不应被重置。

### 5.2 键盘与辅助功能

- 只有按钮获得焦点时，`ArrowLeft/ArrowRight` 才触发 rail；不要全局抢占 timeline 的左右键语义。
- `Home` 到 `0`，`End` 到 `max`，同样只在 rail 或其范围控件获得焦点时生效。
- 左右按钮使用明确的 `aria-label`：`向左移动判定线面板` / `向右移动判定线面板`。
- rail 使用 `role="group"`，范围文案使用 `aria-live="polite"`，避免每次拖拽都读屏；按钮 disabled 时要保留可理解的 tooltip。
- 文案不要写成“上一页/下一页”，因为这里移动的是判定线 panel，不是时间页。

### 5.3 与空白区拖拽的关系

现有多线空白区拖拽继续保留。拖拽结束后：

- `value` 由同一 `viewport.multiLineViewportOffset()` 读取并 clamp。
- 白条与范围文案即时更新。
- 不需要把拖拽强制吸附；只有按钮动作吸附，保证精细拖拽仍然可用。

## 6. 多线编辑下的表现

### 非合并音符（推荐显示）

每条判定线一个 panel，按 `targetLineIndices` 的顺序从左到右排列。rail 的范围文案对应“当前可见 panel 的索引”，例如：

- `0–2 / 8`：当前看到第 0、1、2 个 panel，共 8 个。
- 若希望直接展示判定线号，可在第二阶段改成 `线 0–3 / 共 8 条`；第一版优先使用 panel 索引，避免选中顺序不连续时产生误导。

活动判定线仍由现有高亮/透明度规则表达；横向 rail 不再叠加一套颜色编码。

### 合并音符

合并模式把多个判定线绘制到一个 panel，不能继续使用“横向浏览 panel”的心智模型，因此：

- 不显示 rail。
- 不显示左右白条。
- 保留已有的判定线号显示设置，作为来源识别。

### 事件多线

第一版只在 note timeline 上落地，但状态和 action 应继续以 `area: "notes" | "events"` 设计。这样未来切换到 events 时可以复用同一 rail，而不会把 notes 专属判断散落到几何层。

## 7. 缩放与响应式规则

这里的“缩放”必须拆开看：

1. **时间纵向缩放**：继续由现有 timeline zoom 控制。rail 在 canvas 外部，固定 `28px`，不随纵向 scale 变高或变矮。
2. **panel 横向尺寸**：继续由 `panelLayout()` 的 `visibleCount / panelWidth / panelGap` 决定。按钮 step 永远读取实际 `panelStride`，不写死像素。
3. **窗口缩窄或选中更多判定线**：`max` 变大后保留当前 offset，再 clamp；如果当前 active panel 不再可见，应把 active panel 调整到最近可见边界，并让白条/文案随新值更新。
4. **浏览器缩放 / 高 DPI**：按钮与白条使用 CSS 尺寸，canvas 内部继续走现有 device-pixel-ratio 流程，不混用 canvas 像素与 CSS 像素。

第一版不额外增加“水平缩放”按钮。否则用户会同时面对时间缩放、panel 宽度缩放、窗口布局三套尺度，容易把“看更多判定线”和“看更长歌曲时间”混淆。若未来真的需要水平缩放，应在 rail 中明确标为“每屏 panel 数”，而不是使用放大镜图标。

## 8. 渐进式出现与提示

推荐做 **渐进式对比度**，而不是渐进式改变布局：

1. 没有溢出：完全不渲染，不留 28px 空白。
2. 有溢出但 idle：rail 保留，按钮与文案使用低对比度；白条约 `0.48` 不透明度，始终可见。
3. pointer 进入 note timeline 底部 64px、点击按钮、发生空白区横向拖拽、或键盘 focus：rail 和白条提升对比度，约 `1.2s` 无输入后回落。
4. 用户第一次进入“多线 + 非合并 + 有溢出”状态时，显示一次非阻塞提示：

   > 多线音符可以横向浏览；使用时间轴底部箭头，或拖动空白区域移动判定线。

提示只按会话/设置记忆一次，不要在每次切换判定线时重复弹出。按钮 tooltip 负责即时解释：`向左移动一组判定线`、`向右移动一组判定线`。

## 9. 错误与边界

- `max <= 0` 时不允许按钮事件触发；不要让 UI 依赖 disabled 之后的 action 防御。
- panel 数量变化、退出多线、切换 notes/events 后，先 clamp 再发布 snapshot，避免短暂显示错误的白条。
- `width <= 0` 或 canvas 尚未完成 layout 时，snapshot 暂时为 `visible: false`；第一次有效 resize 后再显示。
- 数据加载、音频加载、无谱面状态只影响 timeline 是否可见，不应制造一个“看起来可移动但没有内容”的空 rail。
- 播放时不自动跟随横向 panel；播放头的纵向移动与判定线 panel 的横向位置是两个独立状态。

## 10. 推荐实现拆分

建议新增一个纯 React chrome 组件，例如 `TimelineMultiLineNavigator.tsx`，放在 `timeline/multiLine/`：

1. 从 `multiLineScrollState.snapshot` 订阅 `visible/max/value/step/firstPanel/lastPanel`。
2. 调用 `multiLineScrollState.actions`，不要在组件里直接改 `TimelineViewport.multiLineScroll`。
3. 在 `multiLineChrome.ts` 计算并发布 `step` 与可见 panel 范围。
4. 在 `multiLineScrollBinding.ts` 增加 `moveByPanel(direction)` / `moveToEdge(edge)`，复用 `viewportOffset` 与 `panelStride`。
5. 在 `Editor.tsx` 或时间轴 surface 末尾挂载 rail，让 `.canvases` 的高度由 rail 以外的布局自然计算；不要把按钮叠加在 canvas 上。
6. 在 `timeline.less` 只负责布局、边缘白条和状态样式；颜色、间距、圆角来自 design token。
7. 英文与中文 i18n 同时添加按钮、tooltip、范围文案和一次性提示；诊断错误仍保持英文。

建议测试：

- `max=0 / value=0 / value=max` 的按钮与白条状态。
- `panelStride` 变化后按钮仍到达正确边界。
- 多线非合并、合并模式、events 模式之间的显示条件。
- resize、增加/移除判定线、session restore 后的 clamp 与范围文案。
- 鼠标拖拽、按钮、Home/End 三种入口最终得到同一个 offset。

## 11. 验收标准

- 单线编辑截图与现状相比没有新增控件或空白。
- 多线非合并且存在溢出时，note timeline 底部出现 rail；按钮可达、可读、可聚焦。
- 起点只显示右白条，终点只显示左白条，中间两条都显示；白条不与 note 内容重叠到无法辨认。
- 点击右按钮后至少能看到下一个 panel；点击到尾部时不会出现半个无法解释的“死区”。
- rail 不改变当前歌曲时间、播放头、active line 或编辑历史。
- 合并音符时 rail 和白条都不出现。
- `Alt+Wheel` 的时间缩放行为不受影响，现有空白区拖拽仍可平移。
- 退出多线或切换到 events 后，note rail 立即消失且布局回收高度。

## 12. 推荐方案与取舍

我推荐 **A：底部按钮 + 两侧白条 + 范围文案**。它直接回答“能不能继续向左/右看”和“现在看到哪几条线”，又不把已有按时间工作的竖向 overview strip 混在一起。B 适合未来需要大量判定线浏览的高级模式；C 适合空间极端紧张的场景，但不应作为第一版，因为用户第一次进入多线编辑时很难发现它。
