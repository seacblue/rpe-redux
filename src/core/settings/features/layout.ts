/**
 * General → Interface rows for the shell's panel proportions.
 *
 * A row stores a share of the window rather than a pixel size, so the panels
 * keep their weight when the window changes. The same definition drives the
 * drag seam beside the workspace: both write this one value.
 */
import { settingsRegistry } from "../settings.ts";
import type { SettingDefinition } from "../types.ts";
import { LAYOUT_REGIONS } from "../../shell/layoutProportions.ts";

const LayoutSettings: SettingDefinition[] = [
  {
    key: LAYOUT_REGIONS.toolbar.key,
    navigation: "general.interface",
    group: "settings.group.layout",
    label: "settings.field.layout-toolbar-share.label",
    description: "settings.field.layout-toolbar-share.description",
    control: "range",
    default: LAYOUT_REGIONS.toolbar.defaultShare,
    min: LAYOUT_REGIONS.toolbar.minShare,
    max: LAYOUT_REGIONS.toolbar.maxShare,
    step: 0.0005,
    percentage: true,
  },
  {
    key: LAYOUT_REGIONS.statusbar.key,
    navigation: "general.interface",
    group: "settings.group.layout",
    label: "settings.field.layout-statusbar-share.label",
    description: "settings.field.layout-statusbar-share.description",
    control: "range",
    default: LAYOUT_REGIONS.statusbar.defaultShare,
    min: LAYOUT_REGIONS.statusbar.minShare,
    max: LAYOUT_REGIONS.statusbar.maxShare,
    step: 0.0005,
    percentage: true,
  },
  {
    key: LAYOUT_REGIONS.inspector.key,
    navigation: "general.interface",
    group: "settings.group.layout",
    label: "settings.field.layout-inspector-share.label",
    description: "settings.field.layout-inspector-share.description",
    control: "range",
    default: LAYOUT_REGIONS.inspector.defaultShare,
    min: LAYOUT_REGIONS.inspector.minShare,
    max: LAYOUT_REGIONS.inspector.maxShare,
    step: 0.0005,
    percentage: true,
  },
  {
    key: LAYOUT_REGIONS.sidebar.key,
    navigation: "general.interface",
    group: "settings.group.layout",
    label: "settings.field.layout-sidebar-share.label",
    description: "settings.field.layout-sidebar-share.description",
    control: "range",
    default: LAYOUT_REGIONS.sidebar.defaultShare,
    min: LAYOUT_REGIONS.sidebar.minShare,
    max: LAYOUT_REGIONS.sidebar.maxShare,
    step: 0.0005,
    percentage: true,
  },
];

settingsRegistry.registerSettings(LayoutSettings);
