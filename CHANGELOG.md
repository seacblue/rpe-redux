# Changelog

User-visible changes for the current release. Chinese first, English second. The
release workflow publishes this section as the GitHub release body, and the
desktop changelog shows the section that matches the interface language.

Inside either language section the notes may use two inline annotations:
`@name` credits a GitHub user (rendered bold and underlined), and
`<red>text</red>` colours a run of text. The tag name is the colour: `accent`,
`red`, `yellow`, `green`, `blue`, `purple`, or `gray`. Each resolves through the
active theme, so write the name rather than a hex value. GitHub drops the unknown
tag, so the release page still reads as plain words.

## 1.0.1 (2026-11-06)

### 中文

**修复**

- 慢速播放（0.25x–0.75x）不再有颗粒感和波形不连续：分析窗与交叉淡化随播放速度自适应，打击音头保持对齐，鼓点衰减在慢速下保持稳定。
- 正常速度播放直接使用解码后的原始样本，避免不必要的时间伸缩。
- 录音面板保留手动输入的开始时间；导出完成后显示完成状态。
- 修复快捷键录制后点击「保存」会丢失绑定、导致快捷键无法修改的问题。
- 后台任务面板在悬停时显示单条任务的移除按钮，空状态文案与其他面板一致。

**安全**

- 升级 ZIP 解析库（zip 4 → 9），修复三个已知漏洞，其中包括可导致任意文件覆盖的高危问题。

**调整**

- 「快捷键」页移除「恢复全部默认」按钮；每条快捷键仍可单独恢复默认值。
- 「外观与主题 → 背景」的自定义背景图片按钮不再弹出与按钮文字重复的悬停提示。

### English

**Fixes**

- Slow playback (0.25x–0.75x) no longer sounds granular or shows waveform discontinuities: analysis windows and crossfades adapt to the playback rate, attacks stay aligned, and drum decay stays stable.
- Normal-speed playback uses the decoded samples directly instead of an unnecessary time stretch.
- The recording panel keeps a manually entered start time, and a finished export reports completion.
- Fixed captured shortcut bindings being lost when Save was clicked, which made shortcuts impossible to change.
- The background task panel reveals per-task removal on hover, and its empty state matches the other panels.

**Security**

- Upgraded the ZIP parser (zip 4 → 9), fixing three known vulnerabilities, including a high-severity issue that could overwrite arbitrary files.

**Changes**

- Removed the “Restore all defaults” action from the Shortcuts page; every shortcut can still be restored individually.
- The custom background image action no longer shows a tooltip that repeats the button text.
