/** Confirms a deep-link room join before the welcome page opens collaboration. */
import {
  dismissModal,
  MODAL_PRIORITY,
  presentModal,
} from "../../../../overlays/modals/modalQueue.ts";
import { PromptActions } from "../../../../overlays/modals/PromptContent.tsx";
import { t } from "../../../../../i18n/index.ts";
import type { RoomMember } from "../../../../../core/collaboration/types.ts";
import type { RoomInvitePreview } from "./roomInvitePreview.ts";

let nextPromptId = 0;

const ROLE_KEYS = {
  host: "workspace.collaboration.role.host",
  editor: "workspace.collaboration.role.editor",
  viewer: "workspace.collaboration.role.viewer",
} as const;

function MemberList({ members }: { members: readonly RoomMember[] }) {
  if (!members.length) {
    return (
      <p className="collab-invite-preview-empty">
        {t("workspace.collaboration.joinInviteNoMembers")}
      </p>
    );
  }
  return (
    <ul className="collab-member-list collab-invite-preview-members">
      {members.map((member) => (
        <li key={member.id} className="collab-member">
          <span
            className="collab-member-swatch"
            style={{ color: member.profile.color }}
            aria-hidden="true"
          />
          <span className="collab-member-name">
            {member.profile.name}
            <small className="collab-member-role">{t(ROLE_KEYS[member.role])}</small>
          </span>
          <span className="collab-invite-preview-status">
            {member.online
              ? t("workspace.collaboration.joinInviteOnline")
              : t("workspace.collaboration.joinInviteOffline")}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Present a join confirmation and resolve whether the user accepted it. */
export function requestRoomInviteConfirmation(preview: RoomInvitePreview | null): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `collaboration-invite:${++nextPromptId}`;
    let pending = true;
    const settle = (accepted: boolean) => {
      if (!pending) {
        return;
      }
      pending = false;
      dismissModal(id);
      resolve(accepted);
    };
    presentModal(id, {
      label: t("workspace.collaboration.joinInviteTitle"),
      className: "redux-prompt-dialog collab-invite-dialog",
      role: "alertdialog",
      priority: MODAL_PRIORITY.consent,
      onClose: () => settle(false),
      actions: (
        <PromptActions
          confirm
          label={t("workspace.collaboration.joinInviteConfirm")}
          cancelLabel={t("workspace.collaboration.joinInviteCancel")}
          settle={settle}
        />
      ),
      children: (
        <>
          <div className="collab-invite-preview-heading">
            <strong>{t("workspace.collaboration.joinInviteMembers")}</strong>
            {preview && (
              <span>
                {t("workspace.collaboration.joinInviteCapacity", {
                  count: preview.members.length,
                  max: preview.maxMembers,
                })}
              </span>
            )}
          </div>
          {preview ? (
            <MemberList members={preview.members} />
          ) : (
            <p className="collab-invite-preview-empty">
              {t("workspace.collaboration.joinInviteMembersUnavailable")}
            </p>
          )}
        </>
      ),
    });
  });
}
