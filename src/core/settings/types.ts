/**
 * The shape of a contributed setting: navigation items and the discriminated
 * definition union every control renders from.
 *
 * A definition carries its key, default and control-specific constraints
 * together, so registration, discovery and rendering all read one schema.
 */
import type { MessageKey } from "../../i18n/index.ts";
import type { ExtensionText } from "../extensions/i18n.ts";

/**
 * Text accepted by a setting row; host rows keep their typed MessageKey.
 *
 * The empty string is a deliberate blank: a schema row uses it for a group with
 * no heading so the page title remains the only heading on the surface.
 */
export type SettingText = MessageKey | "" | ExtensionText;

/** A value a setting control reads or writes; toggle rows use a real boolean. */
export type SettingValue = string | number | boolean;

/** Hosts on which a setting has an effect. */
export type SettingHost = "desktop" | "web";

/** Navigation item contributed by a settings feature or extension. */
export interface SettingsNavigation {
  key: string;
  label: MessageKey;
  icon?: string;
  parent?: string;
  order?: number;
  /** Show this page only on the listed hosts; omitted means every host. */
  hosts?: readonly SettingHost[];
}

/** Consent copy for a toggle that crosses a trust boundary. */
export interface SettingConfirm {
  title: SettingText;
  description: SettingText;
  label: SettingText;
  cancelLabel?: SettingText;
  /** Paint the confirming action with the danger surface. */
  destructive?: boolean;
}

/** Shared metadata for every setting definition. */
interface SettingDefinitionBase {
  key: string;
  navigation: string;
  /** Empty string leaves the rows ungrouped and the page title alone on top. */
  group: MessageKey | "";
  label: SettingText;
  description?: SettingText;
  default?: string | number | boolean;
  /** Ask for explicit consent before a toggle changes a trust boundary. */
  confirm?: SettingConfirm;
  /** Show this row only on the listed hosts; omitted means every host. */
  hosts?: readonly SettingHost[];
  /** Show this row only while another setting holds the given value (true by default). */
  visibleWhen?: { key: string; equals?: SettingValue };
  /** Enable this row only while another setting holds the given value (true by default). */
  enabledWhen?: { key: string; equals?: SettingValue };
  /** Disable this row while another setting holds the given value (true by default). */
  disabledWhen?: { key: string; equals?: SettingValue };
}

interface SettingOption {
  value: string;
  label: SettingText;
}

/** Numeric controls share one value contract; range only changes presentation. */
interface NumericSettingDefinition extends SettingDefinitionBase {
  control: "range" | "number";
  default: number;
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
  unit?: SettingText;
  percentage?: boolean;
}

interface ToggleSettingDefinition extends SettingDefinitionBase {
  control: "toggle";
  default: boolean;
}

interface SelectSettingDefinition extends SettingDefinitionBase {
  control: "select";
  default: string;
  options: readonly [SettingOption, ...SettingOption[]];
}

interface TextSettingDefinition extends SettingDefinitionBase {
  control: "text";
  default?: string;
  placeholder?: MessageKey;
  multiline?: boolean;
}

interface CustomSettingDefinition extends SettingDefinitionBase {
  control: "custom";
  default?: string;
  note?: MessageKey;
  /** Draw the control across the full row instead of beside a label column. */
  fullWidth?: boolean;
}

interface BeatSettingDefinition extends SettingDefinitionBase {
  control: "beat";
  default?: string;
  note?: MessageKey;
}

interface ColorSettingDefinition extends SettingDefinitionBase {
  control: "color";
  /** Hex RGB or RGBA colour persisted by the value store. */
  default: string;
}

interface ActionSettingDefinition extends SettingDefinitionBase {
  control: "action";
  action:
    | { kind: "navigate"; target: string; icon?: string }
    | { kind: "action"; actionId: string; icon?: string }
    | { kind: "open-url"; url: string; icon?: string };
  /** Whether the label also appears as the button's hover tooltip. Defaults to true. */
  tooltip?: boolean;
}

interface FileSettingDefinition extends SettingDefinitionBase {
  control: "file";
  /** The selected file name or an empty value when no file is selected. */
  default?: string;
  accept?: string;
  /** Store the selected file in application data and persist only its reference. */
  storage?: "application-data";
}

/** Complete schema for one setting, shared by registration, discovery, and rendering. */
export type SettingDefinition =
  | NumericSettingDefinition
  | ToggleSettingDefinition
  | SelectSettingDefinition
  | TextSettingDefinition
  | CustomSettingDefinition
  | BeatSettingDefinition
  | ColorSettingDefinition
  | ActionSettingDefinition
  | FileSettingDefinition;
