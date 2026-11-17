---
"rpe-redux": patch
---

### 中文

**改进**

- 桌面构建在打包时解析并校验 FFmpeg 与 Cloudflare Tunnel 的最新上游发布版本，不再固定旧版本：视频导出随附最新版 FFmpeg，联机大厅随附最新版 Cloudflare Tunnel 客户端，下载仍对照上游公布的 SHA-256 校验；新增 `npm run deps:check` 可在不下载大文件的情况下查看最新版本与当前已内置版本。

### English

**Improvements**

- Desktop builds now resolve and verify the newest upstream FFmpeg and Cloudflare Tunnel releases while packaging instead of pinning an old version: video export bundles the latest FFmpeg and the collaboration tunnel the latest Cloudflare Tunnel client, every download is still checked against the checksum the publisher ships, and the new `npm run deps:check` reports the latest and staged versions without downloading the archives.
