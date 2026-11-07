/**
 * 中文文档错误说明与解决办法。
 * 将操作错误码与工作区的其他文案分开，避免错误说明退化为原始诊断。
 */
export default {
  "workspace.document.error.openGeneric": "无法读取谱面文件。",
  "workspace.document.solution.openGeneric":
    "请确认文件存在、仍可访问且格式受支持；如果问题持续，请保留底部错误代码和原文件以便排查。",
  "workspace.document.solution.saveGeneric":
    "请确认目标路径可写、文件未被其他程序占用，并重新尝试保存；如果问题持续，请保留底部错误代码。",
  "workspace.document.error.chartTooLarge": "谱面 JSON 超过 512 MiB，无法安全处理。",
  "workspace.document.solution.chartTooLarge":
    "请先压缩 JSON 的格式空白；如果仍然超限，请精简或拆分谱面后重试。",
  "workspace.document.error.pezEntryLimit": "PEZ 包中的文件数量超过允许上限。",
  "workspace.document.solution.pezEntryLimit":
    "请删除不需要的文件，或重新导出只包含当前谱面和素材的 PEZ。",
  "workspace.document.error.pezSizeOverflow": "PEZ 包的解压大小计算发生溢出。",
  "workspace.document.solution.pezSizeOverflow":
    "请重新导出或重新下载 PEZ；如果问题持续，请检查压缩包是否损坏。",
  "workspace.document.error.pezExtractedSizeLimit": "PEZ 解压后的资源总大小超过 1 GiB。",
  "workspace.document.solution.pezExtractedSizeLimit":
    "请移除不需要的音频、图片或其他资源，再重新导出 PEZ。",
  "workspace.document.error.pezInfoSizeLimit": "PEZ 的信息文件超过 8 MiB。",
  "workspace.document.solution.pezInfoSizeLimit":
    "请重新导出 PEZ，并避免在信息文件中写入大量无关内容。",
  "workspace.document.error.pezSidecarSizeOverflow": "PEZ 信息文件的大小计算发生溢出。",
  "workspace.document.solution.pezSidecarSizeOverflow":
    "请重新导出或重新下载 PEZ；如果问题持续，请检查压缩包是否损坏。",
  "workspace.document.error.pezEntrySizeMismatch":
    "PEZ 条目大小与实际内容不一致，压缩包可能已损坏。",
  "workspace.document.solution.pezEntrySizeMismatch":
    "请重新导出或重新下载 PEZ，不要继续使用当前损坏的压缩包。",
  "workspace.document.error.pezChartCandidatesLimit": "PEZ 中可识别的谱面 JSON 数量超过允许上限。",
  "workspace.document.solution.pezChartCandidatesLimit":
    "请删除不需要的谱面或自动保存文件，只保留要打开的谱面后重试。",
  "workspace.document.error.pezChartMissing": "PEZ 包中没有找到可打开的 RPE 谱面。",
  "workspace.document.solution.pezChartMissing":
    "请确认包内包含有效的 JSON 谱面，并在 info.txt 中填写正确的 Chart 路径。",
  "workspace.document.error.pezMultipleCharts": "PEZ 包中包含多个谱面，无法确定要打开哪一个。",
  "workspace.document.solution.pezMultipleCharts":
    "请在 info.txt 中填写唯一的 Chart 路径，或删除不需要的谱面后重试。",
  "workspace.document.error.unsafeResourcePath": "PEZ 包含不安全的资源路径。",
  "workspace.document.solution.unsafeResourcePath":
    "请将资源放在谱面目录内，并使用规范的相对路径重新导出 PEZ。",
  "workspace.document.error.invalidChartData": "谱面数据无效，无法解析或保存。",
  "workspace.document.solution.invalidChartData":
    "请检查 JSON 格式和谱面字段；必要时从最近一次可用的备份恢复。",
  "workspace.document.error.chartPackageIdMissing": "谱面缺少打包所需的项目标识。",
  "workspace.document.solution.chartPackageIdMissing":
    "请先将谱面保存为项目文件，再重新执行导出或打包。",
  "workspace.document.error.invalidChunkData": "保存过程中收到无效的谱面数据块。",
  "workspace.document.solution.invalidChunkData":
    "请取消当前保存并重试；如果问题持续，请重新打开谱面后再保存。",
  "workspace.document.error.resourceSizeMismatch": "谱面资源大小与保存记录不一致。",
  "workspace.document.solution.resourceSizeMismatch": "请重新导入或替换该资源，然后再次保存。",
  "workspace.document.solution.saveBaselineUnavailable":
    "请确认原文件仍存在且可读取；必要时使用“另存为”保存到新位置。",
  "workspace.document.solution.saveSessionMissing":
    "请重新执行保存；如果问题持续，请重新打开谱面。",
  "workspace.document.solution.saveAssetsBinaryRequired":
    "请重新执行保存，让应用以二进制方式发送资源。",
  "workspace.document.solution.invalidSaveAssetData": "请重新导入出错的资源，然后再次保存。",
  "workspace.document.solution.saveAssetMissing": "请重新导入缺少的资源，然后再次保存。",
  "workspace.document.solution.duplicateSaveAsset": "移除重复的资源条目后，再次保存。",
  "workspace.document.solution.saveDestinationExists":
    "选择空的导出位置或确认覆盖目标后，再次导出。",
  "workspace.document.solution.saveAssetFilenameMissing": "为资源补充文件名后，再次保存。",
  "workspace.document.solution.saveExportDirectoryRequired": "请选择有效的导出目录后重试。",
  "workspace.document.solution.unsafeSaveAssetPath":
    "请先把外部资源复制到谱面目录，再重新保存或导出 PEZ。",
  "workspace.document.solution.saveFailed":
    "请检查目标路径、资源和磁盘空间，然后重试；如果问题持续，请保留底部错误代码。",
  "workspace.document.solution.libraryRevisionConflict":
    "请重新载入谱面库中的最新版本，确认修改后再保存。",
  "workspace.document.solution.saveConflict":
    "请确认是否保留本地修改，必要时使用“另存为”保存到新文件。",
  "workspace.document.solutionLabel": "解决办法",
} as const;
