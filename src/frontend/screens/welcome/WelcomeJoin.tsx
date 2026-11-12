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
import { isDesktop } from "../../../core/platform/environment.ts";
import { useCollaboration } from "../editor/workspace/collaboration/collaborationRuntime.tsx";
import { RoomServerField } from "../editor/workspace/collaboration/RoomServerField.tsx";

/** Join-only room entry for the home screen header. */
export function WelcomeJoin() {
  const { t } = useTranslation();
  const { settings, joinRoom, updateSettings, state, pendingInviteLink } = useCollaboration();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"link" | "custom">(settings.joinMethod);
  const [link, setLink] = useState(settings.joinLink);
  const storedServer =
    isDesktop() || /^(?:wss|https):\/\//iu.test(settings.serverUrl) ? settings.serverUrl : "";
  const [server, setServer] = useState(storedServer);
  const [password, setPassword] = useState(settings.joinPassword);
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
    setServer(storedServer);
    setPassword(settings.joinPassword);
    setMethod("link");
    setLink(pendingInviteLink);
    setOpen(true);
  }, [
    pendingInviteLink,
    settings.displayName,
    settings.color,
    settings.joinPassword,
    storedServer,
  ]);
  const valid =
    method === "link"
      ? Boolean(parseRoomInviteLink(link))
      : Boolean(server.trim()) && password.trim().length >= 4;
  const close = () => {
    setOpen(false);
    setLink("");
  };
  const submit = () => {
    if (!valid || state.roomId) {
      return;
    }
    const displayName = name.trim() || settings.displayName;
    updateSettings({
      displayName,
      color,
      joinMethod: method,
      joinLink: link,
      ...(method === "custom" ? { serverUrl: server, joinPassword: password } : {}),
    });
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
          setMethod(settings.joinMethod);
          setLink(settings.joinLink);
          setServer(
            isDesktop() || /^(?:wss|https):\/\//iu.test(settings.serverUrl)
              ? settings.serverUrl
              : "",
          );
          setPassword(settings.joinPassword);
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
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setName(next);
                  updateSettings({ displayName: next });
                }}
              />
            )}
          />
          <FieldRow
            layout="inline"
            label={t("workspace.collaboration.color")}
            control={
              <ColorField
                value={color}
                onChange={(next) => {
                  setColor(next);
                  updateSettings({ color: next });
                }}
              />
            }
          />
          <Segmented<"link" | "custom">
            className="is-block collab-mode-switch"
            ariaLabel={t("workspace.collaboration.joinMethod")}
            value={method}
            options={[
              { value: "link", label: t("workspace.collaboration.joinMethod.link") },
              { value: "custom", label: t("workspace.collaboration.joinMethod.custom") },
            ]}
            onChange={(next) => {
              setMethod(next);
              updateSettings({ joinMethod: next });
            }}
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
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    setLink(next);
                    updateSettings({ joinLink: next });
                  }}
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
              <RoomServerField
                value={server}
                onChange={(next) => {
                  setServer(next);
                  updateSettings({ serverUrl: next });
                }}
                layout="inline"
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
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setPassword(next);
                      updateSettings({ joinPassword: next });
                    }}
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
