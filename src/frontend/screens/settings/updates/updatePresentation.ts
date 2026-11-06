/**
 * Presentation helpers for the update state.
 *
 * The Help page and any update surface label the same update state through this
 * module, so status text and failure text cannot drift between views.
 */
import type { MessageKey, MessageParams } from "../../../../i18n/index.ts";
import type { UpdateErrorCode, UpdateState } from "./updateStore.ts";

type UpdateTranslate = (key: MessageKey, params?: MessageParams) => string;

/** Render a byte count as megabytes with one decimal, or `?` when unknown. */
function formatMegabytes(value: number | null): string {
  return value === null ? "?" : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** The message key for one stable update failure code. */
export function updateErrorKey(code: UpdateErrorCode | null): MessageKey {
  switch (code) {
    case "not-found":
      return "settings.updates.error.not-found";
    case "rate-limit":
      return "settings.updates.error.rate-limit";
    case "network":
      return "settings.updates.error.network";
    case "timeout":
      return "settings.updates.error.timeout";
    case "invalid-repo":
      return "settings.updates.error.invalid-repo";
    case "invalid-response":
      return "settings.updates.error.invalid-response";
    case "public-key":
      return "settings.updates.error.public-key";
    case "portable":
      return "settings.updates.error.portable";
    case "save-first":
      return "settings.updates.error.save-first";
    case "local-handoff":
      return "settings.updates.localHandoffFailed";
    case "local-invalid":
      return "settings.updates.localInvalid";
    case "resource-conflict":
      return "settings.updates.error.resource-conflict";
    case "tasks-active":
      return "settings.updates.error.tasks-active";
    case "install":
      return "settings.updates.error.install";
    default:
      return "settings.updates.error.generic";
  }
}

/** The one-line status for the current update phase. */
export function updateStatusText(t: UpdateTranslate, state: UpdateState): string {
  switch (state.phase) {
    case "available":
      return state.latest ? t("settings.updates.available", { version: state.latest.version }) : "";
    case "verifying":
      return t("settings.updates.verifying");
    case "preparing":
      return t("settings.updates.preparing");
    case "downloading":
      return state.total
        ? t("settings.updates.downloading", {
            downloaded: formatMegabytes(state.downloaded),
            total: formatMegabytes(state.total),
          })
        : t("settings.updates.downloadingUnknown", {
            downloaded: formatMegabytes(state.downloaded),
          });
    case "installing":
      return t("settings.updates.installing");
    case "installed":
      return t("settings.updates.installed");
    case "up-to-date":
      return t("settings.updates.upToDate");
    case "unconfigured":
      return t("settings.updates.unconfigured");
    case "checking":
      return t("settings.updates.checking");
    default:
      return "";
  }
}
