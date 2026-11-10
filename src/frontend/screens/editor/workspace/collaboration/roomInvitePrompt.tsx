/** Confirms a deep-link room join before the welcome page opens collaboration. */
import { useState, type ReactNode } from "react";
import {
  dismissModal,
  MODAL_PRIORITY,
  presentModal,
} from "../../../../overlays/modals/modalQueue.ts";
import { PromptActions } from "../../../../overlays/modals/PromptContent.tsx";
import { ColorField } from "../../../../../design/components/input/ColorField.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import { t } from "../../../../../i18n/index.ts";
import type { CollaborationProfile, RoomMember } from "../../../../../core/collaboration/types.ts";
import type { RoomInvitePreview } from "./roomInvitePreview.ts";

let nextPromptId = 0;

const ROLE_KEYS = {
  host: "workspace.collaboration.role.host",
  editor: "workspace.collaboration.role.editor",
  viewer: "workspace.collaboration.role.viewer",
} as const;

/** Editable identity fields carried into the room join request. */
interface IdentityDraft {
  name: string;
  color: string;
}

function IdentityFields({
  initial,
  onChange,
}: {
  initial: CollaborationProfile;
  onChange(next: IdentityDraft): void;
}): ReactNode {
  const { t: translate } = useTranslation();
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  return (
    <div className="collab-invite-identity">
      <FieldRow
        layout="inline"
        label={translate("workspace.collaboration.displayName")}
        control={(id) => (
          <Input
            id={id}
            value={name}
            maxLength={48}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setName(next);
              onChange({ name: next, color });
            }}
          />
        )}
      />
      <FieldRow
        layout="inline"
        label={translate("workspace.collaboration.color")}
        control={
          <ColorField
            value={color}
            onChange={(next) => {
              setColor(next);
              onChange({ name, color: next });
            }}
          />
        }
      />
    </div>
  );
}

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

/** Present a join confirmation and resolve the chosen identity, or null. */
export function requestRoomInviteConfirmation(
  preview: RoomInvitePreview | null,
  initial: CollaborationProfile,
): Promise<CollaborationProfile | null> {
  return new Promise((resolve) => {
    const id = `collaboration-invite:${++nextPromptId}`;
    const draft: IdentityDraft = {
      name: initial.name.trim() || t("workspace.collaboration.defaultName"),
      color: initial.color,
    };
    let pending = true;
    const settle = (accepted: boolean) => {
      if (!pending) {
        return;
      }
      pending = false;
      dismissModal(id);
      resolve(
        accepted
          ? {
              name:
                draft.name.trim() ||
                initial.name.trim() ||
                t("workspace.collaboration.defaultName"),
              color: draft.color,
            }
          : null,
      );
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
          <IdentityFields
            initial={draft}
            onChange={(next) => {
              draft.name = next.name;
              draft.color = next.color;
            }}
          />
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
