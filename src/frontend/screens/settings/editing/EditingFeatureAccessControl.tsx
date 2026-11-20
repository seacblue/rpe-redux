/**
 * Draws the AI and display permission columns for optional editing features.
 *
 * Each advanced-editing group renders one heading row, and every feature row
 * repeats its grid with bare checkboxes: AI access first, editor display second.
 * The AI column only appears while code cells are enabled, so the page never
 * presents an AI permission that cannot be used.
 */
import { values } from "../../../../core/state/values.ts";
import {
  EDITING_FEATURE_AI_KEYS,
  EDITING_FEATURE_KEYS,
  EDITING_FEATURES,
  editingFeatureForSetting,
} from "../../../../core/settings/editingFeatureKeys.ts";
import { useTranslation } from "../../../../i18n/react.ts";
import { Input } from "../../../../design/components/input/Input.tsx";
import type { SettingDefinition } from "../../../../core/settings/types.ts";
import { settingText } from "../settingsCatalog.ts";
import { registerSettingControl, registerSettingGroupColumns } from "../settingsContributions.ts";
import { useSetting } from "../useSetting.ts";

/** The three groups whose rows share the AI and display columns. */
const EDITING_ACCESS_GROUPS = [
  "settings.group.editingNoteFeatures",
  "settings.group.editingEventFeatures",
  "settings.group.editingLineFeatures",
] as const;

/** Column headings shared by one advanced-editing group. */
function EditingFeatureAccessHeader() {
  const { t } = useTranslation();
  const codeEnabled = useSetting<boolean>("code-execution-enabled", false);
  return (
    <div className="redux-setting-columns" aria-hidden="true">
      <span className="redux-setting-columns-spacer" />
      <div className="redux-field-control">
        <span className="redux-field-reset-slot" />
        <div
          className="editing-access editing-access-header"
          data-columns={codeEnabled ? "2" : "1"}
        >
          {codeEnabled && (
            <span>
              <strong>{t("settings.editingAccess.aiUse")}</strong>
            </span>
          )}
          <span>
            <strong>{t("settings.editingAccess.visible")}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}

/** The AI and display checkboxes for one advanced editing feature. */
export function EditingFeatureAccessControl({ field }: { field: SettingDefinition }) {
  const { t } = useTranslation();
  const feature = editingFeatureForSetting(field.key);
  const humanDefault = field.control === "toggle" ? field.default : true;
  const human = useSetting<boolean>(field.key, humanDefault);
  const codeEnabled = useSetting<boolean>("code-execution-enabled", false);
  const aiKey = feature ? EDITING_FEATURE_AI_KEYS[feature] : "";
  const ai = useSetting<boolean>(aiKey, human);
  if (!feature) {
    return null;
  }
  const aiId = `${field.key}-ai`;
  const describedBy = `${field.key}-description`;
  const rowLabel = settingText(field.label);
  return (
    <div className="editing-access" data-columns={codeEnabled ? "2" : "1"}>
      {codeEnabled && (
        <label className="editing-access-cell" data-access="ai">
          <Input
            id={aiId}
            type="checkbox"
            checked={ai}
            aria-label={t("settings.editingAccess.aiUseCheckbox", { field: rowLabel })}
            aria-describedby={describedBy}
            onChange={(event) =>
              values.byId.setUser(EDITING_FEATURE_AI_KEYS[feature], event.currentTarget.checked)
            }
          />
        </label>
      )}
      <label className="editing-access-cell" data-access="visible">
        <Input
          id={field.key}
          type="checkbox"
          checked={human}
          aria-label={t("settings.editingAccess.visibleCheckbox", { field: rowLabel })}
          aria-describedby={describedBy}
          onChange={(event) =>
            values.byId.setUser(EDITING_FEATURE_KEYS[feature], event.currentTarget.checked)
          }
        />
      </label>
    </div>
  );
}

for (const feature of EDITING_FEATURES) {
  registerSettingControl(EDITING_FEATURE_KEYS[feature], EditingFeatureAccessControl);
}

for (const group of EDITING_ACCESS_GROUPS) {
  registerSettingGroupColumns(group, EditingFeatureAccessHeader);
}
