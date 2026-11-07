/**
 * Desktop editor bridge.
 *
 * The Go sidecar accepts local Code Cell requests and forwards them to this
 * WebSocket. The bridge forwards to the mounted editor adapter and leaves cell
 * execution and chart edits to the sandbox runtime. Every answered frame is
 * recorded in the shared AI activity log for the inspector
 * pane. The bridge authenticates with the per-process token the sidecar writes
 * beside its database. It stays connected so the guide remains readable when
 * code execution is off; the adapter and cell runtime enforce that setting for
 * every run request.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCodeCellApi } from "../../core/edit/codecell/api.ts";
import { codeCellActivity } from "../../core/edit/codecell/activity.ts";
import {
  codeCellBridgeUrl,
  parseCodeCellEndpointFile,
} from "../../core/edit/codecell/bridgeEndpoint.ts";
import { getCodeCellGuide } from "../../core/edit/codecell/guide.ts";
import { aiServiceOrigin } from "../../core/global/library/client.ts";
import { isDesktop } from "../../core/platform/environment.ts";

const RECONNECT_MS = 1_500;

/** Reads the sidecar's handshake token through the native file bridge. */
async function readBridgeToken(origin: string): Promise<string | null> {
  try {
    const response = await fetch(`${origin}/api/cell/endpoint`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { path?: unknown };
    if (typeof payload.path !== "string" || !payload.path) {
      return null;
    }
    const raw = await invoke<ArrayBuffer | number[]>("read_picked_file", { path: payload.path });
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : Uint8Array.from(raw);
    return parseCodeCellEndpointFile(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** Connects the editor bridge to the sidecar socket; returns a disposer that closes it. */
export function installCodeCellBridge(): () => void {
  if (!isDesktop()) {
    return () => {};
  }
  let disposed = false;
  let socket: WebSocket | null = null;
  let connecting = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  /** Drops any scheduled reconnect. */
  const clearRetry = () => {
    if (retry) {
      clearTimeout(retry);
      retry = null;
    }
  };

  /** Schedules one reconnect attempt while the bridge is installed. */
  const schedule = () => {
    if (disposed || retry) {
      return;
    }
    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, RECONNECT_MS);
  };

  /** Stops reconnecting and closes the live socket. */
  const close = () => {
    clearRetry();
    connecting = false;
    const current = socket;
    socket = null;
    current?.close(1000, "bridge-disposed");
  };

  /** Handles one request frame, records it, and replies on the socket that delivered it. */
  const answer = async (data: string, current: WebSocket) => {
    let message: { readonly type?: string; readonly id?: string; readonly request?: unknown };
    try {
      message = JSON.parse(data) as typeof message;
    } catch {
      return;
    }
    if (message.type !== "request" || typeof message.id !== "string") {
      return;
    }
    const request = message.request;
    const method =
      request && typeof request === "object" && "method" in request
        ? (request as { method?: unknown }).method
        : null;
    const activity = codeCellActivity.begin(request);
    let response: unknown;
    try {
      if (method === "cell.guide") {
        // The guide is readable before a chart mounts so clients can discover the API.
        response = {
          ok: true,
          value: { text: getCodeCellGuide() },
          revisions: { chartFingerprint: null, diskSnapshot: null, generation: 0 },
        };
      } else {
        const api = getCodeCellApi();
        if (!api) {
          response = {
            ok: false,
            error: { code: "unavailable", message: "No editor chart runtime is mounted" },
            revisions: null,
          };
        } else {
          response = await api.handle(request);
        }
      }
    } catch (error) {
      response = {
        ok: false,
        error: {
          code: "failed",
          message: error instanceof Error ? error.message : String(error),
        },
        revisions: null,
      };
    }
    activity.finish(response);
    // The request belongs to the bridge that delivered it; send the reply on
    // that socket even if the editor reconnects while the answer is in flight.
    if (current !== socket || current.readyState !== WebSocket.OPEN) {
      return;
    }
    current.send(JSON.stringify({ type: "response", id: message.id, response }));
  };

  /** Opens one socket unless a connection is already live; reconnects on close. */
  const connect = async (): Promise<void> => {
    if (disposed || connecting || socket) {
      return;
    }
    connecting = true;
    try {
      if (disposed) {
        connecting = false;
        return;
      }
      const origin = aiServiceOrigin();
      const token = await readBridgeToken(origin);
      if (disposed || !token) {
        connecting = false;
        schedule();
        return;
      }
      const current = new WebSocket(codeCellBridgeUrl(origin, token));
      socket = current;
      current.addEventListener("open", () => {
        connecting = false;
      });
      current.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          void answer(event.data, current);
        }
      });
      current.addEventListener("close", () => {
        if (socket === current) {
          socket = null;
        }
        connecting = false;
        schedule();
      });
      current.addEventListener("error", () => {
        current.close();
      });
    } catch {
      connecting = false;
      schedule();
    }
  };

  void connect();
  return () => {
    disposed = true;
    close();
  };
}
