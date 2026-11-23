/**
 * The section-keyed preference document with a synchronous cache.
 *
 * `PreferenceStore` merges disk state, debounces durable writes and notifies per
 * section, while `readPreference` and `writePreference` are the feature-facing
 * helpers over the shared instance.
 */
import { t } from "../../i18n/index.ts";
import {
  MIRROR_KEY,
  memoryMirror,
  browserMirror,
  type PreferenceMirror,
} from "../platform/browser/preferenceMirror.ts";
import { isRecord } from "../utils/guards.ts";

/** Known top-level keys of the preference document. */
export const PREFERENCE_SECTIONS = Object.freeze({
  /** Every shortcut the user changed, keyed by shortcut id. */
  shortcuts: "shortcuts",
  /** Active note texture pack id; image bytes remain on disk. */
  noteSkin: "noteSkin",
  /** Clipboard history entries. */
  clipboard: "clipboard",
  /** Active interface skin id. */
  appearance: "appearance",
  /** Icon package override merged over the active theme's glyphs. */
  icons: "icons",
  /** Committed plugin and editor settings, keyed by their stable setting id. */
  settings: "settings",
  /** Last settings-window page and scroll offset, so reopening continues there. */
  settingsWindow: "settingsWindow",
  /**
   * Values that want durability and no other home: a plugin's own flag, a panel
   * preference the editor owns. Settings and shortcuts keep their own sections.
   */
  values: "values",
  /** Which settings and shortcut values the user explicitly committed. */
  valueMeta: "valueMeta",
  /** Panel sizes and visibility, so the workspace reopens the way it was left. */
  layout: "layout",
  /** Document path -> SQLite project id; a re-save updates the existing project. */
  library: "library",
  /** User-defined curve trajectory presets. */
  trajectory: "trajectory",
  /** Multi-edit parameter drafts and history. */
  multiEdit: "multiEdit",
  /** Override for the local service origin. */
  server: "server",
  /** Room server, display name, and the participant colour used for presence. */
  collaboration: "collaboration",
  /** Interface language; absent means "follow the machine". */
  language: "language",
  /** Toolbar judge-line selection mode and folder disclosure state. */
  lineSelection: "lineSelection",
  /** Workspace sampler grid, angle step, and XY binding. */
  sampler: "sampler",
  /** Home-screen presentation choices, such as the chart library view. */
  welcome: "welcome",
  /** First-run walkthrough answer and completion state. */
  onboarding: "onboarding",
  /** The last RPE migration's hotkey mapping, kept so the shortcut page can explain it. */
  rpe: "rpe",
  /** Last directory used by each native file dialog. */
  dialogs: "dialogs",
});

/** A known top-level key of the preference document. */
export type PreferenceSection = (typeof PREFERENCE_SECTIONS)[keyof typeof PREFERENCE_SECTIONS];

const SECTION_NAMES: ReadonlySet<string> = new Set(Object.values(PREFERENCE_SECTIONS));

/** Clone JSON-shaped preference data before handing it across an async boundary. */
function clonePreference<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => clonePreference(item)) as T;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clonePreference(item)]),
    ) as T;
  }
  return value;
}

/** Produce an order-independent representation for JSON-shaped preference data. */
function preferenceSignature(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => preferenceSignature(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${preferenceSignature(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

/** Compare preference values without treating object key order as a change. */
function samePreference(left: unknown, right: unknown): boolean {
  return preferenceSignature(left) === preferenceSignature(right);
}

/** Merge local changes into the latest durable section without losing peer keys. */
function mergePreferenceSection(base: unknown, local: unknown, remote: unknown): unknown {
  if (!isRecord(base) || !isRecord(local)) {
    return clonePreference(local);
  }
  const merged = isRecord(remote) ? clonePreference(remote) : {};
  const keys = new Set([...Object.keys(base), ...Object.keys(local)]);
  for (const key of keys) {
    const baseHas = Object.hasOwn(base, key);
    const localHas = Object.hasOwn(local, key);
    const changed = baseHas !== localHas || !samePreference(local[key], base[key]);
    if (!changed) {
      continue;
    }
    if (localHas) {
      merged[key] = clonePreference(local[key]);
    } else {
      delete merged[key];
    }
  }
  return merged;
}

/** The host operations the store needs to read and write durable preferences. */
export interface PreferenceClient {
  preferences(): Promise<{ values?: unknown }>;
  savePreferences(values: Record<string, unknown>): Promise<unknown>;
}
/** Durable-backend state exposed to the settings UI. */
export interface PreferenceStatus {
  durable: boolean;
  error: string;
  sections: number;
}
/** Counts produced by one attach/reconcile pass. */
export interface AttachResult {
  adopted: number;
  uploaded: number;
}

/**
 * Section-keyed preference document with a synchronous cache in front of an
 * asynchronous durable backend.
 */
export class PreferenceStore {
  /** Browser or memory mirror the cache is restored from and written to. */
  readonly mirror: PreferenceMirror;
  /** Current section values, mirrored synchronously for readers. */
  values: Record<string, unknown>;
  /** Durable client once attached; null until the host provides one. */
  client: PreferenceClient | null = null;
  /** Whether the last durable write succeeded. */
  durable = false;
  /** Last durable-write error message, or empty. */
  error = "";
  /** Tail of the serialized write queue. */
  pending: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | 0 = 0;
  private dirty = new Map<PreferenceSection, number>();
  private dirtyBaselines = new Map<PreferenceSection, unknown>();
  private revision = 0;
  private attachment: Promise<AttachResult> | null = null;
  private readonly sectionListeners = new Map<PreferenceSection, Set<() => void>>();
  private readonly statusListeners = new Set<() => void>();
  private statusSnapshot: PreferenceStatus = { durable: false, error: "", sections: 0 };

  /** Restore cached sections and publish the initial status. */
  constructor({ mirror }: { mirror?: PreferenceMirror | null } = {}) {
    this.mirror =
      mirror === undefined ? (browserMirror() ?? memoryMirror()) : (mirror ?? memoryMirror());
    this.values = this.restore();
    this.publishStatus();
  }

  /** Subscribe to durable-status changes. */
  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Rebuild the status snapshot and notify its subscribers. */
  private publishStatus(): void {
    this.statusSnapshot = {
      durable: this.durable,
      error: this.error,
      sections: Object.keys(this.values).length,
    };
    for (const listener of [...this.statusListeners]) {
      listener();
    }
  }

  /** Load known sections from the mirror, ignoring malformed document data. */
  private restore(): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(this.mirror.getItem(MIRROR_KEY) ?? "{}");
      if (!isRecord(parsed)) {
        return {};
      }
      return Object.fromEntries(Object.entries(parsed).filter(([key]) => SECTION_NAMES.has(key)));
    } catch {
      return {};
    }
  }

  /** Write the cache to the mirror; storage failures are non-fatal. */
  private mirrorNow(): void {
    try {
      this.mirror.setItem(MIRROR_KEY, JSON.stringify(this.values));
    } catch {
      // A full or disabled mirror must never take the editor down.
    }
  }

  /** Read one section, returning `fallback` when it has no stored value. */
  read<T>(section: PreferenceSection, fallback: T): T;
  read(section: PreferenceSection): unknown;
  read(section: PreferenceSection, fallback: unknown = null): unknown {
    if (!SECTION_NAMES.has(section)) {
      throw new Error(t("system.preferences.unknownSection", { section }));
    }
    const value = this.values[section];
    return value === undefined ? fallback : value;
  }

  /** Whether a section currently has a value. */
  has(section: PreferenceSection): boolean {
    return this.values[section] !== undefined;
  }

  /** Observe one preference section when a local or durable value is adopted. */
  subscribe(section: PreferenceSection, listener: () => void): () => void {
    let listeners = this.sectionListeners.get(section);
    if (!listeners) {
      listeners = new Set();
      this.sectionListeners.set(section, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        this.sectionListeners.delete(section);
      }
    };
  }

  /** Notify the listeners registered for one section. */
  private notify(section: PreferenceSection): void {
    for (const listener of [...(this.sectionListeners.get(section) ?? [])]) {
      listener();
    }
  }

  /** Update one section, mirror it, schedule a durable write, and notify. */
  write<T>(section: PreferenceSection, value: T): T {
    if (!SECTION_NAMES.has(section)) {
      throw new Error(t("system.preferences.unknownSection", { section }));
    }
    if (!this.dirty.has(section)) {
      this.dirtyBaselines.set(section, clonePreference(this.values[section]));
    }
    this.values[section] = value;
    this.dirty.set(section, ++this.revision);
    this.mirrorNow();
    this.schedule();
    this.notify(section);
    this.publishStatus();
    return value;
  }

  /** Every section, as a plain object. */
  snapshot(): Record<string, unknown> {
    return { ...this.values };
  }

  /** Durable backend status for the settings UI. */
  status(): PreferenceStatus {
    return this.statusSnapshot;
  }

  /** Debounce a durable write after the first change that needs one. */
  private schedule(): void {
    if (!this.client || this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.pending = this.pending.then(() => this.push());
    }, 250);
  }

  /** Merge the latest durable document with local changes and clear written revisions. */
  private async push(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      const revisions = new Map(this.dirty);
      const localValues = new Map<PreferenceSection, unknown>();
      const baselines = new Map<PreferenceSection, unknown>();
      for (const section of revisions.keys()) {
        localValues.set(section, clonePreference(this.values[section]));
        baselines.set(section, clonePreference(this.dirtyBaselines.get(section)));
      }

      const response = await this.client.preferences();
      const stored = isRecord(response?.values) ? response.values : {};
      const payload: Record<string, unknown> = Object.fromEntries(
        Object.entries(stored).filter(([section]) => SECTION_NAMES.has(section)),
      );
      for (const [section, value] of Object.entries(this.values)) {
        if (payload[section] === undefined && !revisions.has(section as PreferenceSection)) {
          payload[section] = clonePreference(value);
        }
      }
      for (const section of revisions.keys()) {
        payload[section] = mergePreferenceSection(
          baselines.get(section),
          localValues.get(section),
          stored[section],
        );
      }

      await this.client.savePreferences(payload);
      const changedSections = new Set<PreferenceSection>();
      for (const [section, revision] of revisions) {
        if (this.dirty.get(section) === revision) {
          const next = payload[section];
          if (!samePreference(this.values[section], next)) {
            this.values[section] = clonePreference(next);
            changedSections.add(section);
          }
          this.dirty.delete(section);
          this.dirtyBaselines.delete(section);
        }
      }
      for (const [section, value] of Object.entries(payload)) {
        if (!SECTION_NAMES.has(section) || this.dirty.has(section as PreferenceSection)) {
          continue;
        }
        if (!samePreference(this.values[section], value)) {
          this.values[section] = clonePreference(value);
          changedSections.add(section as PreferenceSection);
        }
      }
      this.mirrorNow();
      this.durable = true;
      this.error = "";
      this.publishStatus();
      for (const section of changedSections) {
        this.notify(section);
      }
    } catch (error) {
      this.durable = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.publishStatus();
    }
  }

  /**
   * Bind a client and reconcile both directions.
   *
   * Sections that exist only in SQLite are adopted (the database outranks the
   * mirror); sections the database has never seen are uploaded so an upgrade
   * from mirror-only does not lose settings.
   */
  attach(client: PreferenceClient): Promise<AttachResult> {
    if (!this.attachment) {
      this.attachment = this.reconcile(client).finally(() => {
        this.attachment = null;
      });
    }
    return this.attachment;
  }

  /** Wait for an in-flight database read before committing a discrete choice. */
  async ready(): Promise<void> {
    await this.attachment;
  }

  /** Merge the database document with unsaved local sections and upload the rest. */
  private async reconcile(client: PreferenceClient): Promise<AttachResult> {
    const protectedSections = new Set(this.dirty.keys());
    try {
      const payload = await client.preferences();
      const stored = isRecord(payload?.values) ? payload.values : {};
      const mine = Object.keys(this.values);
      let adopted = 0;
      const adoptedSections: PreferenceSection[] = [];
      for (const [section, value] of Object.entries(stored)) {
        // Unknown sections are ignored, so they must not be counted as adopted.
        if (
          !SECTION_NAMES.has(section) ||
          protectedSections.has(section as PreferenceSection) ||
          this.dirty.has(section as PreferenceSection)
        ) {
          continue;
        }
        this.values[section] = value;
        adopted++;
        adoptedSections.push(section as PreferenceSection);
      }
      this.durable = true;
      this.error = "";
      this.client = client;
      this.publishStatus();
      const missing = [
        ...new Set([
          ...mine.filter((section) => stored[section] === undefined),
          ...protectedSections,
          ...this.dirty.keys(),
        ]),
      ];
      if (missing.length) {
        await this.push();
      }
      this.mirrorNow();
      for (const section of adoptedSections) {
        this.notify(section);
      }
      return { adopted, uploaded: missing.length };
    } catch (error) {
      this.durable = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.publishStatus();
      return { adopted: 0, uploaded: 0 };
    }
  }

  /** Wait for every write scheduled so far to reach SQLite. */
  async flush(): Promise<PreferenceStatus> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
      this.pending = this.pending.then(() => this.push());
    }
    await this.pending;
    return this.status();
  }
}

/** Process-wide store used by the editor and the React shell. */
export const preferences = new PreferenceStore();

/** Read one preference section from the process-wide store. */
export const readPreference = <T>(section: PreferenceSection, fallback: T): T =>
  preferences.read(section, fallback);
/** Write one preference section to the process-wide store. */
export const writePreference = <T>(section: PreferenceSection, value: T): T =>
  preferences.write(section, value);

/** A `getItem`/`setItem` view over one section for the modules that want a cell. */
export function preferenceStorage(
  section: PreferenceSection,
  store: PreferenceStore = preferences,
) {
  const cell = (): Record<string, string> => {
    const value = store.read(section, null);
    return isRecord(value) ? (value as Record<string, string>) : {};
  };
  return {
    getItem: (key: string): string | null => cell()[key] ?? null,
    setItem: (key: string, value: string): void => {
      store.write(section, { ...cell(), [key]: value });
    },
  };
}
