/* eslint-disable max-lines -- capability views, payload projection, and owner-scoped helpers share one gate. */
/**
 * Capability-checked view of the public Redux facade.
 *
 * The facade itself is the complete, frozen host contract. A sandboxed Extension
 * receives a second object assembled here: each handle is either the real
 * handle behind a granted capability or a getter that fails with the stable
 * `capabilityDenied` error. This boundary turns a manifest declaration into an
 * enforceable grant.
 */
import type { LibraryProjectHandle } from "../api/library.ts";
import type { ReduxApi } from "../api/index.ts";
import type { PublicValueDefinition } from "../api/values.ts";
import { createSettingsApi } from "../api/settings.ts";
import { createHelpApi } from "../api/help.ts";
import { editorProjectId } from "../edit/state/publishedValues.ts";
import { values as valueRegistry } from "../state/values.ts";
import {
  HOST_TOOLBAR_CONTROL_IDS,
  toolbar as toolbarRegistry,
} from "../shell/registries/toolbar.ts";
import type { ContextMenuTarget, ToolbarAction } from "../shell/registries/toolbar.ts";
import { contextMenu as contextMenuRegistry } from "../shell/registries/contextMenu.ts";
import type { ContextMenuItem } from "../shell/registries/contextMenu.ts";
import {
  getSidebarEntryOwner,
  registerSidebarDivider,
  registerSidebarItem,
  registerSidebarItems,
} from "../shell/registries/sidebar.ts";
import type { ValueDefinition, ValueHandle } from "../state/values.ts";
import {
  ExtensionCapabilityError,
  extensionActionId,
  requireExtensionCapability,
  type ExtensionCapability,
} from "./capabilities.ts";
import { gatedSelection } from "./selectionGate.ts";
import { recordExtensionCapability, registerExtensionCapabilities } from "./extensionApi.ts";

type Granted = ReadonlySet<ExtensionCapability>;

/** Delegate to the shared capability check and count the outcome. */
function require(
  granted: Granted,
  capability: ExtensionCapability,
  action: string,
  owner?: string,
): void {
  try {
    requireExtensionCapability(granted, capability, action);
  } catch (error) {
    if (owner !== undefined) {
      recordExtensionCapability(owner, capability, "denied");
    }
    throw error;
  }
  if (owner !== undefined) {
    recordExtensionCapability(owner, capability, "used");
  }
}

/** Throw a host-patch denial when the handle has no capability of its own. */
function denied(capability: ExtensionCapability | null, action: string, owner?: string): never {
  if (capability === null) {
    throw new ExtensionCapabilityError("host.patch", action);
  }
  if (owner !== undefined) {
    recordExtensionCapability(owner, capability, "denied");
  }
  throw new ExtensionCapabilityError(capability, action);
}

/** Wrap one handle method so it checks `capability` before delegating. */
function wrapMethod<T extends (...args: never[]) => unknown>(
  granted: Granted,
  capability: ExtensionCapability,
  action: string,
  method: T,
  owner?: string,
): T {
  return ((...args: Parameters<T>) => {
    require(granted, capability, action, owner);
    return method(...args);
  }) as T;
}

/**
 * Project one context-menu target to the reader's declared capabilities.
 *
 * `beat`/`chartSeconds` (and a notes target's line) describe chart position and
 * require `chart.read`; `noteIds` and event `refs` describe the selection and
 * require `selection.read`. A package with neither still receives the surface
 * name so its action can run, but no selection or chart data crosses the gate.
 */
export function projectContextMenuTarget(
  target: ContextMenuTarget | undefined,
  granted: Granted,
): ContextMenuTarget | undefined {
  if (!target || typeof target !== "object") {
    return target;
  }
  const chart = granted.has("chart.read");
  const selection = granted.has("selection.read");
  if (chart && selection) {
    return target;
  }
  if (target.surface === "notes") {
    return {
      surface: "notes",
      ...(selection ? { noteIds: [...target.noteIds] } : {}),
      ...(chart
        ? { lineIndex: target.lineIndex, beat: target.beat, chartSeconds: target.chartSeconds }
        : {}),
    } as ContextMenuTarget;
  }
  if (target.surface === "events") {
    return {
      surface: "events",
      ...(selection ? { refs: [...target.refs] } : {}),
      ...(chart ? { beat: target.beat, chartSeconds: target.chartSeconds } : {}),
    } as ContextMenuTarget;
  }
  return {
    surface: "marker",
    ...(target.markerId === undefined ? {} : { markerId: target.markerId }),
    ...(chart ? { beat: target.beat } : {}),
  } as ContextMenuTarget;
}

/**
 * Project one host event payload to the subscriber's declared capabilities.
 *
 * Event names and lifecycle facts stay available to every `events` subscriber;
 * the document chart, chart position, selection references, and chart
 * fingerprints require `chart.read`/`selection.read`. Unknown future events get
 * their top-level `chart`/`selection` fields removed rather than forwarded.
 */
export function projectExtensionEventPayload(
  name: string,
  payload: unknown,
  granted: Granted,
): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const chart = granted.has("chart.read");
  const selection = granted.has("selection.read");
  const record = payload as Record<string, unknown>;
  if (name.startsWith("document:")) {
    return { ...record, chart: chart ? record.chart : null };
  }
  if (name === "selection:after-paste") {
    const result =
      record.result && typeof record.result === "object" && !Array.isArray(record.result)
        ? (record.result as Record<string, unknown>)
        : {};
    return {
      ...(chart || selection ? { request: record.request } : {}),
      result: {
        changed: result.changed,
        count: result.count,
        ...(chart
          ? {
              beforeFingerprint: result.beforeFingerprint,
              afterFingerprint: result.afterFingerprint,
            }
          : {}),
        ...(selection ? { selection: result.selection } : {}),
      },
    };
  }
  if (name === "extension:callback-error") {
    return payload;
  }
  const projected = { ...record };
  if (!chart && "chart" in projected) {
    projected.chart = null;
  }
  if (!selection && "selection" in projected) {
    delete projected.selection;
  }
  return projected;
}

/** Wrap a package action runner so every invocation receives a projected target. */
function projectRunner(
  run: ((target?: ContextMenuTarget) => unknown) | undefined,
  granted: Granted,
): ((target?: ContextMenuTarget) => unknown) | undefined {
  if (typeof run !== "function") {
    return run;
  }
  return (target?: ContextMenuTarget) => run(projectContextMenuTarget(target, granted));
}

/** Selection handle whose every method keeps its own read or write check. */
export function selectionView(
  selection: ReduxApi["selection"],
  granted: Granted,
  owner?: string,
): ReduxApi["selection"] {
  const gated = gatedSelection(selection, granted);
  return {
    availability: wrapMethod(
      granted,
      "selection.read",
      "selection.availability",
      selection.availability,
      owner,
    ),
    ...gated,
  } as ReduxApi["selection"];
}

/** Document handle split into read and write checks. */
function documentView(api: ReduxApi, granted: Granted, owner?: string): ReduxApi["document"] {
  const read = <T extends (...args: never[]) => unknown>(action: string, method: T): T =>
    wrapMethod(granted, "document.read", action, method, owner);
  const write = <T extends (...args: never[]) => unknown>(action: string, method: T): T =>
    wrapMethod(granted, "document.write", action, method, owner);
  /**
   * Drop a package-supplied export target.
   *
   * The shared document facade keeps the path for development, automation, and
   * the internal document API; only the package view loses it, so the host save
   * flow chooses between the library entry and its own native target.
   */
  const save = ((options: Parameters<typeof api.document.save>[0] = {}) => {
    const { path: _path, ...hostOptions } = options;
    return api.document.save(hostOptions);
  }) as typeof api.document.save;
  return {
    availability: read("document.availability", api.document.availability),
    state: read("document.state", api.document.state),
    create: write("document.create", api.document.create),
    openPath: write("document.openPath", api.document.openPath),
    openBytes: write("document.openBytes", api.document.openBytes),
    save: write("document.save", save),
    close: write("document.close", api.document.close),
  } as ReduxApi["document"];
}

/** Host seams accepted by a gated facade. */
export interface GateExtensionApiOptions {
  /** The library project behind the open document; defaults to `editor.projectId`. */
  readonly currentProjectId?: () => string;
  /**
   * Owns one `theme.subscribe` registration.
   *
   * The runtime supplies this seam so the host can count the subscription
   * against the event budget and release it with the activation. Package code
   * receives no disposer.
   */
  readonly subscribeTheme?: (listener: () => void) => void;
  /** Report a package callback failure without breaking the host notification. */
  readonly reportFailure?: (error: unknown, action: string) => void;
}

/** Read the library project behind the open document, or an empty string. */
function currentProjectId(api: ReduxApi, options: GateExtensionApiOptions): string {
  try {
    const id = options.currentProjectId
      ? options.currentProjectId()
      : api.values.byId.get<unknown>(editorProjectId.id);
    return typeof id === "string" ? id.trim() : "";
  } catch {
    return "";
  }
}

/** Require a current library project for one operation, failing closed when absent. */
function requireProject(
  api: ReduxApi,
  options: GateExtensionApiOptions,
  capability: ExtensionCapability,
  action: string,
): string {
  const id = currentProjectId(api, options);
  if (!id) {
    throw new ExtensionCapabilityError(capability, action);
  }
  return id;
}

/** Require `id` to still be the project behind the open document. */
function requireCurrentProject(
  api: ReduxApi,
  options: GateExtensionApiOptions,
  id: string,
  capability: ExtensionCapability,
  action: string,
): void {
  if (requireProject(api, options, capability, action) !== id) {
    throw new ExtensionCapabilityError(capability, action);
  }
}

/** Bind one project through the root scope factory. */
function scopedProjectHandle(api: ReduxApi, id: string): LibraryProjectHandle {
  return api.library.scope(id);
}

/** One project-bound handle whose calls stay inside the granted capabilities. */
function libraryProjectView(
  api: ReduxApi,
  granted: Granted,
  options: GateExtensionApiOptions,
  id: string,
  owner?: string,
): LibraryProjectHandle {
  const project = scopedProjectHandle(api, id);
  const check = (capability: ExtensionCapability, action: string): void => {
    require(granted, capability, action, owner);
    requireCurrentProject(api, options, id, capability, action);
  };
  const view: LibraryProjectHandle = {
    id,
    get: (requestOptions) => {
      check("library.read", "library.get");
      return project.get(requestOptions);
    },
    update: (patch, requestOptions) => {
      check("library.write", "library.update");
      return project.update(patch, requestOptions);
    },
    remove: (requestOptions) => {
      check("library.write", "library.remove");
      return project.remove(requestOptions);
    },
    duplicate: (name, requestOptions) => {
      check("library.write", "library.duplicate");
      return project.duplicate(name, requestOptions);
    },
    assets: (requestOptions) => {
      check("library.read", "library.assets");
      return project.assets(requestOptions);
    },
    asset: (name, requestOptions) => {
      check("library.read", "library.asset");
      return project.asset(name, requestOptions);
    },
    addAsset: (name, bytes, requestOptions) => {
      check("assets.write", "assets.add");
      return project.addAsset(name, bytes, requestOptions);
    },
    removeAsset: (name, requestOptions) => {
      check("assets.write", "assets.remove");
      return project.removeAsset(name, requestOptions);
    },
    revisions: (query, requestOptions) => {
      check("library.read", "library.revisions");
      return project.revisions(query, requestOptions);
    },
    createRevision: (input, requestOptions) => {
      check("library.write", "library.createRevision");
      return project.createRevision(input, requestOptions);
    },
    revision: (revisionId, requestOptions) => {
      check("library.read", "library.revision");
      return project.revision(revisionId, requestOptions);
    },
    removeRevision: (revisionId, requestOptions) => {
      check("library.write", "library.removeRevision");
      return project.removeRevision(revisionId, requestOptions);
    },
  };
  return Object.freeze(view);
}

/** Library handle limited to the project behind the open document. */
function libraryView(
  api: ReduxApi,
  granted: Granted,
  options: GateExtensionApiOptions,
  owner?: string,
): ReduxApi["library"] {
  const read = <T extends (...args: never[]) => unknown>(action: string, method: T): T =>
    wrapMethod(granted, "library.read", action, method, owner);
  const write = <T extends (...args: never[]) => unknown>(action: string, method: T): T =>
    wrapMethod(granted, "library.write", action, method, owner);
  const project = (
    capability: ExtensionCapability,
    action: string,
    id: string,
  ): LibraryProjectHandle => {
    requireCurrentProject(api, options, id, capability, action);
    return libraryProjectView(api, granted, options, id, owner);
  };
  const currentHandle = (capability: ExtensionCapability, action: string): LibraryProjectHandle => {
    const id = requireProject(api, options, capability, action);
    return libraryProjectView(api, granted, options, id, owner);
  };
  const view: ReduxApi["library"] = {
    availability: read("library.availability", api.library.availability),
    get current(): LibraryProjectHandle {
      require(granted, "library.read", "library.current", owner);
      return currentHandle("library.read", "library.current");
    },
    scope: read("library.scope", (id: string) => project("library.read", "library.scope", id)),
    list: read("library.list", async (query, requestOptions) => {
      const id = requireProject(api, options, "library.read", "library.list");
      const result = await api.library.list(query, requestOptions);
      if (!result.ok) {
        return result;
      }
      const projects = result.value.projects.filter((entry) => entry.id === id);
      return { ok: true, value: { projects, total: projects.length } };
    }),
    create: write("library.create", api.library.create),
    createRaw: write("library.createRaw", api.library.createRaw),
  };
  return Object.freeze(view);
}

/** Toolbar entry kinds a package contribution may use. */
const TOOLBAR_ENTRY_KINDS: ReadonlySet<string> = new Set([
  "action",
  "control",
  "field",
  "divider",
  "spacer",
]);

/** Host-rendered toolbar controls a package may place. */
const HOST_TOOLBAR_CONTROLS: ReadonlySet<string> = new Set(HOST_TOOLBAR_CONTROL_IDS);

/**
 * Reject a malformed toolbar entry before it reaches the shared registry.
 *
 * The TypeScript union protects host code, not a package loaded at runtime. A
 * missing field value or an unknown control id otherwise fails inside the
 * toolbar renderer, so registration returns the stable `invalid_request` code
 * and leaves the registry unchanged.
 */
function validateToolbarEntry(entry: unknown): void {
  /** Throw one stable structural failure for this registration. */
  const reject = (message: string): never => {
    const error = new TypeError(`Invalid toolbar entry: ${message}`) as TypeError & {
      code: string;
    };
    error.code = "invalid_request";
    throw error;
  };
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    reject("registration must be an object");
  }
  const candidate = entry as {
    readonly id?: unknown;
    readonly kind?: unknown;
    readonly value?: unknown;
    readonly controlId?: unknown;
    readonly cells?: unknown;
  };
  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    reject("id must be a non-empty string");
  }
  if (typeof candidate.kind !== "string" || !TOOLBAR_ENTRY_KINDS.has(candidate.kind)) {
    reject(`unknown kind: ${String(candidate.kind)}`);
  }
  if (candidate.kind === "field") {
    if (typeof candidate.value !== "string" || !candidate.value.trim()) {
      reject("a field needs a non-empty value id");
    }
  }
  if (candidate.kind === "control") {
    if (
      typeof candidate.controlId !== "string" ||
      !HOST_TOOLBAR_CONTROLS.has(candidate.controlId)
    ) {
      reject(`unknown control: ${String(candidate.controlId)}`);
    }
  }
  if (
    candidate.cells !== undefined &&
    candidate.cells !== "auto" &&
    (typeof candidate.cells !== "number" ||
      !Number.isInteger(candidate.cells) ||
      candidate.cells < 1 ||
      candidate.cells > 32)
  ) {
    reject('cells must be "auto" or an integer from 1 to 32');
  }
}

/** Toolbar handle restricted to entries this owner registered. */
function toolbarView(
  api: ReduxApi,
  granted: Granted,
  owner: string | undefined,
): ReduxApi["toolbar"] {
  if (!owner) {
    return api.toolbar;
  }
  const owned = new Set<string>();
  const ownShortcutId = (id: string): boolean => id.startsWith(`extension.${owner}.`);
  /**
   * Own entries and own script bindings are readable. Another package's ids
   * stay closed even with `shortcuts.read`; a host id needs that extra grant.
   */
  const shortcutReadable = (action: ToolbarAction): boolean => {
    if (!action || typeof action !== "object") {
      return false;
    }
    const id =
      typeof action.shortcutId === "string"
        ? action.shortcutId
        : typeof action.id === "string"
          ? action.id
          : "";
    if (ownShortcutId(id)) {
      return true;
    }
    if (id.startsWith("extension.")) {
      return false;
    }
    if (granted.has("shortcuts.read")) {
      recordExtensionCapability(owner, "shortcuts.read", "used");
      return true;
    }
    recordExtensionCapability(owner, "shortcuts.read", "denied");
    return false;
  };
  return Object.freeze({
    ...api.toolbar,
    get: () => api.toolbar.get().filter((entry) => owned.has(entry.id)),
    entry: (id: string) => (owned.has(id) ? api.toolbar.entry(id) : undefined),
    register: (entry) => {
      validateToolbarEntry(entry);
      const id = entry.id.startsWith(`extension.${owner}.`)
        ? entry.id
        : extensionActionId(owner, entry.id);
      const scoped =
        entry.kind === "action"
          ? (() => {
              const { shortcutId: _shortcutId, shortcuts: _shortcuts, run, ...rest } = entry;
              return {
                ...rest,
                id,
                ...(run ? { run: projectRunner(run, granted) } : {}),
              };
            })()
          : { ...entry, id };
      const dispose = toolbarRegistry.register(scoped, owner);
      owned.add(id);
      return () => {
        owned.delete(id);
        dispose();
      };
    },
    unregister: (id: string) => {
      if (!owned.has(id)) {
        throw new ExtensionCapabilityError("ui.toolbar", `toolbar.unregister.${id}`);
      }
      owned.delete(id);
      return api.toolbar.unregister(id);
    },
    bindings: (action: ToolbarAction) =>
      shortcutReadable(action) && typeof api.toolbar.bindings === "function"
        ? api.toolbar.bindings(action)
        : [],
    shortcutText: (action: ToolbarAction) =>
      shortcutReadable(action) && typeof api.toolbar.shortcutText === "function"
        ? api.toolbar.shortcutText(action)
        : "",
  });
}

/** Right-click menu handle restricted to rows this owner registered. */
function contextMenuView(
  api: ReduxApi,
  granted: Granted,
  owner: string | undefined,
): ReduxApi["contextMenu"] {
  if (!owner) {
    return api.contextMenu;
  }
  const owned = new Set<string>();
  const localIds = new Map<string, string>();
  const resolveId = (id: string): string => localIds.get(id) ?? id;
  const forget = (id: string, qualified: string): void => {
    if (localIds.get(id) === qualified) {
      localIds.delete(id);
    }
    for (const [local, target] of localIds) {
      if (target === qualified) {
        localIds.delete(local);
      }
    }
  };
  const scope = (entry: ContextMenuItem): ContextMenuItem => {
    const id = entry.id.startsWith(`extension.${owner}.`)
      ? entry.id
      : extensionActionId(owner, entry.id);
    // A package may show a shortcut hint, but the live binding stays host-owned.
    const { shortcutId: _shortcutId, run, ...rest } = entry;
    return { ...rest, id, run: projectRunner(run, granted) as ContextMenuItem["run"] };
  };
  const track = (local: string, qualified: string): void => {
    if (local !== qualified) {
      localIds.set(local, qualified);
    }
  };
  return Object.freeze({
    ...api.contextMenu,
    get: () => api.contextMenu.get().filter((entry) => owned.has(entry.id)),
    entry: (id: string) => {
      const target = resolveId(id);
      return owned.has(target) ? api.contextMenu.entry(target) : undefined;
    },
    register: (entry) => {
      const scoped = scope(entry);
      const dispose = contextMenuRegistry.register(scoped, owner);
      owned.add(scoped.id);
      track(entry.id, scoped.id);
      return () => {
        owned.delete(scoped.id);
        forget(entry.id, scoped.id);
        dispose();
      };
    },
    registerAll: (entries) => {
      const scoped = entries.map(scope);
      const dispose = contextMenuRegistry.registerAll(scoped, owner);
      for (const [index, entry] of scoped.entries()) {
        owned.add(entry.id);
        track(entries[index].id, entry.id);
      }
      return () => {
        for (const [index, entry] of scoped.entries()) {
          owned.delete(entry.id);
          forget(entries[index].id, entry.id);
        }
        dispose();
      };
    },
    update: (entry) => {
      const target = resolveId(entry.id);
      if (!owned.has(target)) {
        throw new ExtensionCapabilityError("ui.contextMenu", `contextMenu.update.${entry.id}`);
      }
      return api.contextMenu.update(scope({ ...entry, id: target }));
    },
    unregister: (id: string) => {
      const target = resolveId(id);
      if (!owned.has(target)) {
        throw new ExtensionCapabilityError("ui.contextMenu", `contextMenu.unregister.${id}`);
      }
      owned.delete(target);
      forget(id, target);
      return api.contextMenu.unregister(target);
    },
  });
}

/** Sidebar handle restricted to entries this owner registered. */
function sidebarView(api: ReduxApi, owner: string | undefined): ReduxApi["sidebar"] {
  if (!owner) {
    return api.sidebar;
  }
  const owned = new Set<string>();
  const localIds = new Map<string, string>();
  const resolveId = (id: string): string => localIds.get(id) ?? id;
  const forget = (id: string, qualified: string): void => {
    if (localIds.get(id) === qualified) {
      localIds.delete(id);
    }
    for (const [local, target] of localIds) {
      if (target === qualified) {
        localIds.delete(local);
      }
    }
  };
  const scopeId = (id: string): string =>
    id.startsWith(`extension.${owner}.`) ? id : extensionActionId(owner, id);
  /**
   * Resolve and authorize one navigation target.
   *
   * `owned` covers entries registered through this gated handle; the registry
   * owner also covers host UI registrations made through `context.ui`, so a
   * package may open or close its own route without gaining another owner's id.
   */
  const assertOwned = (id: string, action: string): string => {
    const candidates = [resolveId(id)];
    if (!id.startsWith("extension.") && !id.startsWith("mod.")) {
      // Host UI registrations use `extension:<owner>:<local>` while the API
      // handle uses its own dot namespace; a bare local id may name either.
      candidates.push(`extension.${owner}.${id}`, `extension:${owner}:${id}`);
    }
    for (const target of candidates) {
      if (owned.has(target) || getSidebarEntryOwner(target) === owner) {
        recordExtensionCapability(owner, "ui.sidebar", "used");
        return target;
      }
    }
    recordExtensionCapability(owner, "ui.sidebar", "denied");
    throw new ExtensionCapabilityError("ui.sidebar", action);
  };
  const track = (
    entries: readonly { readonly local: string; readonly qualified: string }[],
    dispose: () => void,
  ) => {
    for (const { local, qualified } of entries) {
      owned.add(qualified);
      if (local !== qualified) {
        localIds.set(local, qualified);
      }
    }
    return () => {
      for (const { local, qualified } of entries) {
        owned.delete(qualified);
        forget(local, qualified);
      }
      dispose();
    };
  };
  return Object.freeze({
    ...api.sidebar,
    get: () => api.sidebar.get().filter((item) => owned.has(item.id)),
    entry: (id: string) => {
      const target = resolveId(id);
      return owned.has(target) ? api.sidebar.entry(target) : undefined;
    },
    unregister: (id: string) => {
      const target = resolveId(id);
      if (!owned.has(target)) {
        throw new ExtensionCapabilityError("ui.sidebar", `sidebar.unregister.${id}`);
      }
      owned.delete(target);
      forget(id, target);
      return api.sidebar.unregister(target);
    },
    open: (id: string) => api.sidebar.open(assertOwned(id, `sidebar.open.${id}`)),
    close: (id: string) => api.sidebar.close(assertOwned(id, `sidebar.close.${id}`)),
    register: (item) => {
      const qualified = scopeId(item.id);
      return track(
        [{ local: item.id, qualified }],
        registerSidebarItem({ ...item, id: qualified }, owner),
      );
    },
    registerAll: (items) => {
      const scoped = items.map((item) => ({ ...item, id: scopeId(item.id) }));
      return track(
        scoped.map((item, index) => ({ local: items[index].id, qualified: item.id })),
        registerSidebarItems(scoped, owner),
      );
    },
    registerDivider: (divider) => {
      const qualified = scopeId(divider.id);
      return track(
        [{ local: divider.id, qualified }],
        registerSidebarDivider({ ...divider, id: qualified }, owner),
      );
    },
  });
}

/** Values handle that namespaces ids and blocks writes to host-owned values. */
function valuesView(
  api: ReduxApi,
  granted: Granted,
  owner: string | undefined,
  ownedShortcuts: ReadonlySet<string>,
): ReduxApi["values"] {
  if (!owner) {
    return api.values;
  }
  // Local ids stay convenient inside the package, but the registry only ever
  // sees an owner-qualified id. This prevents a package from defining
  // `editor.rate`, `shortcut:document.save`, or another host value id.
  const localIds = new Map<string, string>();
  /**
   * Resolve a package-local id against this owner's namespace.
   *
   * Values created through `define` are tracked in `localIds`. Settings rows are
   * declared by the settings owner instead, so a bare id that names a registered
   * `extension.<owner>.<id>` value resolves there as well. Anything else keeps
   * the original id, which leaves host reads available and makes the write
   * guard reject host and sibling values.
   */
  const resolveId = (id: string): string => {
    const defined = localIds.get(id);
    if (defined !== undefined) {
      return defined;
    }
    if (id.startsWith("extension.") || id.startsWith("mod.") || id.startsWith("shortcut:")) {
      return id;
    }
    const qualified = `extension.${owner}.${id}`;
    return valueRegistry.has(qualified) && valueRegistry.ownerOf(qualified) === owner
      ? qualified
      : id;
  };
  const guardWrite = (id: string): void => {
    const target = resolveId(id);
    const ownValue = valueRegistry.ownerOf(target) === owner;
    const shortcutId = target.startsWith("shortcut:") ? target.slice("shortcut:".length) : null;
    const ownShortcut =
      shortcutId !== null &&
      granted.has("shortcuts") &&
      (ownedShortcuts.has(shortcutId) || shortcutId.startsWith(`extension.${owner}.`));
    if (!ownValue && !ownShortcut) {
      recordExtensionCapability(owner, "values", "denied");
      throw new ExtensionCapabilityError("values", `values.${id}`);
    }
    recordExtensionCapability(owner, "values", "used");
  };
  const handle = <T>(source: ValueHandle<T>): ValueHandle<T> =>
    Object.freeze({
      ...source,
      set: (value: T) => {
        guardWrite(source.id);
        source.set(value);
      },
      update: (partial: Partial<T>) => {
        guardWrite(source.id);
        source.update(partial);
      },
    });
  return Object.freeze({
    define: <T>(definition: PublicValueDefinition<T>): ValueHandle<T> => {
      const id = definition.id.startsWith(`extension.${owner}.`)
        ? definition.id
        : extensionActionId(owner, definition.id);
      if (localIds.has(definition.id)) {
        throw new Error(`Value id is already defined by this Extension: ${definition.id}`);
      }
      // A package definition always lands in the values section. Persistence
      // section selection, a custom storage key, and legacy-key adoption stay
      // host-internal so a package cannot read, migrate, or delete a host
      // preference entry.
      const requested = definition as ValueDefinition<T>;
      const {
        storageKey: _storageKey,
        legacyStorageKey: _legacyStorageKey,
        persist: _persist,
        ...rest
      } = requested;
      const defined = valueRegistry.define({ ...rest, id, persist: true }, owner);
      localIds.set(definition.id, id);
      recordExtensionCapability(owner, "values", "used");
      // Keep every bridged write on the owner check, including a value this
      // package just declared.
      return handle(defined);
    },
    getHandle: <T>(id: string): ValueHandle<T> => handle(api.values.getHandle<T>(resolveId(id))),
    byId: Object.freeze({
      ...api.values.byId,
      has: (id: string) => api.values.byId.has(resolveId(id)),
      ownerOf: (id: string) => api.values.byId.ownerOf(resolveId(id)),
      get: <T>(id: string): T => api.values.byId.get<T>(resolveId(id)),
      subscribe: (id: string, listener: () => void) =>
        api.values.byId.subscribe(resolveId(id), listener),
      set: <T>(id: string, value: T) => {
        guardWrite(id);
        api.values.byId.set(resolveId(id), value);
      },
      update: (id: string, partial: unknown) => {
        guardWrite(id);
        api.values.byId.update(resolveId(id), partial);
      },
      /**
       * Enumerating the registry stays inside the owner boundary: only values
       * this package contributed are returned, so a package cannot discover
       * host values or another package's state.
       */
      snapshot: () => {
        const snapshot = api.values.byId.snapshot();
        const owned: Record<string, unknown> = {};
        for (const [id, value] of Object.entries(snapshot)) {
          if (valueRegistry.ownerOf(id) === owner) {
            owned[id] = value;
          }
        }
        return owned;
      },
      /** Observe only changes to values this package contributed. */
      subscribeAll: (listener: () => void) => valueRegistry.subscribeOwner(owner, listener),
    }),
  });
}

/** Shortcut handle that namespaces categories and tracks owned ids. */
function shortcutsView(
  api: ReduxApi,
  owner: string | undefined,
  ownedShortcuts: Set<string>,
): ReduxApi["shortcuts"] {
  if (!owner) {
    return api.shortcuts;
  }
  const namespaced = (value: string): string =>
    value === `extension.${owner}` || value.startsWith(`extension.${owner}.`)
      ? value
      : extensionActionId(owner, value);
  return Object.freeze({
    ...api.shortcuts,
    registerCategory: (category) =>
      api.shortcuts.registerCategory({
        ...category,
        id: namespaced(category.id),
      }),
    registerShortcut: (definition) => {
      const id = namespaced(definition.id);
      const category = namespaced(definition.category);
      const dispose = api.shortcuts.registerShortcut({
        ...definition,
        id,
        category,
      });
      ownedShortcuts.add(id);
      return () => {
        ownedShortcuts.delete(id);
        dispose();
      };
    },
  });
}

/** Playback handle split into read and control checks. */
function playbackView(api: ReduxApi, granted: Granted, owner?: string): ReduxApi["playback"] {
  const read = <T extends (...args: never[]) => unknown>(action: string, method: T): T =>
    wrapMethod(granted, "playback.read", action, method, owner);
  const control = <T extends (...args: never[]) => unknown>(action: string, method: T): T =>
    wrapMethod(granted, "playback.control", action, method, owner);
  return {
    availability: read("playback.availability", api.playback.availability),
    state: read("playback.state", api.playback.state),
    play: control("playback.play", api.playback.play),
    pause: control("playback.pause", api.playback.pause),
    stop: control("playback.stop", api.playback.stop),
    replay: control("playback.replay", api.playback.replay),
    seek: control("playback.seek", api.playback.seek),
    seekBeat: control("playback.seekBeat", api.playback.seekBeat),
    setRate: control("playback.setRate", api.playback.setRate),
    inspect: read("playback.inspect", api.playback.inspect),
    renderAt: control("playback.renderAt", api.playback.renderAt),
    textures: read("playback.textures", api.playback.textures),
    frames: read("playback.frames", api.playback.frames),
    startMeasurement: control("playback.startMeasurement", api.playback.startMeasurement),
    stopMeasurement: control("playback.stopMeasurement", api.playback.stopMeasurement),
    metrics: read("playback.metrics", api.playback.metrics),
    resetDiagnostics: control("playback.resetDiagnostics", api.playback.resetDiagnostics),
  } as ReduxApi["playback"];
}

/**
 * Design-token handle with a package-owned subscription lifetime.
 *
 * `tokens` reads the live host snapshot. `subscribe` wraps the package callback
 * so a thrown listener is charged to the package without aborting the host's
 * theme notification; the runtime tracks the returned host disposer and the
 * gate returns no cancellation hook to package code.
 */
function themeView(
  api: ReduxApi,
  granted: Granted,
  owner: string | undefined,
  options: GateExtensionApiOptions,
): ReduxApi["theme"] {
  return Object.freeze({
    tokens: () => {
      require(granted, "styles", "theme.tokens", owner);
      return api.theme.tokens();
    },
    subscribe: (listener: () => void) => {
      require(granted, "styles", "theme.subscribe", owner);
      if (typeof listener !== "function") {
        throw new TypeError("Theme subscription requires a callback");
      }
      const wrapped = () => {
        try {
          listener();
        } catch (error) {
          options.reportFailure?.(error, "theme.subscribe");
        }
      };
      if (options.subscribeTheme) {
        options.subscribeTheme(wrapped);
        return;
      }
      api.theme.subscribe(wrapped);
    },
  }) as ReduxApi["theme"];
}

/**
 * Assemble the facade a package may use.
 *
 * Every known handle has a getter even when it is denied, so a package always
 * sees the capability error at the point of access. The `version` getter is
 * always available.
 */
export function gateExtensionApi(
  api: ReduxApi,
  granted: Granted,
  owner?: string,
  options: GateExtensionApiOptions = {},
): ReduxApi {
  if (owner !== undefined) {
    registerExtensionCapabilities(owner, granted);
  }
  const gated = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(gated, "version", {
    enumerable: true,
    get: () => api.version,
  });

  const allow = (key: string, capability: ExtensionCapability, value: unknown): void => {
    Object.defineProperty(gated, key, {
      enumerable: true,
      get: () => {
        require(granted, capability, `api.${key}`, owner);
        return value;
      },
    });
  };
  const denyHandle = (key: string, capability: ExtensionCapability | null): void => {
    Object.defineProperty(gated, key, {
      enumerable: true,
      get: () => denied(capability, `api.${key}`, owner),
    });
  };

  allow("chart", "chart.read", api.chart);
  allow("transaction", "chart.write", api.transaction);
  if (granted.has("selection.read")) {
    allow("selection", "selection.read", selectionView(api.selection, granted, owner));
  } else {
    denyHandle("selection", "selection.read");
  }
  if (granted.has("document.read")) {
    allow("document", "document.read", documentView(api, granted, owner));
  } else {
    denyHandle("document", "document.read");
  }
  if (granted.has("library.read")) {
    allow("library", "library.read", libraryView(api, granted, options, owner));
  } else {
    denyHandle("library", "library.read");
  }
  if (granted.has("playback.read")) {
    allow("playback", "playback.read", playbackView(api, granted, owner));
  } else {
    denyHandle("playback", "playback.read");
  }
  const ownedShortcuts = new Set<string>();
  allow("toolbar", "ui.toolbar", toolbarView(api, granted, owner));
  allow("sidebar", "ui.sidebar", sidebarView(api, owner));
  allow("contextMenu", "ui.contextMenu", contextMenuView(api, granted, owner));
  allow("settings", "settings", owner ? createSettingsApi(owner) : api.settings);
  allow("values", "values", valuesView(api, granted, owner, ownedShortcuts));
  allow("shortcuts", "shortcuts", shortcutsView(api, owner, ownedShortcuts));
  allow("diagnostics", "diagnostics", api.diagnostics);
  allow("hitTest", "preview.read", api.hitTest);
  allow("preview", "preview.read", api.preview);
  allow("layout", "preview.read", api.layout);
  allow("theme", "styles", themeView(api, granted, owner, options));
  allow("help", "ui.guide", owner ? createHelpApi(owner) : api.help);
  // Workspace drawer navigation and Extension management stay host-only: they
  // are omitted from the package facade rather than exposed as denied getters.

  return Object.freeze(gated) as unknown as ReduxApi;
}
