---
"rpe-redux": patch
---

### 中文

**修复**

- 颜色选择器直接输入十六进制颜色时，输入过程中不再实时改写颜色；只有离开输入框或按回车后才提交。
- 不含 alpha 通道的三位或六位十六进制颜色不再改变已有透明度，只有四位或八位颜色才更新 alpha。

### English

**Fixes**

- The colour picker no longer rewrites the colour on every hex keystroke; the typed value commits when the field loses focus or Enter is pressed.
- A three- or six-digit hex colour without an alpha channel keeps the existing transparency; only four- and eight-digit values update alpha.
