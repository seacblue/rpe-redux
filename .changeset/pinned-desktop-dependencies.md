---
"rpe-redux": patch
---

### 中文

**构建**

- 桌面构建的 FFmpeg（Windows x64 8.1.2、Linux x64 和 Windows x86 n8.1.3）与 Cloudflared 2026.10.7 改为锁定精确版本、下载地址和 SHA-256；首次下载后复用已验证的缓存和暂存文件，不再在每次构建时解析上游最新版本。

### English

**Build**

- Desktop builds now pin FFmpeg (8.1.2 on Windows x64; n8.1.3 on Linux x64 and Windows x86) and Cloudflared 2026.10.7 by exact version, download URL, and SHA-256 digest; a verified cache or staged copy is reused instead of resolving upstream latest on every build.
