/**
 * Owns Extension-provided workspace shader passes.
 *
 * The preview consumes the active list as ordinary full-screen shader passes,
 * while export projection can embed the enabled pass descriptors in
 * `META.ReduxWorkspaceShaderPasses`. The chart remains portable: external
 * players may ignore the Redux metadata, and the export pipeline reports that
 * fact instead of silently claiming visual equivalence.
 */
import {
  CHART_RENDER_LAYER_IDS,
  isMaskableChartRenderLayer,
  maskSelectionForLayers,
  renderLayerSelectorKey,
  type ChartRenderLayerId,
} from "./renderLayers.ts";

/** Where a workspace pass is inserted relative to chart-authored effects. */
export type WorkspaceShaderPosition = "before-chart" | "after-chart";
/** How a workspace pass participates in a chart export. */
export type WorkspaceShaderExportPolicy = "embed" | "warn" | "ignore";
/** Whether an export keeps Redux's semantic layer contract or lowers it. */
export type WorkspaceShaderExportMode = "layered" | "standalone";

/** Semantic object layers sampled by a workspace shader pass. */
export interface WorkspaceShaderLayerMaskDefinition {
  readonly kind?: "render-layers";
  readonly layers: readonly ChartRenderLayerId[];
}

/** A semantic selector for an authored note field, kept in its own atlas. */
export interface WorkspaceShaderNoteFieldMaskDefinition {
  readonly kind: "note-field";
  readonly field: string;
  readonly value: string | number | boolean;
  /** Channel used by the field atlas so multiple values can share one texture. */
  readonly channel?: 0 | 1 | 2 | 3;
}

/** One mask selector family exposed to workspace shader passes. */
export type WorkspaceShaderMaskDefinition =
  WorkspaceShaderLayerMaskDefinition | WorkspaceShaderNoteFieldMaskDefinition;

/** A shader source that does not depend on Redux's built-in layer wrapper. */
export interface WorkspaceShaderPortableDefinition {
  readonly source: string;
  /** True only when this source preserves the layered pass exactly. */
  readonly exact?: boolean;
}

/** Resolved selector passed to the frontend shader pipeline. */
export interface WorkspaceShaderMaskBinding {
  readonly key: string;
  readonly atlas: "layers" | "note-fields";
  readonly layers: readonly ChartRenderLayerId[];
  readonly field?: string;
  readonly value?: string | number | boolean;
  /** One-hot or union selection for the RGBA note-layer atlas. */
  readonly selection: readonly [number, number, number, number];
}

/** One Extension-owned full-screen GLSL pass. */
export interface WorkspaceShaderPassDefinition {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  readonly values?: Readonly<Record<string, number | readonly number[]>>;
  readonly position?: WorkspaceShaderPosition;
  readonly order?: number;
  readonly enabled?: boolean;
  readonly exportPolicy?: WorkspaceShaderExportPolicy;
  readonly mask?: WorkspaceShaderMaskDefinition;
  /** Optional source for players that cannot provide semantic masks. */
  readonly portable?: WorkspaceShaderPortableDefinition;
}

/** Status visible to API consumers. */
export interface WorkspaceShaderPassStatus {
  readonly id: string;
  readonly label: string;
  readonly owner?: string;
  readonly enabled: boolean;
  readonly position: WorkspaceShaderPosition;
  readonly order: number;
  readonly exportPolicy: WorkspaceShaderExportPolicy;
  readonly mask?: WorkspaceShaderMaskDefinition;
  readonly portable: boolean;
}

/** Structural renderer packet returned without importing the frontend layer. */
export interface WorkspaceShaderRenderPass {
  readonly shader: string;
  readonly values?: Readonly<Record<string, number | readonly number[]>>;
  readonly global: true;
  readonly workspacePassId: string;
  readonly mask?: WorkspaceShaderMaskBinding;
}

/** Export warning for a workspace shader that may not survive another player. */
export interface WorkspaceShaderWarning {
  readonly code: string;
  readonly message: string;
  readonly passId: string;
}

interface StoredPass {
  definition: WorkspaceShaderPassDefinition;
  owner?: string;
  sequence: number;
  enabled: boolean;
}

const PASS_ID = /^[a-z][a-z0-9._-]{1,127}$/u;
const WORKSPACE_PREFIX = "redux.workspace.shader.";

/** Validate the JSON-safe and GLSL fields of one pass. */
function validate(definition: WorkspaceShaderPassDefinition): void {
  if (!PASS_ID.test(definition.id.trim())) {
    throw new Error(`Workspace shader pass id is invalid: ${definition.id}`);
  }
  if (!definition.label.trim()) {
    throw new Error("Workspace shader pass label must not be empty");
  }
  if (!definition.source.trim()) {
    throw new Error(`Workspace shader pass source is empty: ${definition.id}`);
  }
  if (definition.order !== undefined && !Number.isFinite(definition.order)) {
    throw new Error(`Workspace shader pass order is invalid: ${definition.id}`);
  }
  for (const [name, value] of Object.entries(definition.values ?? {})) {
    const valid =
      (typeof value === "number" && Number.isFinite(value)) ||
      (Array.isArray(value) && value.every((entry) => Number.isFinite(entry)));
    if (!valid || !name.trim()) {
      throw new Error(`Workspace shader uniform is invalid: ${definition.id}.${name}`);
    }
  }
  if (definition.mask) {
    if (definition.mask.kind === "note-field") {
      if (!definition.mask.field.trim()) {
        throw new Error(`Workspace shader note mask field is empty: ${definition.id}`);
      }
      if (!["string", "number", "boolean"].includes(typeof definition.mask.value)) {
        throw new Error(`Workspace shader note mask value is invalid: ${definition.id}`);
      }
      if (
        definition.mask.channel !== undefined &&
        ![0, 1, 2, 3].includes(definition.mask.channel)
      ) {
        throw new Error(`Workspace shader note mask channel is invalid: ${definition.id}`);
      }
    } else {
      if (!definition.mask.layers.length) {
        throw new Error(`Workspace shader mask has no layers: ${definition.id}`);
      }
      const unique = [...new Set(definition.mask.layers)];
      for (const layer of unique) {
        if (!CHART_RENDER_LAYER_IDS.includes(layer)) {
          throw new Error(`Workspace shader mask layer is unknown: ${definition.id}.${layer}`);
        }
        if (!isMaskableChartRenderLayer(layer)) {
          throw new Error(
            `Workspace shader mask layer is not rendered yet: ${definition.id}.${layer}`,
          );
        }
      }
    }
  }
  if (definition.portable && !definition.portable.source.trim()) {
    throw new Error(`Workspace shader portable source is empty: ${definition.id}`);
  }
}

/** Registry for full-screen shader passes that are not chart events. */
export class WorkspaceShaderPassRegistry {
  private readonly passes = new Map<string, StoredPass>();
  private nextSequence = 0;
  private revision = 0;
  private exportMode: WorkspaceShaderExportMode = "layered";
  private readonly listeners = new Set<() => void>();

  /** Register or replace one owner-scoped workspace pass. */
  register(definition: WorkspaceShaderPassDefinition, owner?: string): WorkspaceShaderPassStatus {
    const normalized = { ...definition, id: definition.id.trim() };
    validate(normalized);
    const previous = this.passes.get(normalized.id);
    if (previous && previous.owner !== owner) {
      throw new Error(`Workspace shader pass is owned by another Extension: ${normalized.id}`);
    }
    this.passes.set(normalized.id, {
      definition: Object.freeze({
        ...normalized,
        ...(normalized.values ? { values: Object.freeze({ ...normalized.values }) } : {}),
      }),
      owner,
      sequence: previous?.sequence ?? this.nextSequence++,
      enabled: normalized.enabled ?? previous?.enabled ?? true,
    });
    this.changed();
    return this.status(this.passes.get(normalized.id)!);
  }

  /** Remove one pass, refusing another Extension's owner. */
  unregister(id: string, owner?: string): boolean {
    const pass = this.passes.get(id);
    if (!pass) {
      return false;
    }
    this.requireOwner(pass, id, owner);
    const removed = this.passes.delete(id);
    if (removed) {
      this.changed();
    }
    return removed;
  }

  /** Remove every pass owned by one Extension during deactivation. */
  removeOwner(owner: string): number {
    let removed = 0;
    for (const [id, pass] of this.passes) {
      if (pass.owner === owner) {
        this.passes.delete(id);
        removed += 1;
      }
    }
    if (removed) {
      this.changed();
    }
    return removed;
  }

  /** Enable or disable one pass. */
  setEnabled(id: string, enabled: boolean, owner?: string): WorkspaceShaderPassStatus {
    const pass = this.requirePass(id, owner);
    pass.enabled = enabled;
    this.changed();
    return this.status(pass);
  }

  /** List pass status in render order. */
  list(owner?: string): readonly WorkspaceShaderPassStatus[] {
    return Object.freeze(
      [...this.passes.values()]
        .filter((pass) => owner === undefined || pass.owner === owner)
        .sort((left, right) => this.compare(left, right))
        .map((pass) => this.status(pass)),
    );
  }

  /** Whether an enabled pass currently needs the semantic layer atlas. */
  hasMask(): boolean {
    return [...this.passes.values()].some((pass) => pass.enabled && pass.definition.mask);
  }

  /** Current registry revision; preview uses it to invalidate prewarming. */
  getRevision(): number {
    return this.revision;
  }

  /** Whether at least one enabled pass participates in the next disk copy. */
  hasEnabled(): boolean {
    return [...this.passes.values()].some((pass) => pass.enabled);
  }

  /** Set the export lowering mode selected in Advanced editing settings. */
  setExportMode(mode: WorkspaceShaderExportMode): void {
    if (mode !== "layered" && mode !== "standalone") {
      throw new Error(`Workspace shader export mode is invalid: ${mode}`);
    }
    this.exportMode = mode;
  }

  /** Return the current export lowering mode without exposing mutable state. */
  getExportMode(): WorkspaceShaderExportMode {
    return this.exportMode;
  }

  /** Subscribe to registration or enablement changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Convert active passes into the renderer's full-screen pass shape. */
  active(position?: WorkspaceShaderPosition): readonly WorkspaceShaderRenderPass[] {
    return Object.freeze(
      [...this.passes.values()]
        .filter(
          (pass) =>
            pass.enabled &&
            (position === undefined || (pass.definition.position ?? "after-chart") === position),
        )
        .sort((left, right) => this.compare(left, right))
        .map((pass) => ({
          shader: `${WORKSPACE_PREFIX}${pass.definition.id}`,
          values: pass.definition.values,
          global: true as const,
          workspacePassId: pass.definition.id,
          ...(pass.definition.mask ? { mask: this.maskBinding(pass.definition.mask) } : {}),
        })),
    );
  }

  /** Resolve a renderer pass's direct GLSL source. */
  source(shader: string): string | null {
    if (!shader.startsWith(WORKSPACE_PREFIX)) {
      return null;
    }
    return this.passes.get(shader.slice(WORKSPACE_PREFIX.length))?.definition.source ?? null;
  }

  /** Build export metadata and warnings for enabled workspace passes. */
  exportProjection(output: "save" | "export"): {
    readonly metadata: readonly Record<string, unknown>[];
    readonly warnings: readonly WorkspaceShaderWarning[];
  } {
    const metadata: Record<string, unknown>[] = [];
    const warnings: WorkspaceShaderWarning[] = [];
    for (const pass of this.passes.values()) {
      if (!pass.enabled) {
        continue;
      }
      const policy = pass.definition.exportPolicy ?? "warn";
      const source =
        this.exportMode === "standalone"
          ? pass.definition.portable?.source
          : pass.definition.source;
      if (policy === "embed" && source) {
        metadata.push({
          id: pass.definition.id,
          label: pass.definition.label,
          source,
          ...(pass.definition.values ? { values: pass.definition.values } : {}),
          ...(this.exportMode === "layered" && pass.definition.mask
            ? { mask: pass.definition.mask }
            : {}),
          position: pass.definition.position ?? "after-chart",
          order: pass.definition.order ?? 0,
        });
      }
      if (output === "export" && policy !== "ignore") {
        if (this.exportMode === "layered") {
          warnings.push({
            code: "shader.workspace.external-player",
            message: `Workspace shader pass "${pass.definition.label}" is Redux-specific and may be ignored by external players.`,
            passId: pass.definition.id,
          });
        } else if (!pass.definition.portable) {
          warnings.push({
            code: "shader.workspace.no-portable-fallback",
            message: `Workspace shader pass "${pass.definition.label}" has no standalone fallback and was omitted from the portable export.`,
            passId: pass.definition.id,
          });
        } else if (pass.definition.portable.exact !== true) {
          warnings.push({
            code: "shader.workspace.portable-approximation",
            message: `Workspace shader pass "${pass.definition.label}" uses a portable fallback; object-level masking may differ in external players.`,
            passId: pass.definition.id,
          });
        }
      }
    }
    return { metadata: Object.freeze(metadata), warnings: Object.freeze(warnings) };
  }

  private requirePass(id: string, owner?: string): StoredPass {
    const pass = this.passes.get(id);
    if (!pass) {
      throw new Error(`Workspace shader pass is not registered: ${id}`);
    }
    this.requireOwner(pass, id, owner);
    return pass;
  }

  private requireOwner(pass: StoredPass, id: string, owner?: string): void {
    if (owner !== undefined && pass.owner !== owner) {
      throw new Error(`Workspace shader pass is owned by another Extension: ${id}`);
    }
  }

  private compare(left: StoredPass, right: StoredPass): number {
    const position = (left.definition.position ?? "after-chart") === "before-chart" ? -1 : 1;
    const rightPosition = (right.definition.position ?? "after-chart") === "before-chart" ? -1 : 1;
    return (
      position - rightPosition ||
      (left.definition.order ?? 0) - (right.definition.order ?? 0) ||
      left.sequence - right.sequence
    );
  }

  private status(pass: StoredPass): WorkspaceShaderPassStatus {
    return Object.freeze({
      id: pass.definition.id,
      label: pass.definition.label,
      ...(pass.owner ? { owner: pass.owner } : {}),
      enabled: pass.enabled,
      position: pass.definition.position ?? "after-chart",
      order: pass.definition.order ?? 0,
      exportPolicy: pass.definition.exportPolicy ?? "warn",
      ...(pass.definition.mask ? { mask: pass.definition.mask } : {}),
      portable: Boolean(pass.definition.portable),
    });
  }

  /** Resolve a semantic selector into the appropriate mask-atlas binding. */
  private maskBinding(mask: WorkspaceShaderMaskDefinition): WorkspaceShaderMaskBinding {
    if (mask.kind === "note-field") {
      const channel = mask.channel ?? 0;
      const selection = [0, 0, 0, 0] as [number, number, number, number];
      selection[channel] = 1;
      return Object.freeze({
        key: `note:${mask.field}=${String(mask.value)}`,
        atlas: "note-fields",
        layers: Object.freeze([]) as readonly ChartRenderLayerId[],
        field: mask.field,
        value: mask.value,
        selection: Object.freeze(selection),
      });
    }
    const layers = Object.freeze([...new Set(mask.layers)].sort()) as readonly ChartRenderLayerId[];
    return Object.freeze({
      key: renderLayerSelectorKey(layers),
      atlas: "layers",
      layers,
      selection: maskSelectionForLayers(layers),
    });
  }

  private changed(): void {
    this.revision += 1;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

/** Process-wide workspace shader registry. */
export const workspaceShaderPasses = new WorkspaceShaderPassRegistry();
