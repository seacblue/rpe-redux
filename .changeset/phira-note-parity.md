---
"rpe-redux": patch
---

### 中文

**皮肤功能对齐 Phira**

- 预览音符大小改为 Phira 的 `note_scale` 语义：默认 `1.0`，范围 `0.8`–`1.2`，旧像素值会自动换算。
- Phira 资源包对齐：同时音符按 `click_mh` / `click` 宽度缩放；支持 `holdKeepHead`、`holdRepeat`、`holdCompact` 与零高度头尾切片；打击特效按 `hitFxDuration`、`hitFxScale`、`hitFxRotate`、`hitFxTinted`、`hideParticles` 绘制。
- 内置皮肤按 Phira 默认资源包的尺寸与图集边界重新采样，画面仍为 Redux 自有素材。
- 事件条扩展固定读取包根的 `event_hold.png`，不再需要 `info.yml` 的 `eventHold` 字段。

### English

**Skin feature parity with Phira**

- Preview note size now uses Phira's `note_scale`: `1.0` by default in the `0.8`–`1.2` range, with automatic conversion of stored pixel values.
- Phira respack parity: simultaneous notes scale by `click_mh` / `click`; `holdKeepHead`, `holdRepeat`, `holdCompact`, and zero-height cap slices are honoured; hit effects follow `hitFxDuration`, `hitFxScale`, `hitFxRotate`, `hitFxTinted`, and `hideParticles`.
- The built-in skin is resampled to Phira's default respack dimensions and atlas boundaries while keeping Redux's own artwork.
- The event-bar extension always reads the fixed package-root `event_hold.png`; the `eventHold` info.yml entry is gone.
