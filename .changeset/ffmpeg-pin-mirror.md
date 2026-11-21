---
"rpe-redux": patch
---

### 中文

**修复**

- 修复了 Windows 安装包构建失败的问题：内置 FFmpeg 8.1.2 的下载地址已被上游移除，现改为使用发布者的 GitHub 镜像，文件内容与校验值保持不变。

### English

**Fixes**

- Fixed the Windows installers failing to build: the bundled FFmpeg 8.1.2 download had been withdrawn upstream, so it now comes from the publisher's GitHub mirror with the same bytes and checksum.
