---
"rpe-redux": patch
---

### 中文

**修复**

- 素材库音频预览不再绘制频谱柱状图，选中行与播放器不再使用亮色背景；音频详情标题恢复紧凑的内边距。
- 素材库面板激活且选中音频时，空格键切换该音频的播放与暂停，不再触发谱面播放。
- 桌面端可直接用外部编辑器打开项目素材库中的图片、音频和着色器，不再误报“外部编辑仅在桌面应用中可用”。
- 移除重命名素材时与当前素材类型无关的说明文字。

### English

**Fixes**

- Stop drawing spectrum bars in the library audio preview, remove the bright selected-row and player backgrounds, and restore a compact inset for the audio detail title.
- Space toggles the selected library audio preview while the assets inspector is active instead of starting chart playback.
- Desktop builds can open images, audio, and shaders from project libraries in the external editor; the incorrect “external editing is available in the desktop app” notice is gone.
- Remove the asset-kind-specific rename hint from the rename dialog.
