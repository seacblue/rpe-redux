/**
 * Home-screen collaboration entry.
 *
 * The welcome page has no open chart, so this surface can only join an existing
 * room: it never offers hosting. Once the room snapshot arrives, the shared
 * document runtime opens the temporary room chart in the editor.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { FieldRow } from "../../../design/components/field/FieldRow.tsx";
import { ColorField } from "../../../design/components/input/ColorField.tsx";
import { Input } from "../../../design/components/input/Input.tsx";
import { Modal } from "../../../design/components/modal/Modal.tsx";
import { Segmented } from "../../../design/components/segmented/Segmented.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import { parseRoomInviteLink, type RoomInvite } from "../../../core/collaboration/invite.ts";
import { useCollaboration } from "../editor/workspace/collaboration/collaborationRuntime.tsx";

/** Join-only room entry for the home screen header. */
export function WelcomeJoin() {
  const { t } = useTranslation();
  const { settings, joinRoom, updateSettings, state, pendingInviteLink } = useCollaboration();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"link" | "custom">("link");
  const [link, setLink] = useState("");
  const [server, setServer] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState(settings.displayName);
  const [color, setColor] = useState(settings.color);
  const handledInvite = useRef("");
  // A web invitation URL lands on the welcome page before the editor exists,
  // so seed the join modal instead of opening the inspector.
  useEffect(() => {
    if (!pendingInviteLink || handledInvite.current === pendingInviteLink) {
      return;
    }
    handledInvite.current = pendingInviteLink;
    setName(settings.displayName);
    setColor(settings.color);
    setMethod("link");
    setLink(pendingInviteLink);
    setOpen(true);
  }, [pendingInviteLink, settings.displayName, settings.color]);
  const valid =
    method === "link"
      ? Boolean(parseRoomInviteLink(link))
      : Boolean(server.trim()) && password.trim().length >= 4;
  const close = () => {
    setOpen(false);
    setLink("");
    setServer("");
    setPassword("");
  };
  const submit = () => {
    if (!valid || state.roomId) {
      return;
    }
    const displayName = name.trim() || settings.displayName;
    updateSettings({ displayName, color });
    const input: string | RoomInvite =
      method === "link" ? link : { serverUrl: server, invite: password };
    close();
    void joinRoom(input, { displayName, color });
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
        label={t("workspace.collaboration.joinTab")}
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
          <Segmented<"link" | "custom">
            className="is-block collab-mode-switch"
            ariaLabel={t("workspace.collaboration.joinMethod")}
            value={method}
            options={[
              { value: "link", label: t("workspace.collaboration.joinMethod.link") },
              { value: "custom", label: t("workspace.collaboration.joinMethod.custom") },
            ]}
            onChange={setMethod}
          />
          {method === "link" ? (
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
          ) : (
            <>
              <FieldRow
                layout="inline"
                label={t("workspace.collaboration.serverUrl")}
                control={(id) => (
                  <Input
                    id={id}
                    value={server}
                    placeholder={t("workspace.collaboration.serverUrlPlaceholder")}
                    onChange={(event) => setServer(event.currentTarget.value)}
                  />
                )}
              />
              <FieldRow
                layout="inline"
                label={t("workspace.collaboration.password")}
                control={(id) => (
                  <Input
                    id={id}
                    type="password"
                    value={password}
                    minLength={4}
                    maxLength={64}
                    autoComplete="off"
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submit();
                      }
                    }}
                  />
                )}
              />
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
