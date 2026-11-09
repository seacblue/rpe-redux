/** Localized explanations for recording preparation and encoder failures. */
import { t } from "../../../../../i18n/index.ts";

/** Turn host error codes into actionable text without losing unknown diagnostics. */
export function recordingError(reason: unknown): string {
  const detail = reason instanceof Error ? reason.message : String(reason);
  if (detail.includes("long_tasks_blocked_for_update")) {
    return t("editor.recording.updateBusy");
  }
  if (detail.includes("recording_destination_changed")) {
    return t("editor.recording.changed");
  }
  if (detail.includes("recording_encoder_start") || detail.includes("recording_encoder_missing")) {
    return t("editor.recording.noEncoder");
  }
  if (
    detail.includes("recording_encoder_failed") ||
    detail.includes("preview_frame_encode_failed")
  ) {
    return t("editor.recording.encoderFailed");
  }
  if (detail.includes("recording_music_unavailable")) {
    return t("editor.recording.noMusic");
  }
  if (detail.includes("recording_image_decoder_unavailable")) {
    return t("editor.recording.animated");
  }
  if (detail.includes("recording_image_unavailable")) {
    return t("editor.recording.imageError");
  }
  if (
    detail.includes("recording_shader_") ||
    detail.includes("recording_noise_") ||
    detail.includes("preview_frame_shader_") ||
    detail.includes("preview_frame_noise_")
  ) {
    return t("editor.recording.effectError");
  }
  if (detail.includes("recording_resources_changed")) {
    return t("editor.recording.resourcesChanged");
  }
  if (detail.includes("recording_invalid") || reason instanceof RangeError) {
    return t("editor.recording.invalid");
  }
  return detail;
}
