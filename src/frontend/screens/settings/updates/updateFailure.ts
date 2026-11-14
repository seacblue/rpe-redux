/** Classify host update failures into the stable messages shown by settings. */
import type { UpdateErrorCode } from "./updateStore.ts";

/** Translate a failed install or local verification into the shared error vocabulary. */
export function classifyUpdateFailure(error: unknown): {
  code: UpdateErrorCode;
  detail: string;
} {
  const detail = error instanceof Error ? error.message : String(error);
  const marker = "update_resource_conflict:";
  const position = detail.indexOf(marker);
  return {
    code:
      position >= 0
        ? "resource-conflict"
        : detail.includes("local_update_key_missing")
          ? "public-key"
          : detail.includes("local_update_helper_")
            ? "local-handoff"
            : detail.includes("local_update_")
              ? "local-invalid"
              : "install",
    detail: position >= 0 ? detail.slice(position + marker.length) : detail,
  };
}
