/** Next-launch ports for the desktop shell, local backend, and AI service. */
import { settingsRegistry } from "../settings.ts";
import type { SettingDefinition } from "../types.ts";

const RuntimePortSettings: SettingDefinition[] = [
  {
    key: "frontend-port",
    navigation: "general.interface",
    group: "settings.group.runtimePorts",
    label: "settings.field.frontend-port.label",
    description: "settings.field.frontend-port.description",
    control: "number",
    default: 4173,
    hosts: ["desktop"],
    min: 1,
    max: 65535,
    step: 1,
    integer: true,
  },
  {
    key: "backend-port",
    navigation: "general.interface",
    group: "settings.group.runtimePorts",
    label: "settings.field.backend-port.label",
    description: "settings.field.backend-port.description",
    control: "number",
    default: 47821,
    hosts: ["desktop"],
    min: 1,
    max: 65535,
    step: 1,
    integer: true,
  },
  {
    key: "ai-port",
    navigation: "general.interface",
    group: "settings.group.runtimePorts",
    label: "settings.field.ai-port.label",
    description: "settings.field.ai-port.description",
    control: "number",
    default: 47822,
    hosts: ["desktop"],
    min: 1,
    max: 65535,
    step: 1,
    integer: true,
    // The bridge only binds its loopback port while AI code cells are enabled.
    enabledWhen: { key: "code-execution-enabled", equals: true },
  },
];

settingsRegistry.registerSettings(RuntimePortSettings);
