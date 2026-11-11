/**
 * Draws setting definitions as grouped rows.
 *
 * Groups, headings, and descriptions come from the catalog, so a feature's fields
 * appear without this file knowing about the feature.
 */
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { groupedSettings, settingText, settingsSearchPath } from "./settingsCatalog.ts";
import type { SettingsSearchPathEntry } from "./settingsCatalog.ts";
import type { SettingDefinition, SettingValue } from "../../../core/settings/types.ts";
import { FieldRow } from "../../../design/components/field/FieldRow.tsx";
import { FieldRows } from "../../../design/components/field/FieldRows.tsx";
import { SettingControl } from "./SettingControl.tsx";
import { SettingReset } from "./SettingReset.tsx";
import { settingControlFor, settingGroupColumnsFor } from "./settingsContributions.ts";
import { useSettingMatch } from "./useSetting.ts";
import { runtimePortPending, subscribeRuntimePorts } from "../../platform/desktop/runtimePorts.ts";
import { useTranslation } from "../../../i18n/react.ts";
import "./settingsFeatures.ts";

/** Render one row through a resolved control. */
type ControlFor = (
  field: SettingDefinition,
  describedBy: string | undefined,
  enabled: boolean,
) => ReactNode;

/** One settings row; the gate decides its disabled state once for the row. */
function SettingRow({
  field,
  shown,
  controlFor,
  onCommitValue,
}: {
  field: SettingDefinition;
  shown(field: SettingDefinition): boolean;
  controlFor: ControlFor;
  onCommitValue(field: SettingDefinition, value: SettingValue): void;
}) {
  const { t } = useTranslation();
  // Visibility and usability are independent declarations. Built-in rows stay
  // visible and use `enabledWhen`; `visibleWhen` remains an explicit hide.
  const enableMatch = useSettingMatch(field.enabledWhen);
  const disableMatch = useSettingMatch(field.disabledWhen);
  const enabled = (!field.enabledWhen || enableMatch) && !disableMatch;
  const pendingSnapshot = useCallback(() => runtimePortPending(field.key), [field.key]);
  const pending = useSyncExternalStore(subscribeRuntimePorts, pendingSnapshot, pendingSnapshot);
  const fullWidth = field.control === "custom" && field.fullWidth === true;
  return (
    <FieldRow
      className="redux-setting"
      data-setting={field.key}
      data-control={field.control}
      hidden={!shown(field)}
      disabled={!enabled}
      hoverable
      layout={fullWidth ? "block" : "split"}
      align={fullWidth ? "start" : "center"}
      htmlFor={field.control === "action" ? undefined : field.key}
      idPrefix={field.control === "action" ? undefined : field.key}
      label={
        <span className="redux-setting-label-with-status">
          {settingText(field.label)}
          {pending && (
            <span
              className="redux-setting-restart-marker"
              role="img"
              aria-label={t("settings.restartRequired")}
              data-tip-title={t("settings.restartRequired")}
            />
          )}
        </span>
      }
      description={field.description ? settingText(field.description) : undefined}
      reset={
        fullWidth ? undefined : (
          <SettingReset field={field} onReset={onCommitValue} disabled={!enabled} />
        )
      }
      control={(_, describedBy) => controlFor(field, describedBy, enabled)}
    />
  );
}

/** One breadcrumb path plus the rows that share it. */
interface SearchGroup {
  readonly id: string;
  readonly path: readonly SettingsSearchPathEntry[];
  entries: SettingDefinition[];
}

/** Search results still read like a settings tab: one heading, then its rows. */
function searchGroups(fields: readonly SettingDefinition[]): SearchGroup[] {
  const groups = new Map<string, SearchGroup>();
  for (const field of fields) {
    const path = settingsSearchPath(field);
    const id = path.map((entry) => entry.key).join("|") || `group:${field.group}`;
    const existing = groups.get(id);
    if (existing) {
      existing.entries.push(field);
    } else {
      groups.set(id, { id, path, entries: [field] });
    }
  }
  return [...groups.values()];
}

/** Draw setting definitions as grouped rows, or as search results grouped by path. */
export function SettingsFields({
  fields,
  shown,
  onCommitValue,
  onOpenCategory,
  searching = false,
  pageTitle,
}: {
  fields: SettingDefinition[];
  shown(field: SettingDefinition): boolean;
  onCommitValue(field: SettingDefinition, value: SettingValue): void;
  onOpenCategory(category: string): void;
  searching?: boolean;
  /** The page title shown above these rows; a matching group heading is omitted. */
  pageTitle?: string;
}) {
  // Descriptions are intentionally ordinary flow content rather than tooltips:
  // users can read them without hovering, and controls can reference them from
  // the accessibility tree when a definition provides one.
  const groups: Array<{
    id: string;
    title?: SettingDefinition["group"];
    path?: readonly SettingsSearchPathEntry[];
    entries: SettingDefinition[];
  }> = searching ? searchGroups(fields) : groupedSettings(fields);
  const controlFor: ControlFor = (field, describedBy, enabled) => {
    const Custom = settingControlFor(field.key);
    if (Custom) {
      return <Custom field={field} />;
    }
    return (
      <SettingControl
        field={field}
        enabled={enabled}
        onCommitValue={onCommitValue}
        onOpenCategory={onOpenCategory}
        describedBy={describedBy}
      />
    );
  };
  return (
    <>
      {groups.map((group) => {
        const groupTitle = settingText(group.title ?? "").trim();
        // Search groups have no title, so their first row supplies the group key.
        const groupKey = group.title || group.entries[0]?.group;
        const Columns = groupKey ? settingGroupColumnsFor(groupKey) : null;
        return (
          <div className="redux-setting-group" key={group.id}>
            {group.entries.some(shown) && (
              <>
                {searching
                  ? group.path &&
                    group.path.length > 0 && (
                      <h3 className="redux-setting-search-heading" data-settings-path>
                        {group.path.map((entry, index) => (
                          <span key={entry.key} data-settings-path-entry={entry.key}>
                            {index > 0 && <span aria-hidden="true"> &gt; </span>}
                            {entry.text}
                          </span>
                        ))}
                      </h3>
                    )
                  : groupTitle && groupTitle !== pageTitle && <h3>{groupTitle}</h3>}
                {Columns && <Columns />}
              </>
            )}
            <FieldRows gap="none" className="redux-setting-rows">
              {group.entries.map((field) => (
                <SettingRow
                  key={field.key}
                  field={field}
                  shown={shown}
                  controlFor={controlFor}
                  onCommitValue={onCommitValue}
                />
              ))}
            </FieldRows>
          </div>
        );
      })}
    </>
  );
}
