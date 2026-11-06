/** Keep automatic update-download decisions independent of host and UI state. */
import type { UpdateDownloadPolicy } from "../../settings/updateKeys.ts";
import type { NetworkStatus } from "./network.ts";

/** Whether a connection class satisfies one automatic package-download policy. */
export function allowsAutomaticDownload(
  policy: UpdateDownloadPolicy,
  connection: NetworkStatus,
): boolean {
  if (policy === "never" || !connection.available || connection.kind === "offline") {
    return false;
  }
  if (policy === "all") {
    return true;
  }
  return connection.kind === "wifi" && connection.metered !== true;
}
