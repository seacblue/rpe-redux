/**
 * Desktop preference writer.
 *
 * The sidecar requires a per-process token for the durable document because the
 * settings section carries the Code Cell consent switch. The token is
 * read from `preferences-endpoint.json` through the native file bridge, never
 * from an HTTP response. Browser development keeps the tokenless path the local
 * development sidecar accepts from its Vite origin.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  LocalLibraryError,
  type LocalLibrary,
  type RequestOptions,
} from "../../core/global/library/client.ts";
import { isDesktop } from "../../core/platform/environment.ts";
import type { PreferenceClient } from "../../core/state/preferences.ts";

const DEFAULT_TOKEN_HEADER = "X-Redux-Preference-Token";

/** The endpoint route's response, before the token file is read. */
interface PreferencesEndpoint {
  path?: unknown;
  header?: unknown;
}

/** A token and the header that carries it. */
interface WriteCredential {
  origin: string;
  header: string;
  token: string;
}

/** Parse the private endpoint file and return its token. */
function parseCredentialFile(text: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const token = (value as { token?: unknown }).token;
  return typeof token === "string" && token.trim() ? token : null;
}

/** Read the write credential through the native file bridge, or null when unavailable. */
async function readCredential(origin: string): Promise<WriteCredential | null> {
  if (!isDesktop()) {
    return null;
  }
  try {
    const response = await fetch(`${origin}/api/preferences/endpoint`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const endpoint = (await response.json()) as PreferencesEndpoint;
    if (typeof endpoint.path !== "string" || !endpoint.path) {
      return null;
    }
    const raw = await invoke<ArrayBuffer | number[]>("read_picked_file", {
      path: endpoint.path,
    });
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : Uint8Array.from(raw);
    const token = parseCredentialFile(new TextDecoder().decode(bytes));
    if (!token) {
      return null;
    }
    return {
      origin,
      header:
        typeof endpoint.header === "string" && endpoint.header
          ? endpoint.header
          : DEFAULT_TOKEN_HEADER,
      token,
    };
  } catch {
    return null;
  }
}

/**
 * Wrap one library client with the preference-write credential.
 *
 * The token is cached per origin and refreshed once when the service reports
 * that a restarted sidecar no longer recognizes it.
 */
export function createDesktopPreferenceClient(library: LocalLibrary): PreferenceClient {
  let credential: WriteCredential | null = null;
  let loading: Promise<WriteCredential | null> | null = null;

  const load = async (): Promise<WriteCredential | null> => {
    if (credential?.origin === library.origin) {
      return credential;
    }
    if (!loading) {
      loading = readCredential(library.origin)
        .then((next) => {
          credential = next;
          return next;
        })
        .finally(() => {
          loading = null;
        });
    }
    return loading;
  };

  const write = (values: Record<string, unknown>, current: WriteCredential) => {
    const options: RequestOptions = {
      headers: { [current.header]: current.token },
    };
    return library.savePreferences(values, options);
  };

  return {
    preferences: () => library.preferences(),
    savePreferences: async (values) => {
      const current = await load();
      if (!current) {
        if (!isDesktop()) {
          return library.savePreferences(values);
        }
        throw new Error("Preference write credential is unavailable");
      }
      try {
        return await write(values, current);
      } catch (error) {
        if (!(error instanceof LocalLibraryError) || error.status !== 401) {
          throw error;
        }
        credential = null;
        const refreshed = await load();
        if (!refreshed) {
          throw error;
        }
        return write(values, refreshed);
      }
    },
  };
}
