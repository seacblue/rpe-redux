/** Anchored walkthroughs for the three large Inspector pages. */
import type { HelpTutorialDefinition } from "../../../core/help/tutorialRegistry.ts";

const panel = (id: string) => `inspector-panel-${id}`;
const inspectorActivation = (id: string) => ({ kind: "inspector" as const, id });

/** The timing, judge-line, and asset pages each own a distinct workflow. */
export const GLOBAL_PAGE_TUTORIALS = {
  timing: {
    id: "page.timing",
    category: "guide.category.editing",
    title: "guide.section.timing.title",
    summary: "guide.section.timing.summary",
    icon: "bpm",
    activate: inspectorActivation("timing"),
    steps: [
      {
        id: "open-list",
        title: "tutorial.timing.open.title",
        body: "tutorial.timing.open.body",
        targets: [panel("timing")],
        placement: "left",
      },
      {
        id: "select-point",
        title: "tutorial.timing.select.title",
        body: "tutorial.timing.select.body",
        targets: [panel("timing")],
        placement: "left",
      },
      {
        id: "edit-values",
        title: "tutorial.timing.edit.title",
        body: "tutorial.timing.edit.body",
        targets: [panel("timing")],
        placement: "left",
      },
      {
        id: "verify-audio",
        title: "tutorial.timing.verify.title",
        body: "tutorial.timing.verify.body",
        targets: [panel("timing"), "stage"],
        placement: "left",
      },
    ],
  },
  lines: {
    id: "page.lines",
    category: "guide.category.editing",
    title: "guide.section.lines.title",
    summary: "guide.section.lines.summary",
    icon: "grid",
    activate: inspectorActivation("lines"),
    steps: [
      {
        id: "choose-line",
        title: "tutorial.lines.choose.title",
        body: "tutorial.lines.choose.body",
        targets: [panel("lines")],
        placement: "left",
      },
      {
        id: "edit-properties",
        title: "tutorial.lines.edit.title",
        body: "tutorial.lines.edit.body",
        targets: [panel("lines")],
        placement: "left",
      },
      {
        id: "organize-relations",
        title: "tutorial.lines.organize.title",
        body: "tutorial.lines.organize.body",
        targets: [panel("lines")],
        placement: "left",
      },
      {
        id: "check-stage",
        title: "tutorial.lines.check.title",
        body: "tutorial.lines.check.body",
        targets: [panel("lines"), "stage"],
        placement: "left",
      },
    ],
  },
  assets: {
    id: "page.assets",
    category: "guide.category.editing",
    title: "guide.section.assets.title",
    summary: "guide.section.assets.summary",
    icon: "folder",
    activate: inspectorActivation("assets"),
    steps: [
      {
        id: "browse-library",
        title: "tutorial.assets.browse.title",
        body: "tutorial.assets.browse.body",
        targets: [panel("assets")],
        placement: "left",
      },
      {
        id: "inspect-entry",
        title: "tutorial.assets.inspect.title",
        body: "tutorial.assets.inspect.body",
        targets: [panel("assets")],
        placement: "left",
      },
      {
        id: "import-resource",
        title: "tutorial.assets.import.title",
        body: "tutorial.assets.import.body",
        targets: [panel("assets")],
        placement: "left",
      },
      {
        id: "verify-reference",
        title: "tutorial.assets.verify.title",
        body: "tutorial.assets.verify.body",
        targets: [panel("assets")],
        placement: "left",
      },
    ],
  },
} satisfies Record<string, HelpTutorialDefinition>;
