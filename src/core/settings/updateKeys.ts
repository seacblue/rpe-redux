/**
 * Persisted update-check keys shared by the settings schema and the update store.
 *
 * Source and signing key are build configuration, not preferences; the check,
 * release-channel, and package-download choices live in the settings section.
 */
export const UPDATE_SETTING_KEYS = Object.freeze({
  autoCheck: "update-auto-check",
  prereleases: "update-include-prereleases",
  downloadPolicy: "update-download-policy",
  skippedVersion: "update-skipped-version",
} as const);

/** The user-selectable policy for downloading a verified update package. */
export type UpdateDownloadPolicy = "all" | "wifi" | "never";

/** The default policy that protects metered connections from update downloads. */
export const DEFAULT_UPDATE_DOWNLOAD_POLICY: UpdateDownloadPolicy = "wifi";
