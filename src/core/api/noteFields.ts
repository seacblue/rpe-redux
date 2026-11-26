/** Public facade for Extension-contributed native note-field schemas. */
import { extensionActionId } from "../extensions/capabilities.ts";
import { noteFields, type NoteFieldDefinition } from "../global/chart/noteFields.ts";

/** Create a note-field facade for the host or one Extension owner. */
export function createNoteFieldsApi(owner?: string) {
  const idFor = (id: string): string => (owner ? extensionActionId(owner, id) : id);
  return Object.freeze({
    /** List native note fields, or only this Extension's fields. */
    list: () => noteFields.list(owner),
    /** Register one native inspector and batch field. */
    register: (definition: NoteFieldDefinition) =>
      noteFields.register({ ...definition, id: idFor(definition.id) }, owner),
    /** Remove one field owned by this facade. */
    unregister: (id: string) => noteFields.unregister(idFor(id), owner),
  });
}

/** Complete host facade for development and automation. */
export const noteFieldApi = createNoteFieldsApi();

export type {
  NoteFieldDefinition,
  NoteFieldOption,
  NoteFieldStatus,
} from "../global/chart/noteFields.ts";
