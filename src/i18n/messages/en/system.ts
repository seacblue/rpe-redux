/**
 * Platform, document, library, settings and asset failures and file kinds.
 *
 * These strings surface in dialogs and toasts rather than in a form, so they read
 * as sentences: what failed, and what the user can do about it. Names that belong
 * to the file being read (a ZIP entry, an image, a custom font) are passed in as
 * placeholders and never translated.
 */
export default {
  // Audio asset loading and playback.
  "system.audio.loadCancelled": "Music loading was cancelled",
  "system.audio.readTimeout": "Timed out reading {name}; check the file or import it again",
  "system.audio.decodeFailed":
    "Cannot decode {name}; check that the file is intact or convert it to WAV/FLAC/MP3/OGG",
  "system.audio.seekFailed": "Seeking failed; load the audio again",
  "system.audio.invalidPosition": "Invalid playback position",
  "system.audio.invalidRate": "The playback rate must be greater than zero",
  "system.audio.invalidVolume": "The volume must be a finite number",
  "system.audio.timeStretchUnavailable":
    "Pitch-preserving playback is unavailable; audio will resample and pitch will follow speed.",

  // Image asset loading.
  "system.image.missing":
    "Missing asset: {name}. If the chart points outside its folder, external files are not loaded by default.",
  "system.image.missingAction": "Open asset library",
  "system.image.decodeFailed":
    "Cannot decode the image: {name}; check the file or use PNG/JPEG/WebP",

  // Note skin assets.

  // ZIP and PEZ archive handling.
  "system.zip.unsafePath": "The ZIP holds an unsafe path: {name}",
  "system.zip.invalidDirectory": "Invalid ZIP/PEZ directory",
  "system.zip.tooManyEntries": "The ZIP holds more entries than its budget allows",
  "system.zip.spannedUnsupported": "Spanned archives and ZIP64 are not supported",
  "system.zip.damagedDirectory": "The ZIP directory is damaged",
  "system.zip.sizeBudget": "The unpacked ZIP is larger than its budget allows",
  "system.zip.encryptedUnsupported": "Encrypted ZIPs and ZIP64 are not supported",
  "system.zip.nameOutOfBounds": "A ZIP file name points outside the archive",
  "system.zip.duplicateName": "Duplicate ZIP file name: {name}",
  "system.zip.headerDamaged": "A ZIP file header is damaged",
  "system.zip.contentOutOfBounds": "ZIP file contents point outside the archive",
  "system.zip.sizeMismatch": "The unpacked ZIP size disagrees with its directory",
  "system.zip.unsupportedCompression": "ZIP compression method {method} is not supported",
  "system.zip.checksumFailed": "ZIP checksum failed: {name}",
  "system.zip.entryCountNeedsZip64": "This file count needs ZIP64, which is not supported yet",
  "system.zip.nameTooLong": "A ZIP file name is too long",
  "system.zip.archiveNeedsZip64": "This archive needs ZIP64, which is not supported yet",
  "system.zip.directoryNeedsZip64": "This directory needs ZIP64, which is not supported yet",

  // Document opening and export.
  "system.document.loadCancelled": "Document loading was cancelled",
  "system.document.chartFilter": "Chart",
  "system.document.officialFilter": "Phigros official chart",
  "system.document.pecFilter": "PhiEdit PEC chart",
  "system.document.extractDirectory":
    "Choose where to export the chart assets (existing files are kept)",

  // Local service integration.
  "system.library.unreachable": "Cannot reach the local service: {message}",
  "system.library.nonJsonResponse":
    "The local service answered with something other than JSON (HTTP {status})",
  "system.library.requestFailed": "The request failed (HTTP {status})",
  "system.library.requestFailedGeneric": "The local library could not complete the request.",
  "system.library.notFound": "The requested local library item was not found.",
  "system.library.invalidRequest": "The local library rejected the request.",
  "system.library.unavailable": "The local library is currently unavailable.",
  "system.library.storageError":
    "Local data storage failed, possibly because the disk is full or the database is not writable. Export a backup and check the disk and permissions.",
  "system.library.notRunning": "The local service is not running",

  // Application-data backup.
  "system.backup.title": "Protect your local data",
  "system.backup.fileType": "RPE Redux application backup",
  "system.diagnostics.fileType": "RPE Redux diagnostic bundle",
  "system.backup.description":
    "The local database or chart file could not be saved. Export an application-data backup before checking the disk or repairing the database.",
  "system.backup.exportAction": "Export backup",
  "system.backup.dismissAction": "Continue",
  "system.backup.success": "Application-data backup exported to {path}.",
  "system.backup.failed": "Backup export failed: {message}",

  // Preferences.
  "system.preferences.unknownSection": "Unknown preference section: {section}",

  // File import and export.
  "system.files.chartNotFound": "No RPE JSON chart was found",
  "system.files.fileFilter": "Supported files",
  "system.files.exportNameRequired": "Enter a name for the exported file",

  // Window title.
} as const;
