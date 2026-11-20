---
"rpe-redux": patch
---

### 中文

**修复**

- 修复了开发服务器对开发者模式的影响。开发者界面不再随构建模式自动打开，所有宿主（包括 `npm run dev` 的浏览器循环）都从关闭状态开始；在非开发者模式下，相关的快捷键将不会生效——按 F3 不会打开性能监视窗口，开发者设置页也不会出现，只有宿主策略或「关于」页对 logo 连续点击十次显露开发者界面之后，这些入口才会恢复。

### English

**Fixed**

- The development server no longer affects developer mode. The developer section no longer opens with the build mode; every host, including the `npm run dev` browser loop, starts closed. Outside developer mode the related shortcuts do nothing: F3 does not open the performance monitor and the developer settings page stays hidden, until the host policy or ten activations of the About-page logo reveal the section.
