/** The script inspector: one compact search surface over enabled extensions. */
import { Fragment, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { resolveExtensionText } from "../../../../../core/extensions/i18n.ts";
import {
  scriptRegistry,
  type ExtensionScriptSnapshot,
} from "../../../../../core/extensions/scripts.ts";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { IconButton } from "../../../../../design/components/button/IconButton.tsx";
import { Divider } from "../../../../../design/components/divider/Divider.tsx";
import { EmptyState } from "../../../../../design/components/empty-state/EmptyState.tsx";
import { SearchField } from "../../../../../design/components/input/SearchField.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { ListRow } from "../../../../../design/components/list/ListRow.tsx";
import { useAnchoredPopover } from "../../../../../design/patterns/useAnchoredPopover.ts";
import { useAppRootHost } from "../../../../../design/patterns/portalHost.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import { openSettings } from "../../../settings/settingsWindowController.ts";
import { rememberedOrDefaultParameterValues, requestParameterValues } from "./ParameterForm.tsx";

/** Localized extension name, falling back to the owner id. */
function sourceName(script: ExtensionScriptSnapshot): string {
  return (
    resolveExtensionText(script.owner, script.manifest.translations, { key: "name" }) ||
    script.owner
  );
}

/** The registry key is `owner:scriptId`; parameter memory is keyed by the bare id. */
function definitionId(script: ExtensionScriptSnapshot): string {
  const prefix = `${script.owner}:`;
  return script.id.startsWith(prefix) ? script.id.slice(prefix.length) : script.id;
}

/** One enabled Extension script row and its parameter collection action. */
function ScriptRow({ script }: { script: ExtensionScriptSnapshot }) {
  const { t, tRaw } = useTranslation();
  const run = async () => {
    const schema = script.parameters;
    if (!schema) {
      void scriptRegistry.run(script.id);
      return;
    }
    const scriptId = definitionId(script);
    const valuesToRun = await requestParameterValues({
      owner: script.owner,
      scriptId,
      schema,
      translations: script.manifest.translations,
      initialValues: rememberedOrDefaultParameterValues(script.owner, scriptId, schema),
      title: t("workspace.scripts.parameters.title", { script: tRaw(script.label) }),
    });
    if (valuesToRun) {
      void scriptRegistry.run(script.id, valuesToRun);
    }
  };
  return (
    <ListRow as="div" className="redux-script-row">
      <div className="redux-script-main">
        <strong className="redux-script-title">{tRaw(script.label)}</strong>
        <small className="redux-script-source">
          {t("workspace.scripts.source", { source: sourceName(script) })}
        </small>
      </div>
      <IconButton
        className="redux-script-run"
        icon="paperPlane"
        size="md"
        variant="plain"
        label={t("workspace.scripts.run")}
        onClick={() => void run()}
      />
    </ListRow>
  );
}

/** Lists only scripts contributed by currently enabled Extensions. */
export function ScriptsPanel() {
  const { t, tRaw } = useTranslation();
  const [query, setQuery] = useState("");
  const scripts = useSyncExternalStore(
    scriptRegistry.subscribe,
    scriptRegistry.listRecentFirst,
    scriptRegistry.listRecentFirst,
  );
  const [hiddenOwners, setHiddenOwners] = useState<ReadonlySet<string>>(() => new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const filterAnchor = useRef<HTMLButtonElement>(null);
  const filterPanelRef = useRef<HTMLElement>(null);
  const filterHost = useAppRootHost();
  const filterPopover = useAnchoredPopover({
    open: filterOpen,
    anchor: filterAnchor,
    panel: filterPanelRef,
    onClose: () => setFilterOpen(false),
    align: "end",
    gap: 6,
    maxHeight: 480,
  });
  const sourceFilters = useMemo(() => {
    const byOwner = new Map<string, { label: string; count: number }>();
    for (const script of scripts) {
      const current = byOwner.get(script.owner);
      if (current) {
        current.count += 1;
      } else {
        byOwner.set(script.owner, { label: sourceName(script), count: 1 });
      }
    }
    return [...byOwner.entries()]
      .map(([owner, value]) => ({ owner, ...value }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [scripts]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleScripts = useMemo(
    () =>
      scripts.filter((script) => {
        if (hiddenOwners.has(script.owner)) {
          return false;
        }
        const label = tRaw(script.label);
        const description = script.description ? tRaw(script.description) : "";
        return (
          !normalizedQuery ||
          `${label} ${description}`.toLocaleLowerCase().includes(normalizedQuery)
        );
      }),
    [hiddenOwners, normalizedQuery, scripts, tRaw],
  );
  const filterActive = sourceFilters.some((source) => hiddenOwners.has(source.owner));
  const toggleOwner = (owner: string) => {
    setHiddenOwners((previous) => {
      const next = new Set(previous);
      if (next.has(owner)) {
        next.delete(owner);
      } else {
        next.add(owner);
      }
      return next;
    });
  };
  const filterPanel = (
    <section
      ref={filterPanelRef}
      className={`inspector-filter-popover${filterOpen ? " is-open" : ""}`}
      role="dialog"
      aria-label={t("workspace.scripts.studio.filter.label")}
      aria-hidden={!filterOpen}
      inert={!filterOpen}
      data-placement={filterPopover.side}
      style={filterPopover.style}
    >
      <div className="inspector-filter-list">
        {sourceFilters.map((source) => {
          const rowId = `script-filter-${source.owner}`;
          return (
            <label className="inspector-filter-row" htmlFor={rowId} key={source.owner}>
              <span className="inspector-filter-label">
                {source.label}
                <span className="inspector-filter-count">{source.count}</span>
              </span>
              <Input
                id={rowId}
                type="checkbox"
                checked={!hiddenOwners.has(source.owner)}
                aria-label={source.label}
                onChange={() => toggleOwner(source.owner)}
              />
            </label>
          );
        })}
      </div>
    </section>
  );

  return (
    <section className="redux-scripts-panel">
      <div className="redux-script-toolbar">
        <SearchField
          className="redux-script-studio-search"
          value={query}
          placeholder={t("workspace.scripts.studio.searchPlaceholder")}
          label={t("workspace.scripts.studio.searchPlaceholder")}
          onChange={setQuery}
        />
        {sourceFilters.length > 0 && (
          <div className="redux-script-filter">
            <IconButton
              ref={filterAnchor}
              icon="filter"
              size="md"
              label={t("workspace.scripts.studio.filter.label")}
              active={filterOpen || filterActive}
              aria-haspopup="dialog"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((value) => !value)}
            />
            {filterHost ? createPortal(filterPanel, filterHost) : filterPanel}
          </div>
        )}
      </div>
      {visibleScripts.length > 0 ? (
        <div className="redux-script-list">
          {visibleScripts.map((script, index) => (
            <Fragment key={script.id}>
              {index > 0 && <Divider axis="x" />}
              <ScriptRow script={script} />
            </Fragment>
          ))}
        </div>
      ) : (
        <div className="redux-scripts-empty">
          {scripts.length === 0 ? (
            <EmptyState
              icon="extension"
              title={t("editorPanels.scripts.emptyTitle")}
              description={t("editorPanels.scripts.empty")}
              actions={
                <Button variant="outlined" onClick={() => openSettings("extensions")}>
                  {t("editorPanels.scripts.openSettings")}
                </Button>
              }
            />
          ) : filterActive && !normalizedQuery ? (
            <EmptyState
              icon="filter"
              title={t("workspace.scripts.studio.filter.emptyTitle")}
              description={t("workspace.scripts.studio.filter.empty")}
            />
          ) : (
            <EmptyState
              icon="search"
              title={t("workspace.scripts.studio.noMatch")}
              description={t("workspace.scripts.studio.searchPlaceholder")}
            />
          )}
        </div>
      )}
    </section>
  );
}
