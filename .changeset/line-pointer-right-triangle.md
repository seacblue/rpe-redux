---
"rpe-redux": patch
---

### 中文

**修复**

- 更换判定线的三角形指示标记，在低透明度下更好辨认方向。新标记是等边三角形：底边贴合判定线、尖端沿判定线法线朝上，底边正中再挖掉一个小的等边三角形，底边因此分成两只脚；相比原先重心浮在线之上的等腰三角形，即使线条本身完全透明，也能看出它在哪条线上、朝哪个方向。
- 标记缩小至原来的四分之三，并沿法线抬离判定线，留出自身高度四分之一的间距，不再贴着线放置。
- 选中判定线时，预览里的指示标记在默认的 GPU 绘制路径上完全不显示。贴图按一个不存在的目录加载，取不到时纹理分支会直接放弃这次提交；关闭「显示判定线编号」后连整帧都会被跳过。现在标记作为应用自带资源随安装包发布，两条绘制路径都会画出它。
- 标记不再被主题色忽略。贴图是白色透明蒙版，原先用 `fillStyle` 上色对 `drawImage` 无效，深色与浅色主题都会画出白色标记；现在按 `--canvas-preview-line-selected` 着色。

### English

**Fixed**

- Replaced the judge line's triangle marker so its direction stays readable at low opacity. The new marker is an equilateral triangle: its base sits on the judge line, its apex points along the line's normal, and a smaller equilateral triangle is cut out of the middle of that base so it splits into two feet. Unlike the old centred isosceles triangle whose centroid floated above the line, it still shows which line it belongs to and which way it faces when the line itself is fully transparent.
- The marker is a quarter smaller and now sits a quarter of its own height above the judge line instead of resting on it.
- The selected judge line's marker was missing entirely on the default GPU path. Its sprite was loaded from a directory that does not exist, and a missing source made the textured arrow give up its submission; with line numbers switched off the whole frame was skipped too. The marker now ships as an application resource and both paths draw it.
- The marker no longer ignores the theme colour. The sprite is a white alpha mask, and the old code set `fillStyle` before `drawImage`, which has no effect on an image, so both themes painted a white marker; it is now tinted with `--canvas-preview-line-selected`.
