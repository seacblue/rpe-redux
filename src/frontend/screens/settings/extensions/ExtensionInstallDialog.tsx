/**
 * The confirmation surface for installing an Extension from GitHub.
 *
 * Resolving a link only reads files. The dialog shows the package name, author,
 * description, version, engine range, capabilities, and file list. The review
 * also lists every declared capability with its own consent checkbox; the
 * install button stays disabled until all of them are confirmed, and it then
 * consents to those exact bytes and enables the package live.
 */
import { useEffect, useId, useState } from "react";
import { Button } from "../../../../design/components/button/Button.tsx";
import { Input } from "../../../../design/components/input/Input.tsx";
import { Modal } from "../../../../design/components/modal/Modal.tsx";
import { FieldRow } from "../../../../design/components/field/FieldRow.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import type { MessageKey } from "../../../../i18n/index.ts";
import type { ExtensionCapability } from "../../../../core/extensions/capabilities.ts";
import { consentRowsFor } from "../../../../core/extensions/capabilityCatalog.ts";
import type { ExtensionMethodRisk } from "../../../../core/extensions/methodRegistry.ts";
import {
  asExtensionInstallFailure,
  manifestEngineRequirement,
  type ExtensionInstallFailure,
} from "../../../../core/extensions/install.ts";
import {
  installResolvedExtension,
  manifestDescription,
  resolveGitHubExtension,
  type ResolvedExtensionPackage,
} from "../../../platform/extensionInstaller.ts";
import { requestConfirm } from "../../../overlays/modals/prompts.ts";
import { ExtensionInstallError } from "./ExtensionInstallError.tsx";
import {
  consentDecision,
  consentGroups,
  defaultConsentSelection,
  sensitiveCapabilities,
  type ConsentDecision,
} from "./capabilityConsent.ts";

/** Localized headings and badges for the three consent risk tiers. */
const CONSENT_RISK_LABEL: Record<ExtensionMethodRisk, MessageKey> = {
  read: "settings.extensions.consent.groups.read",
  write: "settings.extensions.consent.groups.write",
  sensitive: "settings.extensions.consent.groups.sensitive",
};

/** Inputs for the GitHub install dialog, including marketplace fallbacks. */
export interface ExtensionInstallDialogProps {
  /** Pre-filled GitHub link, used by a marketplace entry. */
  initialSource?: string;
  /** Catalog author shown when the manifest omits one. */
  fallbackAuthor?: string;
  /** Catalog description shown when the manifest omits one. */
  fallbackDescription?: string;
  onClose(): void;
  onInstalled?(id: string): void;
}

/**
 * The GitHub install and consent dialog.
 *
 * The parent mounts this component only while the dialog is open, so each open
 * starts from the source it was given without a reset effect.
 */
export function ExtensionInstallDialog({
  initialSource = "",
  fallbackAuthor,
  fallbackDescription,
  onClose,
  onInstalled,
}: ExtensionInstallDialogProps) {
  const { t, tRaw } = useTranslation();
  const inputId = useId();
  const [source, setSource] = useState(initialSource);
  const [resolved, setResolved] = useState<ResolvedExtensionPackage | null>(null);
  const [failure, setFailure] = useState<ExtensionInstallFailure | null>(null);
  const [busy, setBusy] = useState<"resolve" | "install" | null>(null);
  const [installedId, setInstalledId] = useState<string | null>(null);
  const [installedEnabled, setInstalledEnabled] = useState(true);
  const [autoResolving, setAutoResolving] = useState(initialSource.trim().length > 0);
  const [consentSelection, setConsentSelection] = useState<ReadonlySet<ExtensionCapability>>(
    () => new Set(),
  );
  const resolving = busy === "resolve" || autoResolving;
  const declaredCapabilities = resolved?.manifest.capabilities ?? [];
  const consent = consentDecision(declaredCapabilities, consentSelection);
  const sensitive = new Set(sensitiveCapabilities(declaredCapabilities));

  // Resolve a pre-filled marketplace source once when the dialog opens.
  useEffect(() => {
    if (!initialSource.trim()) {
      return;
    }
    let active = true;
    void resolveGitHubExtension(initialSource).then(
      (next) => {
        if (active) {
          setResolved(next);
          setConsentSelection(defaultConsentSelection(next.manifest.capabilities ?? []));
          setAutoResolving(false);
        }
      },
      (error: unknown) => {
        if (active) {
          setFailure(
            asExtensionInstallFailure(error, {
              code: "unknown",
              phase: "resolve",
              source: initialSource,
              message: "Unable to resolve the Extension repository.",
            }),
          );
          setAutoResolving(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [initialSource]);

  /** Read the repository and show the package for review. */
  const inspect = async () => {
    setBusy("resolve");
    setFailure(null);
    setResolved(null);
    setConsentSelection(new Set());
    try {
      const next = await resolveGitHubExtension(source);
      setResolved(next);
      setConsentSelection(defaultConsentSelection(next.manifest.capabilities ?? []));
    } catch (error) {
      setFailure(
        asExtensionInstallFailure(error, {
          code: "unknown",
          phase: "resolve",
          source,
          message: "Unable to resolve the Extension repository.",
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  /**
   * Toggle one consent row. A sensitive capability asks for a second
   * confirmation before it can be checked; declining leaves the row off.
   */
  const toggleConsent = async (capability: ExtensionCapability, checked: boolean) => {
    if (checked && sensitive.has(capability)) {
      const row = consentRowsFor([capability])[0];
      const accepted = await requestConfirm({
        title: t("settings.extensions.consent.sensitiveConfirm.title"),
        description: t("settings.extensions.consent.sensitiveConfirm.description", {
          capability: row ? tRaw(row.labelKey) : capability,
        }),
        detail: t("settings.extensions.consent.sensitiveConfirm.detail"),
        label: t("settings.extensions.consent.sensitiveConfirm.confirm"),
        cancelLabel: t("settings.extensions.consent.sensitiveConfirm.cancel"),
      });
      if (!accepted) {
        return;
      }
    }
    setConsentSelection((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(capability);
      } else {
        next.delete(capability);
      }
      return next;
    });
  };

  /** Install the reviewed package and report the installed id. */
  const install = async () => {
    if (!resolved || !consent.ok) {
      return;
    }
    setBusy("install");
    setFailure(null);
    try {
      const result = await installResolvedExtension(resolved);
      setInstalledEnabled(result.enabled);
      setInstalledId(resolved.manifest.id);
      onInstalled?.(resolved.manifest.id);
    } catch (error) {
      setFailure(
        asExtensionInstallFailure(error, {
          code: "unknown",
          phase: "load",
          source: resolved.source.canonicalUrl,
          message: "Unable to install the Extension.",
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  const title = installedId
    ? t("settings.extensions.install.successTitle")
    : resolved
      ? t("settings.extensions.install.reviewTitle", { name: resolved.manifest.name })
      : t("settings.extensions.install.title");

  const description = installedId
    ? t(
        installedEnabled
          ? "settings.extensions.install.success"
          : "settings.extensions.install.successDisabled",
        { id: installedId },
      )
    : resolved
      ? t("settings.extensions.install.reviewDescription")
      : t("settings.extensions.install.description");

  const actions = installedId ? (
    <Button variant="solid" onClick={onClose}>
      {t("common.action.close")}
    </Button>
  ) : resolved ? (
    <>
      <Button
        variant="outlined"
        disabled={busy !== null}
        onClick={() => {
          setFailure(null);
          setResolved(null);
          setConsentSelection(new Set());
        }}
      >
        {t("settings.extensions.install.back")}
      </Button>
      <Button
        variant="solid"
        disabled={busy !== null || !consent.ok}
        onClick={() => void install()}
      >
        {busy === "install"
          ? t("settings.extensions.install.installing")
          : t("settings.extensions.install.confirm")}
      </Button>
    </>
  ) : (
    <>
      <Button variant="outlined" disabled={busy !== null} onClick={onClose}>
        {t("common.action.cancel")}
      </Button>
      <Button
        variant="solid"
        disabled={busy !== null || autoResolving || !source.trim()}
        onClick={() => void inspect()}
      >
        {resolving
          ? t("settings.extensions.install.inspecting")
          : t("settings.extensions.install.inspect")}
      </Button>
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      onCancel={(event) => {
        if (busy !== null) {
          event.preventDefault();
        }
      }}
      label={title}
      description={description}
      closeButton={busy === null}
      className="redux-extension-install-dialog"
      actions={actions}
    >
      {installedId ? (
        <p className="redux-extension-install-success">
          {t("settings.extensions.install.successHint")}
        </p>
      ) : resolved ? (
        <ExtensionReview
          resolved={resolved}
          fallbackAuthor={source === initialSource ? fallbackAuthor : undefined}
          fallbackDescription={source === initialSource ? fallbackDescription : undefined}
          consent={consent}
          selection={consentSelection}
          onConsentToggle={(capability, checked) => void toggleConsent(capability, checked)}
        />
      ) : (
        <div className="redux-extension-install-form">
          <FieldRow
            layout="inline"
            htmlFor={inputId}
            label={t("settings.extensions.install.source")}
            description={t("settings.extensions.install.sourceDescription")}
            control={
              <Input
                id={inputId}
                type="text"
                value={source}
                placeholder={t("settings.extensions.install.sourcePlaceholder")}
                autoComplete="off"
                spellCheck={false}
                disabled={busy !== null || autoResolving}
                onChange={(event) => setSource(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && source.trim() && busy === null) {
                    event.preventDefault();
                    void inspect();
                  }
                }}
              />
            }
          />
          {failure && <ExtensionInstallError failure={failure} />}
        </div>
      )}
      {resolved && failure && <ExtensionInstallError failure={failure} />}
    </Modal>
  );
}

/** Review of the exact package bytes about to be installed. */
function ExtensionReview({
  resolved,
  fallbackAuthor,
  fallbackDescription,
  consent,
  selection,
  onConsentToggle,
}: {
  resolved: ResolvedExtensionPackage;
  fallbackAuthor?: string;
  fallbackDescription?: string;
  consent: ConsentDecision;
  selection: ReadonlySet<ExtensionCapability>;
  onConsentToggle(capability: ExtensionCapability, checked: boolean): void;
}) {
  const { t, tRaw } = useTranslation();
  const manifest = resolved.manifest;
  const description = manifestDescription(manifest) || fallbackDescription;
  return (
    <div className="redux-extension-install-review">
      <div className="redux-extension-install-heading">
        <div>
          <h3>{manifest.name}</h3>
          <p className="redux-extension-install-author">
            {manifest.author ?? fallbackAuthor ?? t("settings.extensions.install.unknownAuthor")}
          </p>
        </div>
        <span className="redux-extension-install-version">{manifest.version}</span>
      </div>
      <p className="redux-extension-install-description">
        {description || t("settings.extensions.install.noDescription")}
      </p>
      <dl className="redux-extension-install-facts">
        <dt>{t("settings.extensions.install.id")}</dt>
        <dd>
          <code>{manifest.id}</code>
        </dd>
        <dt>{t("settings.extensions.install.engine")}</dt>
        <dd>
          <code>
            {manifestEngineRequirement(manifest) || t("settings.extensions.install.engineMissing")}
          </code>
        </dd>
        <dt>{t("settings.extensions.install.repository")}</dt>
        <dd className="redux-extension-error-source">{resolved.source.canonicalUrl}</dd>
        <dt>{t("settings.extensions.install.commit")}</dt>
        <dd>
          <code>{resolved.commit.slice(0, 12)}</code>
        </dd>
        <dt>{t("settings.extensions.install.content")}</dt>
        <dd>
          {resolved.entryPath === null
            ? t("settings.extensions.dataOnly.label")
            : t("settings.extensions.install.codeContent")}
        </dd>
      </dl>
      <div className="redux-extension-capabilities">
        <span className="redux-extension-capability">
          {t("settings.extensions.install.files", { count: resolved.files.length })}
        </span>
        {(manifest.capabilities ?? []).map((capability) => (
          <span className="redux-extension-capability" key={capability}>
            {capability}
          </span>
        ))}
      </div>
      <ExtensionConsent
        capabilities={manifest.capabilities ?? []}
        selection={selection}
        missing={consent.missing}
        onToggle={onConsentToggle}
      />
      <ul className="redux-extension-install-files">
        {resolved.files.map((file) => (
          <li key={file.path}>
            <code>{file.path}</code>
            <span>
              {t("settings.extensions.install.bytes", {
                count: new TextEncoder().encode(file.text).byteLength,
              })}
            </span>
          </li>
        ))}
      </ul>
      <p className="redux-extension-install-risk">
        {t("settings.extensions.install.risk", { notice: tRaw("settings.extensions.risk") })}
      </p>
    </div>
  );
}

/**
 * The per-capability consent gate inside the install review.
 *
 * Every declared capability gets one checkbox with its catalog label and
 * description. Read rows start checked; write and sensitive rows start
 * unchecked. The missing hint names whatever remains, and a sensitive row only
 * becomes checkable after the caller's confirmation prompt is accepted.
 */
function ExtensionConsent({
  capabilities,
  selection,
  missing,
  onToggle,
}: {
  capabilities: readonly ExtensionCapability[];
  selection: ReadonlySet<ExtensionCapability>;
  missing: readonly ExtensionCapability[];
  onToggle(capability: ExtensionCapability, checked: boolean): void;
}) {
  const { t, tRaw } = useTranslation();
  const headingId = useId();
  const groups = consentGroups(capabilities);
  const missingLabels = consentRowsFor(missing).map((row) => tRaw(row.labelKey));
  return (
    <section className="redux-extension-consent" aria-labelledby={headingId}>
      <h4 id={headingId} className="redux-extension-consent-title">
        {t("settings.extensions.consent.title")}
      </h4>
      <p className="redux-extension-consent-description">
        {groups.length > 0
          ? t("settings.extensions.consent.description")
          : t("settings.extensions.consent.empty")}
      </p>
      {groups.map((group) => (
        <div className="redux-extension-consent-group" key={group.risk}>
          <h5>{t(CONSENT_RISK_LABEL[group.risk])}</h5>
          <ul className="redux-extension-consent-rows">
            {group.rows.map((row) => (
              <li className="redux-extension-consent-row" data-risk={row.risk} key={row.capability}>
                <label className="redux-extension-consent-check">
                  <input
                    type="checkbox"
                    checked={selection.has(row.capability)}
                    onChange={(event) => onToggle(row.capability, event.currentTarget.checked)}
                  />
                  <span className="redux-extension-consent-copy">
                    <span className="redux-extension-consent-label">{tRaw(row.labelKey)}</span>
                    <span className="redux-extension-consent-hint">{tRaw(row.descriptionKey)}</span>
                  </span>
                </label>
                <span className="redux-extension-consent-badge" data-risk={row.risk}>
                  {t(CONSENT_RISK_LABEL[row.risk])}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {missing.length > 0 && (
        <p className="redux-extension-consent-required" role="status">
          {t("settings.extensions.consent.required")} {missingLabels.join(", ")}
        </p>
      )}
    </section>
  );
}
