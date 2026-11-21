/**
 * The settings keys the startup screen needs before the full settings catalog
 * is registered with the editor shell.
 */
export default {
  "settings.startup.reportTitle": "RPE Redux — startup failure",
  "settings.startup.reportTime": "Time: {time}",
  "settings.startup.reportRuntime": "Runtime: {runtime}",
  "settings.startup.logGuide":
    "The call stack was saved automatically. Please upload frontend.log with your bug report.",
  "settings.startup.logPath": "Log file: {path}",
  "settings.startup.logUnavailable":
    "The log file could not be written. Copy the report below for your bug report.",
  "settings.startup.copyReport": "Copy error report",
  "settings.startup.copySuccess": "Report copied",
  "settings.startup.copyFailed": "Copy failed",
  "settings.startup.openLogs": "Open log folder",
  "settings.startup.failed": "Start-up did not finish",
  "settings.startup.preparing": "Preparing the workspace",
  "settings.startup.retry": "Start again",
  "settings.startup.progress": "Starting the editor…",
  "settings.startup.downloading": "Downloading {downloaded} / {total}",
  "settings.startup.downloadingSpeed": "Downloading {downloaded} / {total} · {speed}",
  "settings.startup.downloaded": "Downloaded {downloaded}",
  "settings.startup.downloadedSpeed": "Downloaded {downloaded} · {speed}",
} as const;
