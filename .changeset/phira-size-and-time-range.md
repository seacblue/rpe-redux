---
"rpe-redux": patch
---

### 中文

**对齐 Phira 的皮肤尺寸并统一录制时间输入**

- 预览默认判定线的长度与线粗按 Phira 的 RPE 逻辑尺寸校准，同时保留 Redux 自有素材。
- 录制谱面范围固定使用开始时间和结束时间，移除拍数输入与模式切换。
- 浏览器端导入现在也能识别并转换 PEC 与官谱 JSON，普通 RPE JSON/PEZ 继续走原有导入路径。
- 工具栏溢出改为左右 chevron 控件，命中效果和程序化粒子在暂停或跳转时独立播放至结束。

### English

**Align skin sizing with Phira and use time-only recording ranges**

- Calibrate the preview judge-line defaults to Phira's RPE logical dimensions while keeping Redux's own artwork.
- Recording chart ranges now always use start and end times; beat inputs and the mode switch are removed.
- Browser file imports now detect and convert PEC and official chart JSON while keeping the existing RPE JSON/PEZ path.
- Replace the toolbar overflow bar with left/right chevron controls, and let hit effects and procedural particles finish independently of pause or seeking.
