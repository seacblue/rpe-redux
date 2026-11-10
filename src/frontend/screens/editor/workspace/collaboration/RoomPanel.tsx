/**
 * Inspector pane for creating, joining, and managing one collaboration room.
 *
 * The pane is always mounted beside the editor so room state survives tool
 * switches; the sidebar route and the room badge both open it by the stable
 * `collaboration` inspector id.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { IconButton } from "../../../../../design/components/button/IconButton.tsx";
import { InlineAlert } from "../../../../../design/components/alert/InlineAlert.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FieldReset } from "../../../../../design/components/field/FieldReset.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { ColorField } from "../../../../../design/components/input/ColorField.tsx";
import { Modal } from "../../../../../design/components/modal/Modal.tsx";
import { Segmented } from "../../../../../design/components/segmented/Segmented.tsx";
import { Select } from "../../../../../design/components/select/Select.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import { createRoomPassword } from "../../../../../core/collaboration/invite.ts";
import { requestConfirm } from "../../../../overlays/modals/prompts.ts";
import { download } from "../../../../platform/download.ts";
import { useEditorRuntime } from "../runtime/composition/EditorRuntime.tsx";
import { MemberAccessDialog } from "./MemberAccessDialog.tsx";
import { MemberActionsMenu } from "./MemberActionsMenu.tsx";
import { RoomLocks } from "./RoomLocks.tsx";
import { suggestedLanPort, useCollaboration } from "./collaborationRuntime.tsx";
import { MaxMembersControl } from "./MaxMembersControl.tsx";

const ROLE_KEYS = {
  host: "workspace.collaboration.role.host",
  editor: "workspace.collaboration.role.editor",
  viewer: "workspace.collaboration.role.viewer",
} as const;

/** Fixed-width placeholder so toggling a secret never changes the row's height. */
const SECRET_MASK = "••••••••";

interface SecretInputProps {
  id: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  autoComplete?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/** A text field with an inline reveal button; hidden until the reader asks for it. */
function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  minLength,
  maxLength,
  autoComplete,
  inputRef,
  onKeyDown,
}: SecretInputProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <div className="collab-secret-input">
      <Input
        ref={inputRef}
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        minLength={minLength}
        maxLength={maxLength}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <IconButton
        size="small"
        icon={visible ? "eyeOff" : "eye"}
        label={t(
          visible ? "workspace.collaboration.hideSecret" : "workspace.collaboration.showSecret",
        )}
        className="collab-secret-toggle"
        onClick={() => setVisible((current) => !current)}
      />
    </div>
  );
}

/** Read-only secret value with a reveal button and an optional trailing action. */
function SecretValue({ value, action }: { value: string; action?: ReactNode }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <div className="collab-secret-value">
      <code className="collab-field-value" title={visible ? value : undefined}>
        {visible ? value : SECRET_MASK}
      </code>
      <IconButton
        size="small"
        icon={visible ? "eyeOff" : "eye"}
        label={t(
          visible ? "workspace.collaboration.hideSecret" : "workspace.collaboration.showSecret",
        )}
        className="collab-secret-toggle"
        onClick={() => setVisible((current) => !current)}
      />
      {action}
    </div>
  );
}

/** Inspector pane for creating, joining, and managing a collaboration room. */
export function RoomPanel() {
  const { pendingInviteLink } = useCollaboration();
  // A new invitation reseeds the form without a setState-in-effect cycle.
  return <RoomPanelBody key={pendingInviteLink || "manual"} />;
}

/** Form state for one room session, reseeded when an invitation arrives. */
function RoomPanelBody() {
  const { t } = useTranslation();
  const runtime = useEditorRuntime();
  const {
    state,
    settings,
    updateSettings,
    createRoom,
    joinRoom,
    leaveRoom,
    closeRoom,
    approve,
    setRole,
    setMaxMembers,
    removeMember,
    copyInvite,
    startingRoom,
    joiningRoom,
    pendingInviteLink,
    canHost,
    recovery,
    clearRecovery,
    applyRecovery,
    unsent,
    retryUnsent,
    rebaseUnsent,
    discardUnsent,
    updateRoomPassword,
  } = useCollaboration();
  const [mode, setMode] = useState<"create" | "join">(pendingInviteLink ? "join" : "create");
  // Without a document there is no chart to host; the welcome-page entry can
  // only join an existing room.
  const effectiveMode = canHost ? mode : "join";
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [color, setColor] = useState(settings.color);
  const [hostMode, setHostMode] = useState(settings.hostMode);
  const [lanPort, setLanPort] = useState(settings.lanPort);
  const [password, setPassword] = useState(createRoomPassword);
  const [newPassword, setNewPassword] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [accessTarget, setAccessTarget] = useState<(typeof state.members)[number] | null>(null);
  // Members stay in the room record while offline so their resume token still
  // works. The roster only shows who is actually present.
  const onlineMembers = state.members.filter((member) => member.online);
  const activeAccessTarget =
    accessTarget && onlineMembers.some((member) => member.id === accessTarget.id)
      ? accessTarget
      : null;
  const [accessRole, setAccessRole] = useState<"editor" | "viewer">("editor");
  const [joinMethod, setJoinMethod] = useState<"link" | "custom">("link");
  const [joinLink, setJoinLink] = useState(pendingInviteLink);
  const [serverUrl, setServerUrl] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [autoApproveEditor, setAutoApproveEditor] = useState(true);
  const passwordInput = useRef<HTMLInputElement | null>(null);

  // The modal opens through the shared dialog stack, which focuses its close
  // button first. Move focus into the field once that stack settles.
  useEffect(() => {
    if (!passwordOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => passwordInput.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [passwordOpen]);

  /** Persists the editable identity and host fields, returning them normalized. */
  const applySettings = () => {
    const next = {
      displayName: displayName.trim(),
      color,
      hostMode,
      lanPort: lanPort.trim(),
    };
    updateSettings(next);
    return next;
  };
  const inRoom = Boolean(state.roomId) || state.status === "waiting";
  const statusText = t(`workspace.collaboration.status.${state.status}`);
  /** Describes where one member is working for the member row. */
  const locationText = (presence: (typeof state.presence)[number] | undefined) => {
    if (!presence) {
      return t("workspace.collaboration.location.none");
    }
    if (presence.area === "global") {
      return t("workspace.collaboration.location.global", { section: presence.section ?? "" });
    }
    if (presence.area === "edit") {
      return t("workspace.collaboration.location.edit", {
        beat: (presence.beat ?? 0).toFixed(2),
      });
    }
    return t("workspace.collaboration.location.design");
  };
  /** Confirms, then asks one member to leave the room. */
  const kickMember = async (member: (typeof state.members)[number]) => {
    const confirmed = await requestConfirm({
      title: t("workspace.collaboration.kickTitle"),
      description: t("workspace.collaboration.kickBody", { name: member.profile.name }),
      label: t("workspace.collaboration.kickConfirm"),
      destructive: true,
    });
    if (confirmed) {
      removeMember(member.id);
    }
  };
  /** Opens the access modal with the member's current role preselected. */
  const openAccess = (member: (typeof state.members)[number]) => {
    setAccessTarget(member);
    setAccessRole(member.role === "viewer" ? "viewer" : "editor");
  };
  const closeAccess = () => setAccessTarget(null);
  const saveAccess = () => {
    if (activeAccessTarget) {
      setRole(activeAccessTarget.id, accessRole);
    }
    setAccessTarget(null);
  };
  /** Confirms leaving because the temporary room chart is discarded. */
  const leaveRoomWithConfirm = async () => {
    const confirmed = await requestConfirm({
      title: t("workspace.collaboration.leaveTitle"),
      description: t("workspace.collaboration.leaveBody"),
      label: t("workspace.collaboration.leaveConfirm"),
      destructive: true,
    });
    if (confirmed) {
      leaveRoom();
    }
  };
  /** Confirms, then deletes the room for every member. */
  const closeRoomWithConfirm = async () => {
    const confirmed = await requestConfirm({
      title: t("workspace.collaboration.closeRoomTitle"),
      description: t("workspace.collaboration.closeRoomBody"),
      label: t("workspace.collaboration.closeRoomConfirm"),
      destructive: true,
    });
    if (confirmed) {
      closeRoom();
    }
  };
  /** Opens a fresh password draft; the pencil beside the secret owns this entry. */
  const openPasswordEditor = () => {
    setNewPassword("");
    setPasswordOpen(true);
  };
  /** Drops the draft and dismisses the password modal. */
  const closePasswordEditor = () => {
    setPasswordOpen(false);
    setNewPassword("");
  };
  /** Publishes a valid password draft and closes the modal. */
  const submitPassword = () => {
    const next = newPassword.trim();
    const length = [...next].length;
    if (length < 8 || length > 64) {
      return;
    }
    updateRoomPassword(next);
    closePasswordEditor();
  };
  /** Downloads the retained recovery chart as JSON. */
  const downloadRecovery = () => {
    if (!recovery) {
      return;
    }
    const blob = new Blob([JSON.stringify(recovery, null, 2)], { type: "application/json" });
    download(blob, `collaboration-recovery-${Date.now()}.json`);
  };

  return (
    <div className="collab-panel">
      {inRoom ? (
        <div className="collab-room">
          <div className="collab-room-info">
            <FieldRow
              label={t("workspace.collaboration.statusLabel")}
              control={
                <span className={`collab-status is-${state.status}`} role="status">
                  {statusText}
                </span>
              }
            />
            <FieldRow
              label={t("workspace.collaboration.password")}
              control={
                <SecretValue
                  key={state.roomId}
                  value={state.invite}
                  action={
                    state.role === "host" ? (
                      <IconButton
                        size="small"
                        icon="pencil"
                        label={t("workspace.collaboration.changePassword")}
                        onClick={openPasswordEditor}
                      />
                    ) : undefined
                  }
                />
              }
            />
            <FieldRow
              htmlFor="collab-max-members"
              label={t("workspace.collaboration.maxMembers")}
              control={
                state.role === "host" ? (
                  <MaxMembersControl
                    key={state.maxMembers}
                    value={state.maxMembers}
                    memberCount={onlineMembers.length}
                    onChange={setMaxMembers}
                  />
                ) : (
                  <code className="collab-field-value">{state.maxMembers}</code>
                )
              }
            />
            <FieldRow
              label={t("workspace.collaboration.inviteLink")}
              control={
                <Button variant="outlined" onClick={() => void copyInvite()}>
                  {t("workspace.collaboration.copyInviteLink")}
                </Button>
              }
            />
          </div>
          {state.queued > 0 && (
            <p className="hint">{t("workspace.collaboration.queued", { count: state.queued })}</p>
          )}
          {state.error && <InlineAlert className="collab-error">{state.error}</InlineAlert>}
          <section className="collab-section">
            <h3>{t("workspace.collaboration.members")}</h3>
            <ul className="collab-member-list">
              {onlineMembers.map((member) => {
                const isSelf = member.id === state.memberId;
                const canManage = state.role === "host" && member.role !== "host" && !isSelf;
                return (
                  <li key={member.id} className="collab-member">
                    <span
                      className="collab-member-swatch"
                      style={{ background: member.profile.color }}
                      aria-hidden="true"
                    />
                    <span className="collab-member-name">
                      {member.profile.name}
                      {isSelf ? ` (${t("workspace.collaboration.you")})` : ""}
                      <small className="collab-member-location">
                        {locationText(state.presence.find((entry) => entry.memberId === member.id))}
                      </small>
                    </span>
                    {canManage && (
                      <MemberActionsMenu
                        memberName={member.profile.name}
                        onChangeAccess={() => openAccess(member)}
                        onKick={() => void kickMember(member)}
                      />
                    )}
                    <span className="collab-member-role">{t(ROLE_KEYS[member.role])}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          {state.locks.length > 0 && (
            <section className="collab-section">
              <h3>{t("workspace.collaboration.locks")}</h3>
              <RoomLocks
                locks={state.locks}
                members={state.members}
                chart={runtime?.getSession().chart}
              />
            </section>
          )}
          {state.role === "host" && state.pending.length > 0 && (
            <section className="collab-section">
              <h3>{t("workspace.collaboration.pending")}</h3>
              <ul className="collab-pending-list">
                {state.pending.map((request) => (
                  <li key={request.requestId} className="collab-pending">
                    <span>{request.profile.name}</span>
                    <div className="redux-footer-actions">
                      <Button
                        variant="solid"
                        onClick={() => approve(request.requestId, true, "editor")}
                      >
                        {t("workspace.collaboration.approveEditor")}
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={() => approve(request.requestId, true, "viewer")}
                      >
                        {t("workspace.collaboration.approveViewer")}
                      </Button>
                      <Button
                        variant="ghost"
                        className="urgent"
                        onClick={() => approve(request.requestId, false)}
                      >
                        {t("workspace.collaboration.reject")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {unsent.length > 0 && (
            <section className="collab-section">
              <h3>{t("workspace.collaboration.unsent")}</h3>
              <p className="hint">{t("workspace.collaboration.unsentHint")}</p>
              <ul className="collab-unsent">
                {unsent.map((item) => (
                  <li key={item.transactionId}>
                    <div className="collab-unsent-text">
                      <strong>{item.label}</strong>
                      <small>{item.message}</small>
                    </div>
                    <div className="redux-footer-actions">
                      <Button
                        variant="outlined"
                        onClick={() => void retryUnsent(item.transactionId)}
                      >
                        {t("workspace.collaboration.unsentRetry")}
                      </Button>
                      <Button variant="outlined" onClick={() => rebaseUnsent(item.transactionId)}>
                        {t("workspace.collaboration.unsentRebase")}
                      </Button>
                      <Button variant="ghost" onClick={() => discardUnsent(item.transactionId)}>
                        {t("workspace.collaboration.unsentDiscard")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {Boolean(recovery) && (
            <section className="collab-section">
              <h3>{t("workspace.collaboration.recovery")}</h3>
              <p className="hint">{t("workspace.collaboration.recoveryHint")}</p>
              <div className="redux-footer-actions">
                <Button variant="outlined" onClick={applyRecovery}>
                  {t("workspace.collaboration.reapplyMine")}
                </Button>
                <Button variant="outlined" onClick={downloadRecovery}>
                  {t("workspace.collaboration.downloadRecovery")}
                </Button>
                <Button variant="outlined" onClick={clearRecovery}>
                  {t("workspace.collaboration.clearRecovery")}
                </Button>
              </div>
            </section>
          )}
          <div className="redux-footer-bar">
            <div className="redux-footer-actions">
              {state.role === "host" ? (
                <Button
                  variant="danger"
                  className="urgent"
                  onClick={() => void closeRoomWithConfirm()}
                >
                  {t("workspace.collaboration.closeRoom")}
                </Button>
              ) : (
                <Button
                  variant="danger"
                  className="urgent"
                  onClick={() => void leaveRoomWithConfirm()}
                >
                  {t("workspace.collaboration.leave")}
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="collab-forms">
          {(joiningRoom ||
            (!startingRoom && state.status === "connecting") ||
            state.status === "reconnecting") && (
            <p
              className={`collab-status is-${startingRoom || joiningRoom ? "connecting" : state.status}`}
              role="status"
            >
              {joiningRoom ? t("workspace.collaboration.joiningRoom") : statusText}...
            </p>
          )}
          {canHost && (
            <Segmented<"create" | "join">
              className="is-block collab-mode-switch"
              ariaLabel={t("workspace.collaboration.title")}
              value={effectiveMode}
              options={[
                { value: "create", label: t("workspace.collaboration.createTab") },
                { value: "join", label: t("workspace.collaboration.joinTab") },
              ]}
              onChange={setMode}
            />
          )}
          <FieldRow
            label={t("workspace.collaboration.displayName")}
            control={(id) => (
              <Input
                id={id}
                value={displayName}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
              />
            )}
          />
          <FieldRow
            label={t("workspace.collaboration.color")}
            control={<ColorField value={color} onChange={setColor} />}
          />
          {state.error && <InlineAlert className="collab-error">{state.error}</InlineAlert>}
          {effectiveMode === "create" ? (
            <>
              <FieldRow
                label={t("workspace.collaboration.hostMode")}
                control={(id) => (
                  <Select
                    id={id}
                    value={hostMode}
                    onChange={(event) => setHostMode(event.currentTarget.value as typeof hostMode)}
                  >
                    <option value="tunnel">{t("workspace.collaboration.hostMode.tunnel")}</option>
                    <option value="lan">{t("workspace.collaboration.hostMode.lan")}</option>
                  </Select>
                )}
              />
              {hostMode !== "tunnel" && (
                <FieldRow
                  label={t("workspace.collaboration.lanPort")}
                  control={(id) => (
                    <Input
                      id={id}
                      type="number"
                      min="1024"
                      max="65535"
                      step="1"
                      value={lanPort}
                      placeholder={suggestedLanPort}
                      onChange={(event) => setLanPort(event.currentTarget.value)}
                    />
                  )}
                />
              )}
              <FieldRow
                label={t("workspace.collaboration.password")}
                control={(id) => (
                  <SecretInput
                    id={id}
                    value={password}
                    minLength={8}
                    maxLength={64}
                    autoComplete="off"
                    onChange={setPassword}
                  />
                )}
              />
              <FieldRow
                htmlFor="collab-auto-approve"
                label={t("workspace.collaboration.autoApproveEditor")}
                reset={
                  <FieldReset
                    field="auto-approve-editor"
                    label={t("workspace.collaboration.autoApproveEditor")}
                    dirty={!autoApproveEditor}
                    onReset={() => setAutoApproveEditor(true)}
                  />
                }
                control={(id) => (
                  <Input
                    id={id}
                    type="checkbox"
                    checked={autoApproveEditor}
                    onChange={(event) => setAutoApproveEditor(event.currentTarget.checked)}
                  />
                )}
              />
              <div className="redux-footer-bar">
                <div className="redux-footer-actions">
                  <Button
                    variant="solid"
                    disabled={startingRoom || [...password.trim()].length < 8}
                    onClick={() =>
                      void createRoom({
                        ...applySettings(),
                        autoApproveEditor,
                        password,
                      })
                    }
                  >
                    {startingRoom
                      ? t("workspace.collaboration.startingRoom")
                      : t("workspace.collaboration.create")}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <Segmented<"link" | "custom">
                className="is-block collab-mode-switch"
                ariaLabel={t("workspace.collaboration.joinMethod")}
                value={joinMethod}
                options={[
                  { value: "link", label: t("workspace.collaboration.joinMethod.link") },
                  { value: "custom", label: t("workspace.collaboration.joinMethod.custom") },
                ]}
                onChange={setJoinMethod}
              />
              {joinMethod === "link" ? (
                <>
                  <FieldRow
                    label={t("workspace.collaboration.inviteLink")}
                    control={(id) => (
                      <SecretInput
                        id={id}
                        value={joinLink}
                        placeholder={t("workspace.collaboration.inviteLinkPlaceholder")}
                        onChange={setJoinLink}
                      />
                    )}
                  />
                </>
              ) : (
                <>
                  <FieldRow
                    label={t("workspace.collaboration.serverUrl")}
                    control={(id) => (
                      <Input
                        id={id}
                        value={serverUrl}
                        placeholder={t("workspace.collaboration.serverUrlPlaceholder")}
                        onChange={(event) => setServerUrl(event.currentTarget.value)}
                      />
                    )}
                  />
                  <FieldRow
                    label={t("workspace.collaboration.password")}
                    control={(id) => (
                      <SecretInput
                        id={id}
                        value={joinPassword}
                        minLength={4}
                        maxLength={64}
                        autoComplete="off"
                        onChange={setJoinPassword}
                      />
                    )}
                  />
                </>
              )}
              <div className="redux-footer-bar">
                <div className="redux-footer-actions">
                  <Button
                    variant="solid"
                    disabled={
                      joiningRoom ||
                      (joinMethod === "link"
                        ? !joinLink.trim()
                        : !serverUrl.trim() || joinPassword.trim().length < 4)
                    }
                    onClick={() =>
                      void (joinMethod === "link"
                        ? joinRoom(joinLink, applySettings())
                        : joinRoom({ serverUrl, invite: joinPassword }, applySettings()))
                    }
                  >
                    {joiningRoom
                      ? t("workspace.collaboration.joiningRoom")
                      : t("workspace.collaboration.join")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      <MemberAccessDialog
        open={Boolean(activeAccessTarget)}
        memberName={activeAccessTarget?.profile.name ?? ""}
        role={accessRole}
        onRoleChange={setAccessRole}
        onClose={closeAccess}
        onSave={saveAccess}
      />
      <Modal
        open={passwordOpen}
        onClose={closePasswordEditor}
        label={t("workspace.collaboration.changePassword")}
        description={t("workspace.collaboration.changePasswordHint")}
        className="redux-prompt-dialog collab-password-dialog"
        actions={
          <>
            <Button variant="outlined" onClick={closePasswordEditor}>
              {t("common.action.cancel")}
            </Button>
            <Button
              variant="solid"
              disabled={[...newPassword.trim()].length < 8}
              onClick={submitPassword}
            >
              {t("workspace.collaboration.updatePassword")}
            </Button>
          </>
        }
      >
        <FieldRow
          layout="inline"
          htmlFor="collab-new-password"
          label={t("workspace.collaboration.newPassword")}
          control={
            <SecretInput
              id="collab-new-password"
              value={newPassword}
              minLength={8}
              maxLength={64}
              autoComplete="new-password"
              inputRef={passwordInput}
              placeholder={t("workspace.collaboration.changePasswordPlaceholder")}
              onChange={setNewPassword}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitPassword();
                }
              }}
            />
          }
        />
      </Modal>
    </div>
  );
}
