/**
 * Home-screen collaboration entry.
 *
 * The welcome page has no open chart, so this surface can only join an existing
 * room: it never offers hosting. Once the room snapshot arrives, the shared
 * document runtime opens the temporary room chart in the editor.
 */
import { useState } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { FieldRow } from "../../../design/components/field/FieldRow.tsx";
import { ColorField } from "../../../design/components/input/ColorField.tsx";
import { Input } from "../../../design/components/input/Input.tsx";
import { Modal } from "../../../design/components/modal/Modal.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import { parseRoomInviteLink } from "../../../core/collaboration/invite.ts";
import { useCollaboration } from "../editor/workspace/collaboration/collaborationRuntime.tsx";

/** Join-only room entry for the home screen header. */
export function WelcomeJoin() {
  const { t } = useTranslation();
  const { settings, joinRoom, updateSettings, state } = useCollaboration();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [name, setName] = useState(settings.displayName);
  const [color, setColor] = useState(settings.color);
  const valid = Boolean(parseRoomInviteLink(link));
  const close = () => {
    setOpen(false);
    setLink("");
  };
  const submit = () => {
    if (!valid || state.roomId) {
      return;
    }
    const displayName = name.trim() || settings.displayName;
    updateSettings({ displayName, color });
    close();
    void joinRoom(link, { displayName, color });
  };
  return (
    <>
      <IconButton
        icon="users"
        label={t("workspace.collaboration.joinTab")}
        onClick={() => {
          setName(settings.displayName);
          setColor(settings.color);
          setOpen(true);
        }}
      />
      <Modal
        open={open}
        onClose={close}
        label={t("workspace.collaboration.joinInviteTitle")}
        description={t("workspace.collaboration.joinHint")}
        className="redux-prompt-dialog collab-welcome-join"
        actions={
          <>
            <Button variant="outlined" onClick={close}>
              {t("workspace.collaboration.joinInviteCancel")}
            </Button>
            <Button variant="solid" disabled={!valid || Boolean(state.roomId)} onClick={submit}>
              {t("workspace.collaboration.join")}
            </Button>
          </>
        }
      >
        <div className="collab-invite-identity">
          <FieldRow
            layout="inline"
            label={t("workspace.collaboration.displayName")}
            control={(id) => (
              <Input
                id={id}
                value={name}
                maxLength={48}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            )}
          />
          <FieldRow
            layout="inline"
            label={t("workspace.collaboration.color")}
            control={<ColorField value={color} onChange={setColor} />}
          />
          <FieldRow
            layout="inline"
            label={t("workspace.collaboration.inviteLink")}
            control={(id) => (
              <Input
                id={id}
                value={link}
                placeholder={t("workspace.collaboration.inviteLinkPlaceholder")}
                onChange={(event) => setLink(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
            )}
          />
        </div>
      </Modal>
    </>
  );
}
