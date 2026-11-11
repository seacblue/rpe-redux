/**
 * Owns the document lifecycle facade shared by Extensions and smoke clients.
 *
 * The shared facade forwards an explicit export path so development,
 * automation, and the internal document API can choose a target. The Extension
 * capability gate drops that path before a package call reaches this facade.
 * Replacement policy is explicit, and unsaved data is reported as a structured
 * result. Whole-chart reads live on `chart.snapshot()`; this handle owns
 * lifecycle state only.
 */
import { getDocumentApi } from "../edit/document/api.ts";
import { availabilityFor, unavailableResult } from "./support.ts";
import type { ApiAvailability, ApiResult } from "./contract.ts";
import type {
  CreateDocumentOptions,
  DocumentActionOptions,
  DocumentApi,
  DocumentSnapshot,
  DocumentState,
  OpenBytesOptions,
  SaveDocumentOptions,
} from "../edit/document/api.ts";

/** Descriptor returned while no document runtime is connected. */
const emptyState: DocumentState = Object.freeze({
  status: "empty",
  path: null,
  name: "",
  format: "memory",
  dirty: false,
  fingerprint: null,
});

/** The connected document runtime, or null before the editor mounts. */
function api(): DocumentApi | null {
  return getDocumentApi();
}

/** A structured unavailable result for a document call made before mount. */
function unavailable<T>(): Promise<ApiResult<T>> {
  return Promise.resolve(unavailableResult<T>("No editor document runtime connected"));
}

/** Document lifecycle operations exposed to extensions and automation. */
export const document = Object.freeze({
  /** Report whether a document runtime is connected. */
  availability(): ApiAvailability {
    return availabilityFor(api(), "No editor document runtime connected");
  },
  /** The current document descriptor, committed fingerprint, and dirty state. */
  state(): DocumentState {
    return api()?.state() ?? emptyState;
  },
  /** Create a document from a new or supplied chart. */
  create(options?: CreateDocumentOptions): Promise<ApiResult<DocumentSnapshot>> {
    return api()?.create(options) ?? unavailable();
  },
  /** Open a chart from an explicit path. */
  openPath(path: string, options?: DocumentActionOptions): Promise<ApiResult<DocumentSnapshot>> {
    return api()?.openPath(path, options) ?? unavailable();
  },
  /** Open a chart from supplied bytes. */
  openBytes(bytes: Uint8Array, options?: OpenBytesOptions): Promise<ApiResult<DocumentSnapshot>> {
    return api()?.openBytes(bytes, options) ?? unavailable();
  },
  /**
   * Save through the host's user-visible flow or an explicit export target.
   *
   * `path` is forwarded for development, automation, and in-process host
   * clients. The Extension capability gate strips it before calling this
   * facade, so a package cannot select a filesystem target.
   */
  save(options: SaveDocumentOptions = {}): Promise<ApiResult<DocumentSnapshot>> {
    return api()?.save(options) ?? unavailable();
  },
  /** Close the document after applying the replacement policy. */
  close(options?: DocumentActionOptions): Promise<ApiResult<DocumentSnapshot>> {
    return api()?.close(options) ?? unavailable();
  },
});

export type {
  CreateDocumentOptions,
  DocumentActionOptions,
  DocumentFormat,
  DocumentReplacePolicy,
  DocumentSnapshot,
  DocumentState,
  DocumentStatus,
  OpenBytesOptions,
  SaveDocumentOptions,
} from "../edit/document/api.ts";
