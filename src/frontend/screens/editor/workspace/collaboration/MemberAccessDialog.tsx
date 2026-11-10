/** Modal that changes one room member's edit/view access. */
import { Button } from "../../../../../design/components/button/Button.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Modal } from "../../../../../design/components/modal/Modal.tsx";
import { Select } from "../../../../../design/components/select/Select.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";

/** Access choices the host can assign to a non-host member. */
export type MemberAccessRole = "editor" | "viewer";

/** Renders the access dialog with one labelled dropdown. */
export function MemberAccessDialog({
  open,
  memberName,
  role,
  onRoleChange,
  onClose,
  onSave,
}: {
  readonly open: boolean;
  readonly memberName: string;
  readonly role: MemberAccessRole;
  onRoleChange(role: MemberAccessRole): void;
  onClose(): void;
  onSave(): void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      onClose={onClose}
      label={t("workspace.collaboration.changeAccessTitle", { name: memberName })}
      className="redux-prompt-dialog"
      actions={
        <>
          <Button variant="outlined" onClick={onClose}>
            {t("common.action.cancel")}
          </Button>
          <Button variant="solid" onClick={onSave}>
            {t("workspace.collaboration.changeAccessSave")}
          </Button>
        </>
      }
    >
      <FieldRow
        layout="inline"
        label={t("workspace.collaboration.changeAccessField")}
        control={(id) => (
          <Select
            id={id}
            value={role}
            onChange={(event) => onRoleChange(event.currentTarget.value as MemberAccessRole)}
          >
            <option value="editor">{t("workspace.collaboration.role.editor")}</option>
            <option value="viewer">{t("workspace.collaboration.role.viewer")}</option>
          </Select>
        )}
      />
    </Modal>
  );
}
