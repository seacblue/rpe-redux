/**
 * Product-version comparison for collaboration admission.
 *
 * A room is authoritative for the version: every member must run the host's
 * exact build. The comparison only chooses the user-facing remedy when the
 * versions differ; it never relaxes the exact-match rule.
 */

/** Rejection codes that explain which side is newer, when the direction is known. */
export type VersionMismatchCode =
  "version_mismatch_client_newer" | "version_mismatch_client_older" | "version_mismatch_unknown";

/**
 * Compare dotted numeric product versions.
 *
 * Pre-release and build suffixes are ignored for the direction check. A value
 * that cannot be parsed compares as equal, so admission never invents an order
 * it cannot prove; callers report the unknown-direction code instead.
 */
export function compareProductVersions(left: string, right: string): -1 | 0 | 1 {
  const parts = (value: string): number[] | null => {
    const numeric = value.trim().replace(/^v/i, "").split(/[-+]/, 1)[0] ?? "";
    if (!numeric) {
      return null;
    }
    const fields = numeric.split(".");
    const parsed: number[] = [];
    for (const field of fields) {
      if (!/^\d+$/.test(field)) {
        return null;
      }
      parsed.push(Number(field));
    }
    return parsed;
  };
  const leftParts = parts(left);
  const rightParts = parts(right);
  if (!leftParts || !rightParts) {
    return 0;
  }
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index] ?? 0;
    const b = rightParts[index] ?? 0;
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
  }
  return 0;
}

/** Choose the rejection code for a host/client version pair. */
export function versionMismatchCode(expected: string, actual: string): VersionMismatchCode {
  const direction = compareProductVersions(expected, actual);
  if (direction < 0) {
    return "version_mismatch_client_newer";
  }
  if (direction > 0) {
    return "version_mismatch_client_older";
  }
  return "version_mismatch_unknown";
}

/** English diagnostic message; the UI translates the code at its boundary. */
export function versionMismatchMessage(expected: string, actual: string): string {
  const label = (value: string) => value.trim() || "unknown";
  const code = versionMismatchCode(expected, actual);
  if (code === "version_mismatch_client_newer") {
    return `This room uses RPE Redux ${label(expected)}, but this client is newer (${label(actual)}). Ask the host to update RPE Redux, or use the host's version to join.`;
  }
  if (code === "version_mismatch_client_older") {
    return `This room uses RPE Redux ${label(expected)}, but this client is older (${label(actual)}). Update RPE Redux to join.`;
  }
  return `This room uses RPE Redux ${label(expected)}; this client is ${label(actual)}. Both copies must use the same version.`;
}
