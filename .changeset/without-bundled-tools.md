---
"rpe-redux": minor
---

### 中文

**新增功能**

- 新增 `--without-bundled-tools` 参数：构建或 `npm run dev:desktop` 时跳过 FFmpeg 和 Cloudflared 下载。没装这两个工具也能启动，导出会提示不可用，开房会自动改用内网。

### English

**Features**

- Added `--without-bundled-tools` for `npm run build` and `npm run dev:desktop`, which skips the FFmpeg and Cloudflared downloads. The app still starts; export says it is unavailable, and hosting a room falls back to the LAN bridge.
