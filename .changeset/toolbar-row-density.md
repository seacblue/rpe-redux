---
"rpe-redux": patch
---

### 中文

**修复**

- 修复 125% 等非整数显示缩放时工具栏两行之间出现过宽空隙的问题：面板内容现在与面板本身按同一倍率（用户尺寸 × 显示密度）缩放，多余的高度不再堆在行与行之间。状态栏、检查器和侧栏同理。
- 两行之间恢复一个明确的间隔，并随工具栏尺寸一起缩放，不再随可用高度挤压或拉开。
- 修复“简化渲染”图标不随工具栏缩放的问题：它原来是 CSS 条纹，尺寸写死不会缩放；现在改为图标集中统一的 PNG 遮罩，和其他按钮图标一样随倍率缩放。

### English

**Fixes**

- Fixed the toolbar rows drifting apart on displays that scale by a fraction such as 125%: a panel's contents now grow by the same factor as the panel itself (the user's size times the display's density), so the extra height no longer piles up between the rows. The status bar, inspector, and sidebar follow the same rule.
- The two rows keep one explicit gap that scales with the toolbar size, instead of being squeezed together or pulled apart by whatever height is left over.
- Fixed the simplified-rendering icon not scaling with the toolbar: it was a CSS stripe pattern with a fixed size; it is now a PNG mask from the shared icon set, so it scales like every other toolbar glyph.
