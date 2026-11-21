---
"rpe-redux": patch
---

### 中文

**修复**

- 桌面端打开和保存谱面时不再反复读取并哈希整包歌曲、背景和视频：未变化的文件按大小与修改时间复用摘要，磁盘快照在阻塞线程计算，保存成功后也不再额外探测一次。
- 歌曲、图片和自定义背景的读取移到阻塞线程，`redux://` 媒体响应支持 ETag 复用，打开谱面和选择纹理时不再因同步文件读取卡住界面。
- 主题、皮肤和扩展文件夹只在对应设置页可见时按五秒间隔扫描，窗口隐藏时暂停；删除这些文件夹不会因为应用占用文件而失败，运行时继续使用已加载的主题文档、皮肤位图和扩展代码。主题选择页重新扫描时会把已删除的活动主题退回内置主题；皮肤页保留当前已解码的位图并标记缺失；扩展页会卸载已删除的扩展。扩展入口源码也改为按原始字节读取，不再经过 JSON 数字数组。
- 拖动窗口边缘与点击标题栏不再每个事件都发一次 IPC 或强制一次布局。

### English

**Fixes**

- Opening and saving a desktop chart no longer re-reads and re-hashes every song, background, and video: unchanged files reuse a digest keyed by size and modification time, snapshots run on the blocking pool, and a successful save no longer probes the disk again.
- Song, image, and custom-background reads move off the main thread, and `redux://` media responses revalidate with an ETag, so opening charts and picking textures no longer stall on synchronous file reads.
- Theme, skin, and Extension folder scans run only while the matching settings page is visible, every five seconds, and pause while the window is hidden. Deleting those folders never fails because the app holds the files open, and the live session keeps using the theme document, skin bitmaps, and Extension code it already loaded. A theme-picker rescan moves a deleted active theme back to the built-in; the skin page keeps the decoded bitmaps and marks the package missing; the Extensions page unloads a deleted package. Extension entry code now crosses IPC as raw bytes instead of a JSON number array.
- Resizing a window edge or pressing the title bar no longer sends an IPC call per event or forces a layout on every press.
