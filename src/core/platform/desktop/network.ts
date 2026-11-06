/** Adapt the desktop host's cost-aware network facts for frontend policy checks. */
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../environment.ts";

/** Connection classes relevant to update download policy. */
export type NetworkConnectionType =
  "wifi" | "cellular" | "ethernet" | "other" | "offline" | "unknown";

/** The native facts used to decide whether a background download is suitable. */
export interface NetworkStatus {
  readonly kind: NetworkConnectionType;
  readonly available: boolean;
  readonly metered: boolean | null;
}

/** Read the current network facts from the desktop host. */
export async function networkStatus(): Promise<NetworkStatus> {
  const unavailable: NetworkStatus = { kind: "unknown", available: false, metered: null };
  if (!isDesktop()) {
    return unavailable;
  }
  try {
    const result = await invoke<Partial<NetworkStatus>>("network_connection_status");
    const kind = result.kind;
    return {
      kind: ["wifi", "cellular", "ethernet", "other", "offline"].includes(kind ?? "")
        ? (kind as NetworkConnectionType)
        : "unknown",
      available: result.available === true,
      metered: result.metered === true || result.metered === false ? result.metered : null,
    };
  } catch {
    return unavailable;
  }
}
