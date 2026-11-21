---
"rpe-redux": minor
---

### 中文

**改进**

- 加快网页端首屏速度，实现字体子集化与延迟加载。
- 网页版启动时立即绘制启动界面，并在下载初始脚本与样式时显示进度和速度；主样式表改为非阻塞加载，缩短首次绘制时间。
- 编辑器、设置界面和扩展/Code Cell 管道改为按需加载；较大的界面 chunk 按功能自动拆分并保持在 500KB 以下，首屏脚本总量明显下降。
- 内置 CJK 字体改为 UI 子集加 unicode-range 分片（UI 0.21MiB，其余按需加载）；编辑器 Shell 挂载后先加载 UI 子集，用户输入的文字只请求对应码位分片，系统字体仅作加载前或缺字回退。

### English

**Improvements**

- Speed up the web first paint and ship the CJK font as a lazy-loaded subset.
- The web build now paints the startup screen immediately and reports the progress and speed of the initial script and stylesheet download; the main stylesheet no longer blocks the first paint.
- The editor shell, settings UI, and Extension/Code Cell pipeline now load on demand; larger interface chunks are split by feature and kept below 500 KB, which cuts the startup script payload.
- The bundled CJK font is now a UI subset plus unicode-range slices (0.21 MiB UI face, the rest on demand); the shell loads the UI face after mounting, user-entered characters request only their slice, and the system CJK face remains the loading or missing-glyph fallback.
