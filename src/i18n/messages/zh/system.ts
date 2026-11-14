/** Platform, document, library, settings and asset error messages and file kinds. */
export default {
  // Audio asset loading and playback.
  "system.audio.loadCancelled": "音乐载入已取消",
  "system.audio.readTimeout": "读取音乐 {name} 超时，请检查文件或重新导入",
  "system.audio.decodeFailed": "无法解码音乐 {name}；请检查文件完整性或转为 WAV/FLAC/MP3/OGG",
  "system.audio.seekFailed": "音乐定位失败，请重新载入音频",
  "system.audio.invalidPosition": "非法播放位置",
  "system.audio.invalidRate": "倍速必须大于零",
  "system.audio.invalidVolume": "音量必须为有限数字",
  "system.audio.timeStretchUnavailable": "无法保持音高；音频将改为重采样，音高会随倍速变化。",

  // Image asset loading.
  "system.image.missing":
    "素材缺失：{name}。若谱面引用了文档目录外的文件，这些外部文件默认不会加载。",
  "system.image.missingAction": "打开素材库",
  "system.image.decodeFailed": "图片无法解码：{name}，请检查文件内容或改用 PNG/JPEG/WebP",

  // Note skin assets.

  // ZIP and PEZ archive handling.
  "system.zip.unsafePath": "ZIP 包含不安全路径：{name}",
  "system.zip.invalidDirectory": "无效 ZIP/PEZ 目录",
  "system.zip.tooManyEntries": "ZIP 条目数量超过预算",
  "system.zip.spannedUnsupported": "不支持分卷或 ZIP64",
  "system.zip.damagedDirectory": "ZIP 目录损坏",
  "system.zip.sizeBudget": "ZIP 解压大小超过预算",
  "system.zip.encryptedUnsupported": "不支持加密 ZIP 或 ZIP64",
  "system.zip.nameOutOfBounds": "ZIP 文件名越界",
  "system.zip.duplicateName": "ZIP 重复文件名：{name}",
  "system.zip.headerDamaged": "ZIP 文件头损坏",
  "system.zip.contentOutOfBounds": "ZIP 文件内容越界",
  "system.zip.sizeMismatch": "ZIP 解压大小与目录不一致",
  "system.zip.unsupportedCompression": "不支持 ZIP 压缩方式 {method}",
  "system.zip.checksumFailed": "ZIP 校验失败：{name}",
  "system.zip.entryCountNeedsZip64": "此文件数量需要 ZIP64，暂不支持",
  "system.zip.nameTooLong": "ZIP 文件名过长",
  "system.zip.archiveNeedsZip64": "此包需要 ZIP64，暂不支持",
  "system.zip.directoryNeedsZip64": "此目录需要 ZIP64，暂不支持",

  // Document opening and export.
  "system.document.loadCancelled": "文档载入已取消",
  "system.document.chartFilter": "谱面",
  "system.document.officialFilter": "Phigros 官谱",
  "system.document.pecFilter": "PhiEdit PEC 谱面",
  "system.document.extractDirectory": "选择谱面资源导出目录（现有文件不会覆盖）",

  // Local service integration.
  "system.library.unreachable": "无法连接本地服务：{message}",
  "system.library.nonJsonResponse": "本地服务返回了非 JSON 响应（HTTP {status}）",
  "system.library.requestFailed": "请求失败（HTTP {status}）",
  "system.library.requestFailedGeneric": "本地素材库无法完成此请求。",
  "system.library.notFound": "找不到请求的本地素材库项目。",
  "system.library.invalidRequest": "本地素材库拒绝了此请求。",
  "system.library.unavailable": "本地素材库当前不可用。",
  "system.library.storageError":
    "本地数据存储失败，可能是磁盘空间不足或数据库不可写。请先导出备份，再检查磁盘和权限。",
  "system.library.notRunning": "本地服务未运行",

  "system.backup.title": "保护本地数据",
  "system.backup.fileType": "RPE Redux 应用数据备份",
  "system.diagnostics.fileType": "RPE Redux 诊断包",
  "system.backup.description":
    "本地数据库或谱面文件保存失败。建议先导出应用数据备份，再检查磁盘空间或修复数据库。",
  "system.backup.exportAction": "导出备份",
  "system.backup.dismissAction": "继续",
  "system.backup.success": "应用数据备份已导出到 {path}。",
  "system.backup.failed": "导出备份失败：{message}",

  // Preferences.
  "system.preferences.unknownSection": "未知的偏好分区：{section}",

  // File import and export.
  "system.files.chartNotFound": "找不到 RPE JSON 谱面",
  "system.files.fileFilter": "支持的文件",
  "system.files.exportNameRequired": "请输入导出文件名",

  // Window title.
} as const;
