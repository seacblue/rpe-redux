/**
 * The installed-Extension list on the Extensions page.
 *
 * Each row owns its own review, acknowledgement, and operations. A package is
 * never enabled through a page-wide checkbox: the user must expand that row,
 * inspect the files and declared capabilities, and accept those exact bytes.
 */
import {
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  extensionRuntime,
  type ExtensionOperationResult,
  type ExtensionStatusSnapshot,
} from "../../../../core/extensions/extensionRuntime.ts";
import { resolveExtensionText } from "../../../../core/extensions/i18n.ts";
import { Button } from "../../../../design/components/button/Button.tsx";
import { Card } from "../../../../design/components/card/Card.tsx";
import { InlineAlert } from "../../../../design/components/alert/InlineAlert.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import type { MessageKey, MessageParams } from "../../../../i18n/index.ts";
import { Confirm } from "../../../../design/components/confirm/Confirm.tsx";
import { isExtensionInstallFailure } from "../../../../core/extensions/install.ts";
import { removeInstalledExtension } from "../../../platform/extensionInstaller.ts";
import {
  reloadPackagedExtension,
  removePackagedExtension,
} from "../../../platform/extensionLoader.ts";
import { installFailureMessage } from "./ExtensionInstallError.tsx";
import { useSetting } from "../useSetting.ts";

/** Translate one structured operation failure into its user-facing reason. */
export function operationErrorMessage(
  result: Extract<ExtensionOperationResult, { ok: false }>,
  translate: (key: MessageKey, params?: MessageParams) => string,
): string {
  const code: string | undefined = result.code;
  switch (code) {
    case "riskNotAcknowledged":
      return translate("settings.extensions.risk");
    case "dependencyMissing":
      return translate("settings.extensions.error.dependencyMissing");
    case "dependencyDisabled":
      return translate("settings.extensions.error.dependencyDisabled");
    case "dependencyCycle":
      return translate("settings.extensions.error.dependencyCycle", { value: result.value ?? "?" });
    case "conflictEnabled":
      return translate("settings.extensions.error.conflictEnabled", { value: result.value ?? "?" });
    case "dependentEnabled":
      return translate("settings.extensions.error.dependentEnabled", {
        value: result.value ?? "?",
      });
    case "entryLoadRequired":
      return translate("settings.extensions.error.entryActivateRequired");
    case "capabilityDenied":
      return translate("settings.extensions.error.capabilityDenied");
    case "invalidCapabilities":
      return translate("settings.extensions.error.invalidCapabilities");
    case "invalidCollaboration":
      return translate("settings.extensions.error.invalidCollaboration");
    default:
      return result.reason || translate("settings.extensions.error.unknown");
  }
}

/** The translated display name from the package manifest. */
function extensionName(extension: ExtensionStatusSnapshot): string {
  return resolveExtensionText(extension.manifest.id, extension.manifest.translations, {
    key: "name",
  });
}

/** The translated manifest description. */
function extensionDescription(extension: ExtensionStatusSnapshot): string {
  return resolveExtensionText(extension.manifest.id, extension.manifest.translations, {
    key: "description",
  });
}

/** The source label with its optional catalog name appended. */
function sourceText(extension: ExtensionStatusSnapshot): string {
  return extension.sourceLabel ? `${extension.source}, ${extension.sourceLabel}` : extension.source;
}

/** Folder-backed packages can be re-read from disk without a page reload. */
function canReloadPackage(extension: ExtensionStatusSnapshot): boolean {
  return (
    extension.source === "source" ||
    extension.source === "resource" ||
    extension.source === "portable" ||
    extension.source === "installed"
  );
}

/** The installed-extension list with per-row enable, remove, and reorder controls. */
export function ExtensionListView() {
  const { t } = useTranslation();
  const extensions = useSyncExternalStore(
    (listener) => extensionRuntime.subscribe(listener),
    () => extensionRuntime.list(),
    () => extensionRuntime.list(),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<ExtensionStatusSnapshot | null>(null);
  const [error, setError] = useState("");
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const disclaimerAccepted = useSetting("extensions-disclaimer-accepted", false);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const sourceOrder = extensions.map((extension) => extension.manifest.id);
  const order = draftOrder ?? sourceOrder;
  const byId = new Map(extensions.map((extension) => [extension.manifest.id, extension]));
  const orderedExtensions = order.flatMap((id) => byId.get(id) ?? []);

  /** Commit a new order and clear the drag preview state. */
  const persistOrder = (ids: readonly string[]) => {
    extensionRuntime.setOrder(ids);
    setDraftOrder(null);
    setDraggingId(null);
  };

  /** Move one card by one position for keyboard reordering. */
  const moveWithKeyboard = (id: string, delta: number) => {
    const from = order.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) {
      return;
    }
    const next = order.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    persistOrder(next);
  };

  /** Track a pointer drag and publish the order as the card crosses its neighbours. */
  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    const current = order.slice();
    const from = current.indexOf(id);
    if (from < 0) {
      return;
    }
    setDraggingId(id);
    setDraftOrder(current);
    /** Insert the dragged card before the first row it crosses. */
    const move = (moveEvent: PointerEvent) => {
      let target = current.length;
      for (let index = 0; index < current.length; index += 1) {
        const card = cardRefs.current.get(current[index]);
        if (!card) {
          continue;
        }
        const rect = card.getBoundingClientRect();
        if (moveEvent.clientY < rect.top + rect.height / 2) {
          target = index;
          break;
        }
      }
      const currentIndex = current.indexOf(id);
      const insert = currentIndex < target ? target - 1 : target;
      if (currentIndex < 0 || insert === currentIndex) {
        return;
      }
      current.splice(insert, 0, current.splice(currentIndex, 1)[0]);
      // Publish each reordered sequence during the drag so every surface reads
      // the same order immediately.
      extensionRuntime.setOrder([...current]);
      setDraftOrder([...current]);
    };
    /** Stop tracking the pointer and commit the final order. */
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      persistOrder(current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  /** Run one row operation with a busy marker and a shared error line. */
  const run = async (
    extension: ExtensionStatusSnapshot,
    operation: () => Promise<ExtensionOperationResult | void> | ExtensionOperationResult | void,
  ) => {
    setBusyId(extension.manifest.id);
    setError("");
    try {
      const result = await operation();
      if (result && !result.ok) {
        setError(operationErrorMessage(result, t));
      }
    } catch (error) {
      setError(
        isExtensionInstallFailure(error)
          ? [installFailureMessage(error, t), error.detail].filter(Boolean).join(" ")
          : error instanceof Error
            ? error.message
            : String(error),
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="redux-extension-list">
      {extensions.length === 0 ? (
        <p className="redux-setting-description">{t("settings.extensions.empty")}</p>
      ) : (
        orderedExtensions.map((extension) => {
          const id = extension.manifest.id;
          return (
            <Card
              as="article"
              tone="raised"
              className={`redux-extension-card${draggingId === id ? " is-dragging" : ""}`}
              key={id}
              data-extension-id={id}
              ref={(node) => {
                if (node) {
                  cardRefs.current.set(id, node);
                } else {
                  cardRefs.current.delete(id);
                }
              }}
            >
              <header className="redux-extension-card-heading">
                <Button
                  type="button"
                  variant="plain"
                  className="redux-extension-drag-handle"
                  aria-label={t("settings.extensions.reorderHandle", {
                    name: extensionName(extension),
                  })}
                  data-tip-title={t("common.action.reorder")}
                  disabled={extensions.length < 2}
                  onPointerDown={(event) => beginDrag(event, id)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      moveWithKeyboard(id, -1);
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault();
                      moveWithKeyboard(id, 1);
                    }
                  }}
                >
                  <span className="redux-extension-drag-grip" aria-hidden="true" />
                </Button>
                <div className="redux-extension-card-copy">
                  <h3>{extensionName(extension)}</h3>
                  <p className="redux-extension-description">{extensionDescription(extension)}</p>
                  <p className="redux-setting-description">
                    {extension.content}, {sourceText(extension)}, {extension.manifest.version}
                  </p>
                </div>
                <div className="redux-extension-actions">
                  {canReloadPackage(extension) && (
                    <Button
                      variant="outlined"
                      disabled={busyId === id}
                      onClick={() =>
                        void run(extension, async () => {
                          await reloadPackagedExtension(id);
                        })
                      }
                    >
                      {t("settings.extensions.action.reload")}
                    </Button>
                  )}
                  {extension.status !== "enabled" && (
                    <Button
                      variant="danger"
                      disabled={busyId === id}
                      onClick={() => setPendingRemove(extension)}
                    >
                      {t("settings.extensions.action.remove")}
                    </Button>
                  )}
                  {extension.status === "enabled" ? (
                    <Button
                      variant="outlined"
                      disabled={busyId === id}
                      onClick={() => void run(extension, () => extensionRuntime.disable(id))}
                    >
                      {t("settings.extensions.action.disable")}
                    </Button>
                  ) : (
                    <Button
                      variant="solid"
                      disabled={
                        busyId === id || extension.trustState === "blocked" || !disclaimerAccepted
                      }
                      onClick={() => {
                        void run(extension, () => extensionRuntime.enableAsync(id, true));
                      }}
                    >
                      {t("settings.extensions.action.enable")}
                    </Button>
                  )}
                </div>
              </header>
              {extension.error && (
                <InlineAlert className="modal-error">
                  {t("settings.extensions.error.detail", { value: extension.error })}
                </InlineAlert>
              )}
            </Card>
          );
        })
      )}
      {error && <InlineAlert className="modal-error">{error}</InlineAlert>}
      <Confirm
        open={pendingRemove !== null}
        title={t("settings.extensions.remove.title")}
        description={
          pendingRemove
            ? t(
                pendingRemove.source === "installed"
                  ? "settings.extensions.remove.installedDescription"
                  : "settings.extensions.remove.description",
                { name: extensionName(pendingRemove) },
              )
            : undefined
        }
        confirmLabel={t("settings.extensions.action.remove")}
        cancelLabel={t("common.action.cancel")}
        destructive
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          const extension = pendingRemove;
          setPendingRemove(null);
          if (extension) {
            void run(extension, () =>
              extension.source === "installed"
                ? removeInstalledExtension(extension.manifest.id)
                : removePackagedExtension(extension.manifest.id),
            );
          }
        }}
      />
    </div>
  );
}
