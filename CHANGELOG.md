# Changelog

User-visible changes for the current release. Chinese first, English second. The release workflow publishes this section as the GitHub release body, and the desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations: `@name` credits a GitHub user (rendered bold and underlined), and `<red>text</red>` colours a run of text. The tag name is the colour: `accent`, `red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the active theme, so write the name rather than a hex value. GitHub drops the unknown tag, so the release page still reads as plain words.

## 1.0.5 (2026-11-07)

### 中文

**新功能**

- 编辑器显示设置新增音符与事件时间轴共享的竖向网格线、指针高亮线和中心线颜色。
- X 轴网格数量现在按实际可选线数配置；1 为中心线，2 为左右边界，工具栏输入改为整数。

**修复**

- 谱面 JSON 或 PEZ 谱面条目的大小上限提升至 512 MiB，可处理更大的有效谱面。
- 打开和保存失败时显示本地化的错误说明、解决办法和稳定错误代码；保存冲突也会提供恢复指引。

**内部改进**

- 新增回归测试覆盖竖向网格、谱面加载错误、外部资源和保存行为，并同步更新相关运行时文档。

### English

**Features**

- Editor display settings now expose shared vertical grid, pointer-highlight, and center-line colours for the note and event timelines.
- The X-axis grid count now represents the actual selectable line count: 1 is the center line, 2 are the left and right boundaries, and the toolbar accepts integers only.

**Fixes**

- The limit for chart JSON or a PEZ chart entry is now 512 MiB, allowing larger valid charts to open.
- Failed opens and saves now show localized explanations, recovery steps, and stable error codes; save conflicts include recovery guidance.

**Internal**

- Regression coverage now includes vertical grids, chart-loading errors, external resources, and save behaviour, with the related runtime documentation updated.
