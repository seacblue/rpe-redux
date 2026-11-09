/**
 * Transport and view actions.
 *
 * Playback rates, seeking, pane toggles, and stage options all run the editor's own
 * operations rather than a promised element.
 */
import { toolbar } from "../../../../core/shell/registries/toolbar.ts";
import { editorChromeCommands } from "../../../contracts/editorCommands.ts";
import { PLAYBACK_RATES } from "../../../../core/edit/playback/rates.ts";
import { editorRate, editorSeekBeat } from "../../../../core/edit/state/publishedValues.ts";
import { requestInput, requestSelect } from "../../../overlays/modals/prompts.ts";
import { t } from "../../../../i18n/index.ts";
import { SHORTCUT_CATEGORIES } from "../../../../core/shortcuts/categories.ts";

/**
 * The transport actions.
 *
 * Each one carries its own `run` and calls the editor transport directly. None
 * names a `domId`: the play button is the toolbar's own node and the rest are
 * action rows.
 */
interface TransportAction {
  id: string;
  label: string;
  /** Secondary hint for menu rows; the play button owns its own tooltip. */
  tooltip?: string;
  run(): void;
}

const TRANSPORT_ACTIONS: readonly TransportAction[] = [
  {
    id: "playback.play",
    label: "chrome.playback.playPause",
    run: () => editorChromeCommands()?.transport.togglePlayback(),
  },
  {
    id: "playback.rewind",
    label: "chrome.playback.rewind",
    tooltip: "chrome.playback.rewind",
    run: () => editorChromeCommands()?.transport.rewind(),
  },
];

/** Registers the transport and view actions; returns their disposers. */
export function registerViewActions() {
  return [
    ...TRANSPORT_ACTIONS.map(({ id, label, tooltip, run }, index) =>
      toolbar.register({
        kind: "action",
        id,
        group: "playback",
        order: 90 + index,
        icon: "playbackPlay",
        label,
        tooltip: tooltip ?? label,
        shortcutId: id === "playback.play" ? "playback.pause" : undefined,
        shortcutScope: id === "playback.play" ? "workspace" : undefined,
        run,
      }),
    ),
    toolbar.register({
      kind: "action",
      id: "playback.seek",
      group: "playback",
      order: 100,
      icon: "jump",
      label: "chrome.time.beat",
      tooltip: "chrome.time.beatHint",
      run: () => editorChromeCommands()?.transport.seekToBeat(editorSeekBeat.get()),
    }),
    toolbar.register({
      kind: "action",
      id: "playback.jump",
      group: "playback",
      order: 110,
      separatorBefore: true,
      icon: "jump",
      label: "chrome.menu.playback.seek",
      tooltip: "chrome.menu.playback.seek",
      run: () => {
        void requestInput({
          title: t("chrome.menu.playback.seek"),
          defaultValue: editorSeekBeat.get(),
          label: t("common.action.apply"),
          cancelLabel: t("common.action.cancel"),
        }).then((beat) => {
          if (beat?.trim()) {
            editorChromeCommands()?.transport.seekToBeat(beat.trim());
          }
        });
      },
    }),
    toolbar.register({
      kind: "action",
      id: "playback.rate",
      group: "playback",
      order: 120,
      icon: "rate",
      label: "chrome.time.rate",
      tooltip: "chrome.time.rate",
      run: () => {
        void requestSelect({
          title: t("chrome.time.rate"),
          defaultValue: editorRate.get(),
          cancelLabel: t("common.action.cancel"),
          entries: PLAYBACK_RATES.map((rate) => ({ value: rate, label: `${rate}x` })),
        }).then((rate) => {
          if (rate) {
            editorRate.set(rate);
          }
        });
      },
    }),
    toolbar.register({
      kind: "action",
      id: "view.resetCamera",
      group: "workspace",
      order: 140,
      separatorBefore: true,
      icon: "refresh",
      label: "shortcuts.editor.resetCamera",
      tooltip: "shortcuts.editor.resetCamera",
      shortcutId: "view.resetCamera",
      shortcutScope: "editor",
      run: () => editorChromeCommands()?.view.resetCamera(true),
    }),
    toolbar.register({
      kind: "action",
      id: "view.togglePreviewOnly",
      group: "workspace",
      order: 145,
      icon: "preview",
      label: "shortcuts.editor.togglePreviewOnly",
      tooltip: "shortcuts.editor.togglePreviewOnlyHint",
      shortcutId: "view.togglePreviewOnly",
      shortcutScope: "editor",
      checked: () => editorChromeCommands()?.view.isPreviewLayout() ?? false,
      run: () => editorChromeCommands()?.view.togglePreviewOnly(),
    }),
    // Region switches stay on the left hand: Q, W, E follow the menu order,
    // notes then events then preview, with the pair on the next key.
    toolbar.register({
      kind: "action",
      id: "view.toggleNotes",
      group: "workspace",
      order: 150,
      separatorBefore: true,
      icon: "layers",
      label: "shortcuts.editor.showNotes",
      tooltip: "shortcuts.editor.showNotes",
      shortcuts: [{ key: "Q", modifiers: ["CTRL", "SHIFT"] }],
      shortcutCategory: SHORTCUT_CATEGORIES.editorPlayback,
      shortcutScope: "editor",
      run: () => editorChromeCommands()?.view.toggleRegion("showNotes"),
    }),
    toolbar.register({
      kind: "action",
      id: "view.toggleEvents",
      group: "workspace",
      order: 160,
      icon: "bezier",
      label: "shortcuts.editor.showEvents",
      tooltip: "shortcuts.editor.showEvents",
      shortcuts: [{ key: "W", modifiers: ["CTRL", "SHIFT"] }],
      shortcutCategory: SHORTCUT_CATEGORIES.editorPlayback,
      shortcutScope: "editor",
      run: () => editorChromeCommands()?.view.toggleRegion("showEvents"),
    }),
    toolbar.register({
      kind: "action",
      id: "view.togglePreview",
      group: "workspace",
      order: 170,
      icon: "preview",
      label: "shortcuts.editor.showPreview",
      tooltip: "shortcuts.editor.showPreview",
      shortcuts: [{ key: "E", modifiers: ["CTRL", "SHIFT"] }],
      shortcutCategory: SHORTCUT_CATEGORIES.editorPlayback,
      shortcutScope: "editor",
      run: () => editorChromeCommands()?.view.toggleStagePreview(),
    }),
    toolbar.register({
      kind: "action",
      id: "view.toggleNotesEvents",
      group: "workspace",
      order: 180,
      icon: "layout",
      label: "shortcuts.editor.toggleNotesEvents",
      tooltip: "shortcuts.editor.toggleNotesEvents",
      shortcuts: [{ key: "R", modifiers: ["CTRL", "SHIFT"] }],
      shortcutCategory: SHORTCUT_CATEGORIES.editorPlayback,
      shortcutScope: "editor",
      run: () => editorChromeCommands()?.view.toggleRegions(),
    }),
  ];
}
