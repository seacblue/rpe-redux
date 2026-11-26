/** Owns Extension-contributed note-field schemas used by native editor surfaces. */

/** A selectable value shown by a contributed note field. */
export type NoteFieldOption = readonly [value: string, label: string];

/** The native control and batch semantics for one contributed note field. */
export interface NoteFieldDefinition {
  readonly id: string;
  /** JSON property written on the note object. */
  readonly field: string;
  readonly label: string;
  readonly kind: "select" | "text" | "number";
  readonly options?: readonly NoteFieldOption[];
  readonly defaultValue?: string | number;
  /** Empty value removes the property from the authored note. */
  readonly clearValue?: string | number | null;
  /** Whether the field appears in the native note batch editor. */
  readonly batch?: boolean;
}

/** A field plus its owner, exposed to host surfaces without mutable state. */
export interface NoteFieldStatus extends NoteFieldDefinition {
  readonly owner?: string;
}

interface StoredNoteField {
  definition: NoteFieldDefinition;
  owner?: string;
}

const FIELD_ID = /^[a-z][a-z0-9._-]{1,127}$/u;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;

/** Validate a contributed field before it reaches editor surfaces. */
function validate(definition: NoteFieldDefinition): void {
  if (!FIELD_ID.test(definition.id.trim())) {
    throw new Error(`Note field id is invalid: ${definition.id}`);
  }
  if (!FIELD_NAME.test(definition.field.trim())) {
    throw new Error(`Note field name is invalid: ${definition.field}`);
  }
  if (!definition.label.trim()) {
    throw new Error(`Note field label is empty: ${definition.id}`);
  }
  if (definition.kind === "select" && !definition.options?.length) {
    throw new Error(`Select note field has no options: ${definition.id}`);
  }
  const values = definition.options ?? [];
  if (new Set(values.map(([value]) => value)).size !== values.length) {
    throw new Error(`Note field options are duplicated: ${definition.id}`);
  }
}

/** Registry that lets Extensions add native note fields without product code. */
export class NoteFieldRegistry {
  private readonly fields = new Map<string, StoredNoteField>();
  private readonly fieldsByName = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  /** Register or replace one field owned by the calling Extension. */
  register(definition: NoteFieldDefinition, owner?: string): NoteFieldStatus {
    const normalized = { ...definition, id: definition.id.trim(), field: definition.field.trim() };
    validate(normalized);
    const existingId = this.fieldsByName.get(normalized.field);
    if (existingId && existingId !== normalized.id) {
      throw new Error(`Note field is already registered: ${normalized.field}`);
    }
    const previous = this.fields.get(normalized.id);
    if (previous && previous.owner !== owner) {
      throw new Error(`Note field is owned by another Extension: ${normalized.id}`);
    }
    if (previous && previous.definition.field !== normalized.field) {
      this.fieldsByName.delete(previous.definition.field);
    }
    this.fields.set(normalized.id, {
      definition: Object.freeze({
        ...normalized,
        ...(normalized.options ? { options: Object.freeze([...normalized.options]) } : {}),
      }),
      owner,
    });
    this.fieldsByName.set(normalized.field, normalized.id);
    this.changed();
    return this.status(this.fields.get(normalized.id)!);
  }

  /** Remove one owner-scoped field. */
  unregister(id: string, owner?: string): boolean {
    const field = this.fields.get(id);
    if (!field) {
      return false;
    }
    if (owner !== undefined && field.owner !== owner) {
      throw new Error(`Note field is owned by another Extension: ${id}`);
    }
    this.fields.delete(id);
    this.fieldsByName.delete(field.definition.field);
    this.changed();
    return true;
  }

  /** Remove every field owned by one Extension during deactivation. */
  removeOwner(owner: string): number {
    let removed = 0;
    for (const [id, field] of this.fields) {
      if (field.owner === owner) {
        this.fields.delete(id);
        this.fieldsByName.delete(field.definition.field);
        removed += 1;
      }
    }
    if (removed) {
      this.changed();
    }
    return removed;
  }

  /** List fields, optionally restricted to one owner. */
  list(owner?: string): readonly NoteFieldStatus[] {
    return Object.freeze(
      [...this.fields.values()]
        .filter((field) => owner === undefined || field.owner === owner)
        .map((field) => this.status(field)),
    );
  }

  /** Find the schema for a note property name. */
  findByField(field: string): NoteFieldStatus | null {
    const id = this.fieldsByName.get(field);
    return id ? this.status(this.fields.get(id)!) : null;
  }

  /** Subscribe native surfaces to schema changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Return the revision used by React surfaces to refresh their descriptors. */
  getRevision(): number {
    return this.revision;
  }

  private status(field: StoredNoteField): NoteFieldStatus {
    return Object.freeze({
      ...field.definition,
      ...(field.owner ? { owner: field.owner } : {}),
    });
  }

  private changed(): void {
    this.revision += 1;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

/** Process-wide registry used by both the editor and Extension API. */
export const noteFields = new NoteFieldRegistry();
