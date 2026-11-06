/**
 * Draws one registered setting as the control its definition names.
 *
 * File fields get their host interactions here; toggles that guard a trust
 * boundary ask for explicit consent before the value changes. Everything else
 * delegates to the shared design controls.
 */
import { useEffect, useState } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { Icon } from "../../../design/components/icon/Icon.tsx";
import { SchemaControl } from "../../../design/components/field/SchemaControl.tsx";
import { ColorField } from "../../../design/components/input/ColorField.tsx";
import { ICON_NAMES, type IconName } from "../../../design/components/icon/iconAssets.ts";
import { settingText } from "./settingsCatalog.ts";
import type { SettingDefinition, SettingValue } from "../../../core/settings/types.ts";
import { useTranslation } from "../../../i18n/react.ts";
import { useSetting } from "./useSetting.ts";
import { requestConfirm } from "../../overlays/modals/prompts.ts";
import { MODAL_PRIORITY } from "../../overlays/modals/modalQueue.ts";
import { pickFiles } from "../../platform/filePicker.ts";
import { toolbar } from "../../../core/shell/registries/toolbar.ts";
import { prepareMediaFile } from "../editor/chartMetadata/mediaFile.ts";
import {
  readCustomBackground,
  saveCustomBackground,
} from "../../platform/desktop/customBackground.ts";
import { isDesktop } from "../../../core/platform/environment.ts";
import { mediaType } from "../../../core/media/mime.ts";
import { toBlobPart } from "../../../core/utils/bytes.ts";
import { openExternalUrl } from "../../../core/platform/desktop/openExternal.ts";
import { showToast } from "../../../design/patterns/ToastHost.tsx";

/** One image stored in application data, ready to paint or flagged as failed. */
interface ApplicationDataImage {
  reference: string;
  url: string;
  failed: boolean;
}

/** Load one application-data image as an object URL for the settings preview. */
function useApplicationDataImage(reference: string): ApplicationDataImage | null {
  const [preview, setPreview] = useState<ApplicationDataImage | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    if (!reference || !isDesktop()) {
      return;
    }
    void readCustomBackground(reference)
      .then((bytes) => {
        if (!active) {
          return;
        }
        const type = mediaType(reference);
        objectUrl = URL.createObjectURL(
          new Blob([toBlobPart(bytes)], {
            type: type.startsWith("image/") ? type : "image/png",
          }),
        );
        setPreview({ reference, url: objectUrl, failed: false });
      })
      .catch(() => {
        if (active) {
          setPreview({ reference, url: "", failed: true });
        }
      });
    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [reference]);
  return preview?.reference === reference ? preview : null;
}

/** Image picker for a setting backed by one application-data file. */
function ApplicationDataImageField({
  field,
  value,
  enabled,
  describedBy,
  onCommitValue,
}: {
  field: SettingDefinition;
  value: string;
  enabled: boolean;
  describedBy?: string;
  onCommitValue(field: SettingDefinition, value: SettingValue): void;
}) {
  const { t } = useTranslation();
  const preview = useApplicationDataImage(value);
  const failed = preview?.failed === true;
  const actionLabel = value
    ? t("settings.control.file.replace")
    : t("settings.control.file.choose");
  const descriptionProps = describedBy ? { "aria-describedby": describedBy } : {};
  const choose = () => {
    const accept = field.control === "file" ? (field.accept ?? "image/*") : "image/*";
    void pickFiles({ accept })
      .then(async (files) => {
        const file = files?.[0];
        if (!file) {
          return;
        }
        const prepared = await prepareMediaFile(file, "background");
        const reference = await saveCustomBackground(prepared.name, prepared.bytes);
        onCommitValue(field, reference);
      })
      .catch((error: unknown) => {
        console.error("Could not store the selected settings image", error);
      });
  };
  return (
    <span className="redux-setting-image-picker">
      <Button
        id={field.key}
        variant="plain"
        className="redux-setting-image-picker-strip"
        aria-label={actionLabel}
        data-empty={value ? undefined : "true"}
        data-error={failed || undefined}
        disabled={!enabled}
        {...descriptionProps}
        onClick={choose}
      >
        {preview?.url ? (
          <>
            <img src={preview.url} alt="" />
            <span className="redux-setting-image-picker-overlay">{actionLabel}</span>
          </>
        ) : (
          <span className="redux-setting-image-picker-empty">
            <Icon name="image" size={18} />
            <span>{failed ? t("settings.field.custom-background.error") : actionLabel}</span>
          </span>
        )}
      </Button>
      {value && (
        <IconButton
          className="redux-setting-image-picker-clear"
          icon="trash"
          size="small"
          label={t("common.action.clear")}
          disabled={!enabled}
          onClick={() => onCommitValue(field, "")}
        />
      )}
    </span>
  );
}

/** Render one setting definition through the control its `control` field names. */
export function SettingControl({
  field,
  enabled,
  onCommitValue,
  onOpenCategory,
  describedBy,
}: {
  field: SettingDefinition;
  /** The owning row already evaluated its dependency conditions. */
  enabled: boolean;
  onCommitValue(field: SettingDefinition, value: SettingValue): void;
  onOpenCategory(category: string): void;
  describedBy?: string;
}) {
  const { t } = useTranslation();
  const value = useSetting<SettingValue>(field.key, field.default ?? "");
  const [confirming, setConfirming] = useState(false);
  const textValue = typeof value === "string" ? value : String(value ?? "");
  const descriptionProps = describedBy ? { "aria-describedby": describedBy } : {};
  /** Route a value through the definition's consent gate before committing it. */
  const commit = (nextValue: string | boolean) => {
    const confirmation = field.control === "toggle" ? field.confirm : undefined;
    if (confirmation && nextValue === true) {
      if (confirming) {
        return;
      }
      setConfirming(true);
      void requestConfirm({
        title: settingText(confirmation.title),
        description: settingText(confirmation.description),
        label: settingText(confirmation.label),
        cancelLabel: confirmation.cancelLabel ? settingText(confirmation.cancelLabel) : undefined,
        destructive: confirmation.destructive === true,
        priority: MODAL_PRIORITY.consent,
      })
        .then((accepted) => {
          if (accepted) {
            onCommitValue(field, true);
          }
        })
        .finally(() => setConfirming(false));
      return;
    }
    onCommitValue(field, nextValue);
  };
  const minimum = "min" in field ? field.min : undefined;
  const maximum = "max" in field ? field.max : undefined;
  const percentage =
    "percentage" in field && field.percentage !== undefined
      ? field.percentage
      : minimum === 0 && (maximum === 1 || maximum === 100);
  const unit = "unit" in field && field.unit ? settingText(field.unit) : undefined;
  const placeholder =
    "placeholder" in field && field.placeholder ? t(field.placeholder) : undefined;
  const options =
    "options" in field
      ? field.options?.map((option) => ({
          value: option.value,
          label: settingText(option.label),
        }))
      : undefined;
  const multiline = "multiline" in field && field.multiline === true;
  // An action row may name its own glyph; an unknown or absent name keeps the
  // shared chevron.
  const actionIcon: IconName =
    field.control === "action" &&
    field.action.icon !== undefined &&
    (ICON_NAMES as readonly string[]).includes(field.action.icon)
      ? (field.action.icon as IconName)
      : "chevronRight";
  switch (field.control) {
    case "toggle":
    case "number":
    case "range":
    case "select":
    case "text":
    case "beat":
      return (
        <SchemaControl
          id={field.key}
          kind={field.control}
          value={value}
          min={minimum}
          max={maximum}
          step={"step" in field ? field.step : undefined}
          unit={unit}
          percentage={percentage}
          placeholder={placeholder}
          multiline={multiline}
          options={options}
          onChange={commit}
          describedBy={describedBy}
          disabled={!enabled}
        />
      );
    case "color":
      return (
        <ColorField
          id={field.key}
          value={textValue}
          disabled={!enabled}
          describedBy={describedBy}
          onChange={(value) => onCommitValue(field, value)}
        />
      );
    case "action":
      return (
        <IconButton
          id={field.key}
          icon={actionIcon}
          label={settingText(field.label)}
          tooltip={field.tooltip !== false}
          disabled={!enabled}
          {...descriptionProps}
          onClick={() => {
            if (field.action.kind === "navigate") {
              onOpenCategory(field.action.target);
            } else if (field.action.kind === "open-url") {
              void openExternalUrl(field.action.url).catch((reason: unknown) => {
                showToast({
                  message: t("settings.action.openLinkFailed", {
                    message: reason instanceof Error ? reason.message : String(reason),
                  }),
                  level: "error",
                  source: settingText(field.label),
                });
              });
            } else {
              const action = toolbar.node(field.action.actionId);
              if (action?.kind === "action") {
                action.run?.();
              }
            }
          }}
        />
      );
    case "file": {
      if (field.storage === "application-data") {
        return (
          <ApplicationDataImageField
            field={field}
            value={textValue}
            enabled={enabled}
            describedBy={describedBy}
            onCommitValue={onCommitValue}
          />
        );
      }
      return (
        <span className="redux-setting-file">
          <span className="redux-setting-current">
            {textValue.split("/").at(-1) || t("settings.control.file.none")}
          </span>
          <span className="redux-setting-file-actions">
            <Button
              id={field.key}
              variant="outlined"
              disabled={!enabled}
              {...descriptionProps}
              onClick={() => {
                void pickFiles({ accept: field.accept ?? "image/*" })
                  .then((files) => {
                    const file = files?.[0];
                    if (file) {
                      onCommitValue(field, file.name);
                    }
                  })
                  .catch((error: unknown) => {
                    console.error("Could not select the settings file", error);
                  });
              }}
            >
              <Icon name="image" size={16} />
              {textValue ? t("settings.control.file.replace") : t("settings.control.file.choose")}
            </Button>
            {textValue && (
              <IconButton
                icon="trash"
                label={t("common.action.clear")}
                disabled={!enabled}
                onClick={() => onCommitValue(field, "")}
              />
            )}
          </span>
        </span>
      );
    }
    default:
      return null;
  }
}
