/**
 * Rename, group-edit, and remove dialogs for the home library.
 *
 * They read the pending request from `projectPrompts` through the shared queued
 * prompt state, so the last question stays on screen through its close
 * animation and a rejected submit is reported by the same footer every prompt
 * uses.
 */
import { useState } from "react";
import { useTranslation } from "../../../../i18n/react.ts";
import { FieldRow } from "../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../design/components/input/Input.tsx";
import { Select } from "../../../../design/components/select/Select.tsx";
import {
  usePromptAction,
  useQueuedPrompt,
  PromptDialog,
} from "../../../overlays/modals/QueuedPrompt.tsx";
import { HomeProjectDialogView } from "./HomeProjectDialogView.tsx";
import { DEFAULT_LIBRARY_GROUP, normalizeLibraryGroup } from "./libraryGroups.ts";
import {
  closeProjectPrompt,
  getProjectPrompt,
  subscribeProjectPrompt,
  type ProjectEditPrompt,
  type ProjectEditValues,
  type ProjectGroupPrompt,
  type ProjectRemovePrompt,
} from "./projectPrompts.ts";

const NEW_GROUP_VALUE = "__redux_new_group__";

/**
 * The home library's dialogs: deleting a project, editing its metadata, and
 * changing its group.
 *
 * They ask about the cards rather than about the window, so they hang off the
 * cards' own view. The question itself lives in `projectPrompts`; this file only
 * draws it. One at a time — the store holds a single request.
 */
export function ProjectDialogs() {
  const { request, open } = useQueuedPrompt(subscribeProjectPrompt, getProjectPrompt);
  if (!request) {
    return null;
  }
  if (request.kind === "remove") {
    return <ProjectRemoveDialog key={request.id} request={request} open={open} />;
  }
  if (request.kind === "group") {
    return <ProjectGroupDialog key={request.id} request={request} open={open} />;
  }
  return <ProjectEditDialog key={request.id} request={request} open={open} />;
}

/** Confirmation dialog that deletes a project. */
function ProjectRemoveDialog({ request, open }: { request: ProjectRemovePrompt; open: boolean }) {
  const { t } = useTranslation();
  const action = usePromptAction(closeProjectPrompt);
  return (
    <PromptDialog
      requestId={`project:${request.id}`}
      open={open}
      onClose={closeProjectPrompt}
      label={request.title}
      description={request.description}
      className="redux-project-dialog"
      error={action.error}
      pending={action.pending}
      submitLabel={t("common.action.delete")}
      submitVariant="danger"
      cancelLabel={t("workspace.dialogs.dismiss")}
      onSubmit={() => action.run(request.submit)}
    >
      {null}
    </PromptDialog>
  );
}

/** Dialog that edits the library metadata shown on the detail card. */
function ProjectEditDialog({ request, open }: { request: ProjectEditPrompt; open: boolean }) {
  const { t } = useTranslation();
  const action = usePromptAction(closeProjectPrompt);
  const [value, setValue] = useState<ProjectEditValues>({
    name: request.name,
    composer: request.composer,
    charter: request.charter,
    level: request.level,
    group: request.group,
  });
  /** Submits the fields currently shown in the dialog. */
  const apply = () => action.run(() => request.submit(value));
  return (
    <PromptDialog
      requestId={`project:${request.id}`}
      open={open}
      onClose={closeProjectPrompt}
      label={request.title}
      description={request.description}
      className="redux-project-dialog"
      error={action.error}
      pending={action.pending}
      submitLabel={t("common.action.apply")}
      cancelLabel={t("workspace.dialogs.dismiss")}
      onSubmit={apply}
    >
      <HomeProjectDialogView value={value} onChange={setValue} onEnter={apply} />
    </PromptDialog>
  );
}

/** Focused group dialog opened from a card's context menu. */
function ProjectGroupDialog({ request, open }: { request: ProjectGroupPrompt; open: boolean }) {
  const { t } = useTranslation();
  const action = usePromptAction(closeProjectPrompt);
  const [selection, setSelection] = useState(() => normalizeLibraryGroup(request.group));
  const [newGroup, setNewGroup] = useState("");
  const options = [...new Set([...request.groups, request.group].map(normalizeLibraryGroup))].sort(
    (left, right) => left.localeCompare(right),
  );
  const apply = () =>
    action.run(async () => {
      const group =
        selection === NEW_GROUP_VALUE ? newGroup.trim() : normalizeLibraryGroup(selection);
      if (selection === NEW_GROUP_VALUE && !group) {
        throw new Error(t("workspace.welcome.library.group.errorRequired"));
      }
      await request.submit(group);
    });
  return (
    <PromptDialog
      requestId={`project:${request.id}`}
      open={open}
      onClose={closeProjectPrompt}
      label={request.title}
      className="redux-project-dialog redux-project-group-dialog-modal"
      error={action.error}
      pending={action.pending}
      submitLabel={t("common.action.apply")}
      cancelLabel={t("workspace.dialogs.dismiss")}
      onSubmit={apply}
    >
      <div className="redux-project-group-dialog">
        <FieldRow
          layout="inline"
          className="modal-field"
          htmlFor="home-project-group-selection"
          label={t("editor.home.field.groupLabel")}
          control={
            <Select
              id="home-project-group-selection"
              value={selection}
              onChange={(event) => setSelection(event.currentTarget.value)}
            >
              <option value={DEFAULT_LIBRARY_GROUP}>{DEFAULT_LIBRARY_GROUP}</option>
              {options
                .filter((group) => group)
                .map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              <option value={NEW_GROUP_VALUE}>{t("workspace.welcome.library.group.new")}</option>
            </Select>
          }
        />
        {selection === NEW_GROUP_VALUE && (
          <FieldRow
            layout="inline"
            className="modal-field"
            htmlFor="home-project-new-group"
            label={t("workspace.welcome.library.group.newLabel")}
            control={
              <Input
                id="home-project-new-group"
                value={newGroup}
                autoFocus
                onChange={(event) => setNewGroup(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    apply();
                  }
                }}
              />
            }
          />
        )}
      </div>
    </PromptDialog>
  );
}
