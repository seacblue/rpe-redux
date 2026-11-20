/**
 * General → Interface rows for the shell's panel sizes.
 *
 * A row stores one scale factor rather than a pixel size or a window share, so a
 * profile keeps the same density at every resolution: the panel and everything
 * drawn inside it grow together, and a bigger window gives its extra room to the
 * canvas. The same definition drives the drag seam beside the workspace.
 */
import { settingsRegistry } from "../settings.ts";
import type { SettingDefinition } from "../types.ts";
import { LAYOUT_REGIONS } from "../../shell/layoutProportions.ts";

const LayoutSettings: SettingDefinition[] = [
  {
    key: LAYOUT_REGIONS.toolbar.key,
    navigation: "general.interface",
    group: "settings.group.layout",
    label: "settings.field.layout-toolbar-scale.label",
    description: "settings.field.layout-toolbar-scale.description",
    control: "range",
    default: LAYOUT_REGIONS.toolbar.defaultScale,
    min: LAYOUT_REGIONS.toolbar.minScale,
    max: LAYOUT_REGIONS.toolbar.maxScale,
    step: 0.02,
    unit: "settings.unit.layout-scale",
  },
  {
    key: LAYOUT_REGIONS.statusbar.key,
    navigation: "general.interface",
    group: "settings.group.layout",
    label: "settings.field.layout-statusbar-scale.label",
    description: "settings.field.layout-statusbar-scale.description",
    control: "range",
    default: LAYOUT_REGIONS.statusbar.defaultScale,
    min: LAYOUT_REGIONS.statusbar.minScale,
    max: LAYOUT_REGIONS.statusbar.maxScale,
    step: 0.02,
    unit: "settings.unit.layout-scale",
  },
  {
    key: LAYOUT_REGIONS.inspector.key,
    navigation: "general.interface",
    group: "settings.group.layout",
    label: "settings.field.layout-inspector-scale.label",
    description: "settings.field.layout-inspector-scale.description",
    control: "range",
    default: LAYOUT_REGIONS.inspector.defaultScale,
    min: LAYOUT_REGIONS.inspector.minScale,
    max: LAYOUT_REGIONS.inspector.maxScale,
    step: 0.02,
    unit: "settings.unit.layout-scale",
  },
  {
    key: LAYOUT_REGIONS.sidebar.key,
    navigation: "general.interface",
    group: "settings.group.layout",
    label: "settings.field.layout-sidebar-scale.label",
    description: "settings.field.layout-sidebar-scale.description",
    control: "range",
    default: LAYOUT_REGIONS.sidebar.defaultScale,
    min: LAYOUT_REGIONS.sidebar.minScale,
    max: LAYOUT_REGIONS.sidebar.maxScale,
    step: 0.02,
    unit: "settings.unit.layout-scale",
  },
  {
    key: LAYOUT_REGIONS.progress.key,
    navigation: "general.interface",
    group: "settings.group.layout",
    label: "settings.field.layout-progress-scale.label",
    description: "settings.field.layout-progress-scale.description",
    control: "range",
    default: LAYOUT_REGIONS.progress.defaultScale,
    min: LAYOUT_REGIONS.progress.minScale,
    max: LAYOUT_REGIONS.progress.maxScale,
    step: 0.02,
    unit: "settings.unit.layout-scale",
  },
];

settingsRegistry.registerSettings(LayoutSettings);
