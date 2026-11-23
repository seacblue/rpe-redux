/**
 * The toolbar's Extension picker.
 *
 * It remembers the chosen script and its parameter values, runs the script through
 * the Extension runtime, and shows its state in the button.
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { SplitAction } from "../../../../design/components/splitAction/SplitAction.tsx";
import { ListRow } from "../../../../design/components/list/ListRow.tsx";
import { useListbox } from "../../../../design/patterns/list/useListbox.ts";
import { useAnchoredPopover } from "../../../../design/patterns/useAnchoredPopover.ts";
import { useTranslation } from "../../../../i18n/react.ts";
import {
  scriptRegistry,
  type ExtensionScriptSnapshot,
} from "../../../../core/extensions/scripts.ts";
import { PREFERENCE_SECTIONS, preferences } from "../../../../core/state/preferences.ts";
import {
  rememberedOrDefaultParameterValues,
  requestParameterValues,
} from "../inspector/scripts/ParameterForm.tsx";

const TOOLBAR_EXTENSION_KEY = "toolbar.extension";

/** The script id last chosen from the toolbar, or null. */
function rememberedExtension(): string | null {
  const values = preferences.read<unknown>(PREFERENCE_SECTIONS.values, null);
  return values &&
    typeof values === "object" &&
    typeof (values as Record<string, unknown>)[TOOLBAR_EXTENSION_KEY] === "string"
    ? ((values as Record<string, unknown>)[TOOLBAR_EXTENSION_KEY] as string)
    : null;
}

/** Persist the toolbar picker's script id in the values preference section. */
function rememberExtension(id: string): void {
  const values = preferences.read<unknown>(PREFERENCE_SECTIONS.values, null);
  preferences.write(PREFERENCE_SECTIONS.values, {
    ...(values && typeof values === "object" ? values : {}),
    [TOOLBAR_EXTENSION_KEY]: id,
  });
}

/** Strip the owner prefix so a script id matches the parameter form's ids. */
function definitionId(script: ExtensionScriptSnapshot): string {
  const prefix = `${script.owner}:`;
  return script.id.startsWith(prefix) ? script.id.slice(prefix.length) : script.id;
}

/** Scroll a script name only when it overflows its toolbar slot. */
function MarqueeName({ text }: { text: string }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) {
        return;
      }
      setDistance(Math.max(0, inner.current.scrollWidth - outer.current.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (outer.current) {
      observer.observe(outer.current);
    }
    if (inner.current) {
      observer.observe(inner.current);
    }
    return () => observer.disconnect();
  }, [text]);
  const style =
    distance > 0
      ? ({
          "--extension-marquee-distance": `${distance}px`,
          "--extension-marquee-duration": `${Math.max(2.4, distance / 28)}s`,
        } as CSSProperties)
      : undefined;
  return (
    <span
      ref={outer}
      className={`redux-extension-picker-name${distance > 0 ? " is-overflowing" : ""}`}
      style={style}
    >
      <span ref={inner}>{text}</span>
    </span>
  );
}

/** Run a script directly, or after its parameter form resolves values. */
function execute(
  script: ExtensionScriptSnapshot,
  label: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (!script.parameters) {
    void scriptRegistry.run(script.id);
    return;
  }
  const scriptId = definitionId(script);
  void requestParameterValues({
    owner: script.owner,
    scriptId,
    schema: script.parameters,
    translations: script.manifest.translations,
    initialValues: rememberedOrDefaultParameterValues(script.owner, scriptId, script.parameters),
    title: t("workspace.scripts.parameters.title", { script: label }),
  }).then((values) => {
    if (values) {
      void scriptRegistry.run(script.id, values);
    }
  });
}

/** Toolbar entry for enabled Extensions whose scripts edit the current selection. */
export function ExtensionPicker() {
  const { t, tRaw } = useTranslation();
  const scripts = useSyncExternalStore(
    scriptRegistry.subscribe,
    scriptRegistry.list,
    scriptRegistry.list,
  );
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(rememberedExtension);
  const anchor = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const popover = useAnchoredPopover({
    open,
    anchor,
    panel,
    onClose: () => setOpen(false),
    gap: 4,
    matchAnchorWidth: true,
    focusTarget: toggle,
    closeOnScroll: true,
  });
  const actions = scripts
    .filter((script) => script.manifest.capabilities?.includes("chart.write") === true)
    .map((script) => ({ script, label: tRaw(script.label) }));
  const selected = actions.find((action) => action.script.id === selectedId) ?? actions[0] ?? null;
  const listbox = useListbox({
    count: actions.length,
    selected: selected ? actions.indexOf(selected) : -1,
    onSelect: (index) => {
      const action = actions[index];
      if (!action) {
        return;
      }
      setSelectedId(action.script.id);
      rememberExtension(action.script.id);
      setOpen(false);
      execute(action.script, action.label, t);
    },
    idPrefix: "extension-picker-option",
  });

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    panel.current?.focus();
  }, [open]);

  return (
    <>
      <SplitAction
        ref={anchor}
        className="redux-extension-picker"
        label={
          <>
            {selected?.script.parameters && (
              <span className="redux-extension-picker-required" aria-hidden="true">
                *
              </span>
            )}
            {selected ? (
              <MarqueeName text={selected.label} />
            ) : (
              <span className="redux-extension-picker-name">{t("chrome.toolbar.extensions")}</span>
            )}
          </>
        }
        ariaLabel={t("chrome.toolbar.extensions")}
        actionId="extension-picker-run"
        toggleId="extension-picker-toggle"
        popupId="extension-picker-list"
        actionData={{ "data-script": selected?.script.id }}
        toggleRef={toggle}
        actionDisabled={!selected}
        open={open}
        onAction={() => {
          if (!selected) {
            return;
          }
          setOpen(false);
          execute(selected.script, selected.label, t);
        }}
        onToggle={() => setOpen((current) => !current)}
      />
      {open &&
        createPortal(
          <div
            ref={panel}
            id="extension-picker-list"
            className="redux-extension-picker-popup"
            role="listbox"
            aria-label={t("chrome.toolbar.extensions")}
            data-placement={popover.side}
            style={popover.style}
            {...listbox.listProps}
          >
            {actions.length === 0 ? (
              <p className="redux-extension-picker-empty">{t("chrome.toolbar.extensionsEmpty")}</p>
            ) : (
              actions.map(({ script, label }, index) => (
                <ListRow
                  as="button"
                  type="button"
                  key={script.id}
                  selected={script.id === selected?.script.id}
                  className="redux-extension-picker-option"
                  data-script={script.id}
                  data-requires-parameters={script.parameters ? "true" : undefined}
                  {...listbox.optionProps(index)}
                >
                  {script.parameters && (
                    <span className="redux-extension-picker-required" aria-hidden="true">
                      *
                    </span>
                  )}
                  <MarqueeName text={label} />
                </ListRow>
              ))
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
