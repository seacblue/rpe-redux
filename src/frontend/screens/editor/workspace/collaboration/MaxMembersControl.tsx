/**
 * Host-only member-limit slider for an open collaboration room.
 *
 * The pointer or keyboard interaction edits a local draft; the room is only
 * updated when that interaction ends. A value below the current member count
 * asks first, because existing members stay but further joins are blocked.
 * The parent keys this control by the authoritative limit so a confirmed server
 * update reseeds the draft without an effect.
 */
import { useRef, useState } from "react";
import { SliderField } from "../../../../../design/components/slider/SliderField.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import { requestConfirm } from "../../../../overlays/modals/prompts.ts";

/** One drafted limit slider bound to the live room's member count. */
export function MaxMembersControl({
  value,
  memberCount,
  onChange,
}: {
  value: number;
  memberCount: number;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const start = useRef(value);
  const committing = useRef(false);
  /** Commits one released value, confirming a cap below the current members. */
  const commit = async (next: number) => {
    if (committing.current || next === value) {
      return;
    }
    committing.current = true;
    try {
      if (next < memberCount) {
        const confirmed = await requestConfirm({
          title: t("workspace.collaboration.maxMembersBelowTitle"),
          description: t("workspace.collaboration.maxMembersBelowBody"),
          label: t("workspace.collaboration.maxMembersBelowConfirm"),
          destructive: true,
        });
        if (!confirmed) {
          setDraft(start.current);
          return;
        }
      }
      setDraft(next);
      onChange(next);
    } finally {
      committing.current = false;
    }
  };
  return (
    <SliderField
      id="collab-max-members"
      min={2}
      max={32}
      step={1}
      value={draft}
      aria-label={t("workspace.collaboration.maxMembers")}
      onChange={(event) => setDraft(Number(event.currentTarget.value))}
      onFocus={() => {
        start.current = value;
      }}
      onPointerDown={() => {
        start.current = value;
      }}
      onCommit={(next) => void commit(next)}
    />
  );
}
