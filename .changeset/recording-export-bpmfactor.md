---
"rpe-redux": patch
---

### 中文

**修复**

- 修复了渲染导出在 250%/300% 缩放下按 2× 封顶像素比降采样、Shader 层按 CSS 像素渲染导致成片模糊的问题；导出现在按所选分辨率逐层渲染。
- 修复了长谱面分页载入后导出可能丢失未加载判定线的问题；导出前会先完整物化谱面。
- 修复了变速导出时音视频时长不一致留下尾部纯音频或冻结末帧的问题，并避免 H.264 B 帧导致的帧序错误。
- 修正了 `bpmfactor` 的语义：谱面时间统一使用全局 BPM（以首个 BPM 为基准），`bpmfactor` 只影响该判定线 Hold 打击特效的脉冲频率；此前按拍号导出会与音符时间错位。
- 导出画面现在保持成片观感：音符完整不透明，视野回到标准构图，不再混入编辑器的作者态状态。

### English

**Fixes**

- Fixed rendered exports being downsampled on 250%/300% displays because the host divided by the raw device pixel ratio while the canvas capped it at 2, and shader layers being rendered at CSS resolution; every layer now renders at the selected output resolution.
- Fixed paged charts dropping lines that were not loaded yet: export now materializes the full chart before cloning.
- Fixed speed-changed exports leaving a trailing audio-only segment or a frozen last frame when the soundtrack and frame stream disagreed, and prevented H.264 B-frames from reordering copied frames.
- Corrected `bpmfactor` semantics: chart time always follows the global `BPMList` anchored at the first BPM, while `bpmfactor` only scales the Hold hit-effect pulse rate on its line. Beat-based export ranges previously drifted against note times.
- Export now renders the game view: notes stay fully opaque, the camera returns to the standard framing, and editor-only authoring state is not baked into the video.
