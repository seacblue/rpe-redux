---
"rpe-redux": patch
---

### 中文

**修复**

- 修复了不同 DPI 与宽高比下的窗口缩放逻辑。
- 工具栏、状态栏、检查器、侧栏和进度卡的默认尺寸现在跟随显示缩放比例；窗口移动到不同 DPI 的显示器时会立即更新，不再需要等待窗口尺寸变化。
- 面板拖到最小、最大或视口上限后，内部控件不再继续缩放或重排；检查器、进度卡等区域的拖动边界与绘制尺寸保持一致。
- 状态栏最小高度下调，并收紧其垂直内边距，底部栏可以压缩得更小。
- 进度卡宽度纳入显示密度和工具栏内容比例，拖动到内容下限时停止。

**改进**

- 工具栏、状态栏、检查器、侧栏和进度卡的默认尺寸缩小 25%（默认倍率为 0.75），面板内容和盒子一起缩小；版面滑块步进改为 0.01，默认值正好落在滑块刻度上。状态栏与侧栏的最小倍率同步下调，仍可继续压缩。
- 网页版在相同倍率下比桌面端大 25%。网页版和桌面端还会随窗口或页面尺寸连续等比缩放：以 1440×900 为基准，取宽度和高度比例中较小的一项，直接使用、不设上下限，没有断点跳变。

### English

**Fixes**

- Fixed window scaling across different DPI settings and aspect ratios.
- The toolbar, status bar, inspector, sidebar, and transport card now derive their default sizes from the display scale, and update immediately when the window moves to a display with a different DPI instead of waiting for a window resize.
- A panel held at its minimum, maximum, or viewport ceiling no longer keeps scaling or reflowing its contents; the inspector, transport card, and other regions now keep the drag bound and the painted box on the same number.
- The status bar's minimum height is lower and its vertical padding is tighter, so the footer can compress further.
- The transport card width now includes the display density and the toolbar's content scale, and stops at its content floor.

**Improvements**

- The toolbar, status bar, inspector, sidebar, and transport card now start 25% smaller than their authored sizes (the default scale is 0.75), with their contents shrinking with the boxes. The layout sliders step by 0.01 so the default sits on a real stop, and the status bar and sidebar minimums drop with their defaults so both can still compress.
- The web build paints 25% larger than the desktop app at the same scale. Both hosts now follow the window or page size directly and proportionally: the smaller of the width and height shares of a 1440×900 reference, used without a lower or upper band.
