/**
 * The single modal surface and its native `<dialog>` stack.
 *
 * Title/content/actions, focus trapping, Escape/scrim cancellation, stacking,
 * background inertness, and exit timing all live here. Callers render content;
 * this module owns the modality. The queued request host and the chart-loading
 * overlay are both just callers of this one surface. Caller tooltip text stays
 * on the annotated control as `data-tip-title`; a raw `title` is not forwarded to
 * the native `<dialog>`.
 *
 * Every dialog mounts into the app-root host registered by the entry point,
 * beside the app shell, rather than inside the component that opened it. A
 * dialog opened from Settings is therefore a peer of the Settings window, so it
 * sits above the shared scrim instead of being trapped inside the Settings
 * window's stacking context and blurred by it. The app root stays the mount
 * point because the design sheets scope native controls to that subtree.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { createValue } from "../../../core/state/values.ts";
import { MODAL_STACK_EVENT } from "../../../core/shell/shellEventNames.ts";
import { closeControlPopup, getPopup } from "../../controls/controlActions.ts";
import { useTranslation } from "../../../i18n/react.ts";
import { IconButton } from "../button/IconButton.tsx";

export interface ModalScrimSnapshot {
  state: "open" | "closing";
  /** Extra layer above the shared modal token; CSS owns the final z-index. */
  layer: number;
}
/** Compare two scrim snapshots so the store only publishes real changes. */
function sameScrim(a: ModalScrimSnapshot | null, b: ModalScrimSnapshot | null): boolean {
  return a?.state === b?.state && a?.layer === b?.layer;
}
const scrim = createValue<ModalScrimSnapshot | null>({ initial: null, equals: sameScrim });
/** The current modal scrim snapshot. */
export const getModalScrimSnapshot = scrim.get;
/** Subscribe to modal scrim changes. */
export const subscribeModalScrim = scrim.subscribe;
/** Publish a modal scrim snapshot. */
export const setModalScrimSnapshot = scrim.set;

interface ModalEntry {
  dialog: HTMLDialogElement;
  priority: number;
  sequence: number;
  restoreFocus: HTMLElement | null;
}
const stack: ModalEntry[] = [];
let nextSequence = 0;
const savedInert = new Map<HTMLElement, boolean>();
interface InstalledModal {
  close: (value?: string) => void;
  timer?: number;
  cleanup?: () => void;
}
const installed = new WeakMap<HTMLDialogElement, InstalledModal>();
/**
 * Callbacks that intercept a modal's own close paths. When one is set the
 * modal never closes itself; the surface owns its prompt and its own exit.
 */
const closeGuards = new WeakMap<HTMLDialogElement, () => Promise<boolean>>();
let returnFocus: HTMLElement | null = null;
let windowControls: HTMLElement | null = null;
/** The stack is plain bookkeeping; the stylesheet derives each dialog's z-index. */
function publishModalStack(): void {
  stack.forEach((entry, index) => {
    entry.dialog.style.setProperty("--modal-stack-layer", String(index));
  });
}

/** The topmost modal entry, which owns focus and cancellation. */
function activeEntry(): ModalEntry | undefined {
  return stack.at(-1);
}

/** The install state of a dialog, throwing if the dialog was never opened. */
function installedState(dialog: HTMLDialogElement): InstalledModal {
  const state = installed.get(dialog);
  if (!state) {
    throw new Error("Modal was used before installation");
  }
  return state;
}

let modalHost: HTMLElement | null = null;
/** The entry point registers the element that owns the shared modal layer. */
export function registerModalHost(element: HTMLElement | null): void {
  modalHost = element;
}

/** React registers the always-interactive desktop controls for modal policy. */
export function registerWindowControls(element: HTMLElement | null): void {
  windowControls = element;
  if (stack.length) {
    refreshModal();
  }
}

/** Restore every element the active modal made inert. */
function restoreInert() {
  for (const [element, inert] of savedInert) {
    element.inert = inert;
  }
  savedInert.clear();
}
/** Make everything but the active modal and desktop controls inert, then publish the stack. */
function refreshModal() {
  restoreInert();
  const active = activeEntry()?.dialog;
  if (!active) {
    setModalScrimSnapshot(null);
    window.dispatchEvent(new Event(MODAL_STACK_EVENT));
    if (returnFocus?.isConnected && !returnFocus.closest("[inert]")) {
      returnFocus.focus();
    }
    returnFocus = null;
    return;
  }
  const controls = windowControls;
  // The scrim, toast stack, and anchored confirmations belong to the overlay
  // layer rather than the page behind it, so they may not be made inert by a
  // modal.
  const block = (parent: Element) => {
    for (const node of parent.children) {
      if (
        !(node instanceof HTMLElement) ||
        node.matches(".redux-modal-scrim, .app-toasts, .redux-popconfirm")
      ) {
        continue;
      }
      if (node === active || node === controls) {
        continue;
      }
      if (node.contains(active) || (controls && node.contains(controls))) {
        block(node);
      } else {
        savedInert.set(node, node.inert);
        node.inert = true;
      }
    }
  };
  block(document.body);
  publishModalStack();
  setModalScrimSnapshot({
    state: "open",
    layer: stack.length - 1,
  });
  // A tooltip belongs to one layer. Tell the shared broker to drop the previous
  // anchor before focus moves into the newly active dialog; otherwise a tip for
  // the surface underneath can survive the layer change.
  window.dispatchEvent(new Event(MODAL_STACK_EVENT));
}
/** Ask a dialog to cancel; a prevented `cancel` event keeps it open. */
function requestCancel(dialog: HTMLDialogElement) {
  const event = new Event("cancel", { cancelable: true });
  if (dialog.dispatchEvent(event)) {
    dialog.close();
  }
}

/** Cancel the topmost modal, as the scrim and the global Escape policy do. */
export function requestActiveModalCancel(): void {
  const active = activeEntry()?.dialog;
  if (active) {
    requestCancel(active);
  }
}

/** Ask the innermost guarded modal to close before the host window closes. */
export async function requestActiveModalClose(): Promise<boolean> {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const entry = stack[index];
    if (!entry) {
      continue;
    }
    const guard = closeGuards.get(entry.dialog);
    if (!guard) {
      continue;
    }
    try {
      return await guard();
    } catch {
      // A failed save or a broken prompt must keep the window open.
      return false;
    }
  }
  return true;
}

/** Invoke a close guard without letting a rejection escape the modal shell. */
function requestGuardedClose(guard: () => Promise<boolean>): void {
  void guard().catch(() => undefined);
}

/** Snapshot query for app-level keyboard and menu policies. */
export function hasOpenModal(): boolean {
  return stack.length > 0;
}

/** Whether the active modal opts out of scrim-click dismissal. */
export function activeModalBlocksScrimDismiss(): boolean {
  const active = activeEntry();
  if (!active) {
    return false;
  }
  return (
    active.dialog.getAttribute("data-no-scrim-dismiss") === "true" || closeGuards.has(active.dialog)
  );
}

/** The keyboard context of the modal stack: open state and urgent priority. */
export function getModalShortcutContext(): { open: boolean; urgent: boolean } {
  return {
    open: stack.length > 0,
    urgent: stack.some((entry) => entry.dialog.getAttribute("role") === "alertdialog"),
  };
}
/** Complete an exit: drop the entry from the stack, restore focus, and refresh inertness. */
function finishClose(dialog: HTMLDialogElement, value?: string) {
  const state = installedState(dialog);
  clearTimeout(state.timer);
  state.timer = undefined;
  state.cleanup?.();
  state.cleanup = undefined;
  // The transparent closing state persists until the next open so the hidden
  // modal does not animate back to opaque during discrete display removal.
  state.close(value);
  const index = stack.findIndex((entry) => entry.dialog === dialog);
  const wasActive = index === stack.length - 1;
  const restoreFocus = index >= 0 ? stack[index].restoreFocus : null;
  if (index >= 0) {
    stack.splice(index, 1);
  }
  refreshModal();
  if (wasActive && restoreFocus?.isConnected && !restoreFocus.closest("[inert]")) {
    restoreFocus.focus();
  }
}
/** Detach a dialog from the stack and restore its native close method. */
export function disposeModal(dialog: HTMLDialogElement) {
  const state = installed.get(dialog);
  if (!state) {
    // Modal components are mounted before they are opened. Startup failure and
    // provider teardown can therefore unmount a valid, unopened modal.
    return;
  }
  clearTimeout(state.timer);
  state.cleanup?.();
  state.close();
  dialog.close = state.close;
  const index = stack.findIndex((entry) => entry.dialog === dialog);
  if (index >= 0) {
    stack.splice(index, 1);
  }
  installed.delete(dialog);
  refreshModal();
}

/** Keep modal-stack ownership tied to the React component that renders a modal. */
export function useModalCleanup(ref: RefObject<HTMLDialogElement | null>): void {
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog) {
        disposeModal(dialog);
      }
    };
  }, [ref]);
}

/** Start the exit transition, then finish the close once it ends or its timer elapses. */
function closeModal(dialog: HTMLDialogElement, value?: string) {
  if (!dialog.open || dialog.dataset.closing === "true") {
    return;
  }
  dialog.dataset.closing = "true";
  if (stack.length === 1) {
    setModalScrimSnapshot({ state: "closing", layer: 0 });
  }
  const state = installedState(dialog);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const configured = Number.parseFloat(
    getComputedStyle(dialog).getPropertyValue("--design-dur-exit"),
  );
  const duration = reduced ? 0 : Number.isFinite(configured) && configured > 0 ? configured : 160;
  const done = (event: TransitionEvent) => {
    if (event.target === dialog && event.propertyName === "opacity") {
      dialog.removeEventListener("transitionend", done);
      if (dialog.dataset.closing === "true") {
        finishClose(dialog, value);
      }
    }
  };
  dialog.addEventListener("transitionend", done);
  state.cleanup = () => dialog.removeEventListener("transitionend", done);
  state.timer = window.setTimeout(
    () => {
      dialog.removeEventListener("transitionend", done);
      finishClose(dialog, value);
    },
    duration ? duration + 80 : 0,
  );
}

/**
 * Place the modal's transform origin at the centre of the element that opened
 * it, clamped inside the modal box. The CSS vars are local to the dialog.
 */
function placeTransformOrigin(dialog: HTMLDialogElement, source: HTMLElement | null) {
  const rect = dialog.getBoundingClientRect();
  if (!source || rect.width <= 0 || rect.height <= 0) {
    dialog.style.removeProperty("--modal-origin-x");
    dialog.style.removeProperty("--modal-origin-y");
    return;
  }
  const anchor = source.getBoundingClientRect();
  if (anchor.width <= 0 || anchor.height <= 0) {
    dialog.style.removeProperty("--modal-origin-x");
    dialog.style.removeProperty("--modal-origin-y");
    return;
  }
  const x = Math.min(Math.max(anchor.left + anchor.width / 2 - rect.left, 12), rect.width - 12);
  const y = Math.min(Math.max(anchor.top + anchor.height / 2 - rect.top, 12), rect.height - 12);
  dialog.style.setProperty("--modal-origin-x", `${x}px`);
  dialog.style.setProperty("--modal-origin-y", `${y}px`);
}

/** Show a dialog, insert it into the stack, and move focus into it. */
export function openModal(dialog: HTMLDialogElement, priority = 0) {
  installListeners();
  if (!installed.has(dialog)) {
    installed.set(dialog, { close: dialog.close.bind(dialog) });
    dialog.close = (value?: string) => closeModal(dialog, value);
    dialog.addEventListener("submit", (event) => {
      const form = event.target;
      if (form instanceof HTMLFormElement && form.method === "dialog") {
        event.preventDefault();
        const submitter = (event as SubmitEvent).submitter;
        dialog.close(submitter instanceof HTMLButtonElement ? submitter.value : "");
      }
    });
  }
  const state = installed.get(dialog);
  if (!state) {
    return;
  }
  clearTimeout(state.timer);
  delete dialog.dataset.closing;
  state.cleanup?.();
  state.cleanup = undefined;
  dialog.dataset.reduxModal = "true";
  dialog.setAttribute("aria-modal", "true");
  const previous = stack.findIndex((entry) => entry.dialog === dialog);
  const oldEntry = previous >= 0 ? stack[previous] : undefined;
  if (!stack.length) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  if (previous >= 0) {
    stack.splice(previous, 1);
  }
  stack.push({
    dialog,
    priority,
    sequence: nextSequence++,
    restoreFocus:
      oldEntry?.restoreFocus ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  });
  // Ascending: `activeEntry` reads the last item, so higher priority and later
  // requests sit at the end of the stack and draw the highest z-index.
  stack.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
  if (!dialog.open) {
    dialog.show();
  }
  placeTransformOrigin(dialog, document.activeElement as HTMLElement | null);
  refreshModal();
  const focus = dialog.querySelector<HTMLElement>(
    "[autofocus], button, input, select, textarea, [tabindex]",
  );
  if (focus) {
    focus.focus();
  } else {
    dialog.tabIndex = -1;
    dialog.focus();
  }
}

let listening = false;
/** Install the document-level Escape and focus-containment listeners once. */
function installListeners() {
  if (listening) {
    return;
  }
  listening = true;
  document.addEventListener(
    "keydown",
    (event) => {
      const active = activeEntry()?.dialog;
      if (!active) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (getPopup()) {
          closeControlPopup(true);
          return;
        }
        const guard = closeGuards.get(active);
        if (guard) {
          requestGuardedClose(guard);
          return;
        }
        requestCancel(active);
      }
    },
    true,
  );
  document.addEventListener("focusin", (event) => {
    const active = activeEntry()?.dialog,
      target = event.target;
    if (
      active &&
      target instanceof HTMLElement &&
      !active.contains(target) &&
      !target.closest(".redux-window-controls")
    ) {
      active.querySelector<HTMLElement>("button, input, [tabindex]")?.focus();
    }
  });
}

export interface ModalProps {
  /** Caller-owned: the element follows this flag and is never closed directly. */
  open: boolean;
  /**
   * Closed by the user — Escape, the close button, or the browser itself.
   * `requestClose` replaces those paths when the surface owns its prompt.
   */
  onClose(): void;
  /** Host notification after the native close and its exit animation complete. */
  onClosed?(): void;
  /** A new queued request must restore focus even when the host element is reused. */
  instanceKey?: string;
  /** Higher values are shown above lower-priority modal surfaces. */
  priority?: number;
  /** Draws the title row. Left out, `children` arranges its own heading. */
  label?: string;
  /** Inline content rendered after the title text, inside the heading. */
  titleMeta?: ReactNode;
  /** Draws the top-right close button. Independent of `label`. */
  closeButton?: boolean;
  /** `id` of the caller's own heading, used by the layout that has no `label`. */
  labelledBy?: string;
  /** The paragraph under the title. */
  description?: ReactNode;
  /** The footer's buttons. Left out, no footer is drawn. */
  actions?: ReactNode;
  /** Extra class on the footer action row. */
  actionsClassName?: string;
  /** Extra attributes on the footer action row, for stable data hooks. */
  actionsProps?: Omit<HTMLAttributes<HTMLDivElement>, "className" | "children"> &
    Partial<Record<`data-${string}`, string>>;
  /** Escape. `preventDefault` keeps it open; `requestClose` replaces this path. */
  onCancel?(event: SyntheticEvent<HTMLDialogElement>): void;
  /** The site's own styling hook, on top of the shared modal chrome. */
  className?: string;
  /** Confirmation surfaces use `alertdialog`; ordinary modals leave it unset. */
  role?: "dialog" | "alertdialog";
  /** A pointer press on the scrim cancels the modal. Defaults to true. */
  dismissOnScrim?: boolean;
  /**
   * Guard the header close button, Escape, and a native window close with one
   * surface-owned request. The surface shows its own prompt and closes itself;
   * resolve true once it has closed. Setting this also disables scrim
   * dismissal, so the modal cannot be closed by clicking outside.
   */
  requestClose?(): Promise<boolean>;
  children?: ReactNode;
}

/**
 * The one modal surface.
 *
 * It owns the `<dialog>` element and the chrome around caller content. The
 * queued request host, chart loading, and design confirmations all use this
 * component; none of them creates a second modal shell.
 */
export function Modal({
  open,
  onClose,
  onClosed,
  instanceKey,
  priority = 0,
  label,
  titleMeta,
  closeButton = true,
  labelledBy,
  description,
  actions,
  actionsClassName,
  actionsProps,
  onCancel,
  className,
  role,
  dismissOnScrim = true,
  requestClose,
  children,
}: ModalProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  useModalCleanup(ref);
  const titleId = useId();
  const descriptionId = useId();
  // Native-window close and the document-level Escape policy run outside this
  // component, so the current guard stays reachable through the dialog element.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog || !requestClose) {
      return undefined;
    }
    closeGuards.set(dialog, requestClose);
    return () => {
      if (closeGuards.get(dialog) === requestClose) {
        closeGuards.delete(dialog);
      }
    };
  }, [requestClose]);
  /** Use the guarded path when the surface owns its own close prompt. */
  const requestSurfaceClose = () => {
    if (requestClose) {
      requestGuardedClose(requestClose);
      return;
    }
    onClose();
  };
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    // Reopening during the exit animation also goes through `openModal`: the
    // element is still `open` then, so the layout effect must restart it.
    if (open) {
      openModal(element, priority);
    } else if (element.open) {
      element.close();
    }
  }, [open, instanceKey, priority]);
  const content = (
    <dialog
      ref={ref}
      className={className}
      role={role}
      data-no-scrim-dismiss={dismissOnScrim ? undefined : "true"}
      aria-labelledby={label ? titleId : labelledBy}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        if (requestClose) {
          event.preventDefault();
          requestGuardedClose(requestClose);
          return;
        }
        onCancel?.(event);
      }}
      onClose={(event) => {
        // Native close events are queued. A newer request may have reopened
        // this same element before an older close event reaches React.
        if (!event.currentTarget.open) {
          (onClosed ?? onClose)();
        }
      }}
    >
      {label && (
        <div className="modal-heading">
          <h2 id={titleId}>
            {label}
            {titleMeta}
          </h2>
          {closeButton && (
            <IconButton
              icon="close"
              label={t("common.action.close")}
              onClick={requestSurfaceClose}
            />
          )}
        </div>
      )}
      {description && (
        <p className="modal-description" id={descriptionId}>
          {description}
        </p>
      )}
      {children != null && <div className="modal-content">{children}</div>}
      {actions && (
        <div className={`modal-actions ${actionsClassName ?? ""}`.trim()} {...actionsProps}>
          {actions}
        </div>
      )}
    </dialog>
  );
  return modalHost ? createPortal(content, modalHost) : content;
}
