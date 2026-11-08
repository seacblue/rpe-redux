/**
 * The workbench's slot catalog: grouping, labels, and the control each slot
 * needs. Canonical paths and package assembly live in `core/media/phiraSkinDraft`;
 * this file only supplies the visual order and message keys.
 */
import type { MessageKey } from "../../../../i18n/index.ts";
import type { PhiraWorkbenchSlot } from "../../../../core/media/phiraSkinDraft.ts";

/** The editor a slot opens after it receives a file. */
export type WorkbenchSlotKind = "image" | "hold" | "hitFx" | "sound";

/** One tile in the workbench. */
export interface WorkbenchSlotDefinition {
  readonly slot: PhiraWorkbenchSlot;
  readonly label: MessageKey;
  readonly kind: WorkbenchSlotKind;
}

/** One titled row of tiles. */
export interface WorkbenchSectionDefinition {
  readonly id: string;
  readonly title: MessageKey;
  readonly slots: readonly WorkbenchSlotDefinition[];
}

/** The workbench's fixed board, top to bottom. */
export const WORKBENCH_SECTIONS: readonly WorkbenchSectionDefinition[] = [
  {
    id: "notes",
    title: "settings.skin.workbench.section.notes",
    slots: [
      { slot: "tap", label: "settings.skin.workbench.slot.tap", kind: "image" },
      {
        slot: "tap_highlight",
        label: "settings.skin.workbench.slot.tapHighlight",
        kind: "image",
      },
      { slot: "drag", label: "settings.skin.workbench.slot.drag", kind: "image" },
      {
        slot: "drag_highlight",
        label: "settings.skin.workbench.slot.dragHighlight",
        kind: "image",
      },
      { slot: "flick", label: "settings.skin.workbench.slot.flick", kind: "image" },
      {
        slot: "flick_highlight",
        label: "settings.skin.workbench.slot.flickHighlight",
        kind: "image",
      },
      { slot: "hold", label: "settings.skin.workbench.slot.hold", kind: "hold" },
      {
        slot: "hold_highlight",
        label: "settings.skin.workbench.slot.holdHighlight",
        kind: "hold",
      },
    ],
  },
  {
    id: "event",
    title: "settings.skin.workbench.section.event",
    slots: [
      {
        slot: "event_hold",
        label: "settings.skin.workbench.slot.eventHold",
        kind: "image",
      },
    ],
  },
  {
    id: "judgeline",
    title: "settings.skin.workbench.section.judgeline",
    slots: [
      {
        slot: "judgeline",
        label: "settings.skin.workbench.slot.judgeline",
        kind: "image",
      },
    ],
  },
  {
    id: "effects",
    title: "settings.skin.workbench.section.effects",
    slots: [
      {
        slot: "hit_fx",
        label: "settings.skin.workbench.slot.hitFx",
        kind: "hitFx",
      },
    ],
  },
  {
    id: "sounds",
    title: "settings.skin.workbench.section.sounds",
    slots: [
      {
        slot: "tap_sound",
        label: "settings.skin.workbench.slot.tapSound",
        kind: "sound",
      },
      {
        slot: "drag_sound",
        label: "settings.skin.workbench.slot.dragSound",
        kind: "sound",
      },
      {
        slot: "flick_sound",
        label: "settings.skin.workbench.slot.flickSound",
        kind: "sound",
      },
    ],
  },
];

/** Every slot in board order. */
export const WORKBENCH_SLOTS: readonly WorkbenchSlotDefinition[] = WORKBENCH_SECTIONS.flatMap(
  (section) => section.slots,
);
