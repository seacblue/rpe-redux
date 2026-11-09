/**
 * Imperative prompts built on the shared modal queue.
 *
 * Callers await a confirm, input, select, or notice answer without owning a modal
 * element or React state of their own.
 */
import { createElement, Fragment } from "react";
import { dismissModal, presentModal, type ModalPriority } from "./modalQueue.ts";
import {
  ActionChoiceActions,
  ChoiceActions,
  ExitActions,
  InputActions,
  NoticeActions,
  PromptActions,
  PromptInput,
  PromptSelect,
  type ActionChoice,
  type ExitChoice,
} from "./PromptContent.tsx";
import type { ScriptUiSelectOption } from "../../../core/extensions/scriptUi.ts";

interface PromptMessage {
  title: string;
  /** The paragraph under the title; omit it when the title is enough. */
  description?: string;
  detail?: string;
  priority?: ModalPriority;
}
let nextId = 0;
const identity = () => `prompt:${++nextId}`;
const description = (message: PromptMessage) =>
  message.detail
    ? createElement(
        Fragment,
        null,
        message.description,
        createElement("span", { className: "redux-notice-detail" }, message.detail),
      )
    : message.description;

/** Shows a dismiss-only notice; it joins the shared priority stack. */
export function showNotice(message: PromptMessage): void {
  const id = identity();
  const close = () => dismissModal(id);
  presentModal(id, {
    label: message.title,
    description: description(message),
    className: "redux-prompt-dialog",
    onClose: close,
    priority: message.priority,
    actions: createElement(NoticeActions, { close }),
  });
}

/** Asks for a yes/no answer; resolves false on dismissal or abort. */
export function requestConfirm(
  options: PromptMessage & {
    label?: string;
    cancelLabel?: string;
    /** Marks an answer that discards data, so its button carries the danger surface. */
    destructive?: boolean;
    signal?: AbortSignal;
  },
): Promise<boolean> {
  return new Promise((resolve) => {
    const id = identity();
    let pending = true;
    const abort = () => settle(false);
    const settle = (accepted: boolean) => {
      if (!pending) {
        return;
      }
      pending = false;
      options.signal?.removeEventListener("abort", abort);
      dismissModal(id);
      resolve(accepted);
    };
    if (options.signal?.aborted) {
      settle(false);
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    presentModal(id, {
      label: options.title,
      description: description(options),
      className: "redux-confirm",
      closeButton: false,
      role: "alertdialog",
      onClose: () => settle(false),
      priority: options.priority,
      actions: createElement(PromptActions, {
        confirm: true,
        label: options.label,
        cancelLabel: options.cancelLabel,
        destructive: options.destructive,
        settle,
      }),
    });
  });
}

/** A normal footer decision for leaving with unsaved work. */
/** Asks whether to save, discard, or cancel; resolves `cancel` on dismissal or abort. */
export function requestExitChoice(
  options: PromptMessage & {
    saveLabel: string;
    discardLabel: string;
    cancelLabel?: string;
    signal?: AbortSignal;
  },
): Promise<ExitChoice> {
  return new Promise((resolve) => {
    const id = identity();
    let pending = true;
    const abort = () => settle("cancel");
    const settle = (choice: ExitChoice) => {
      if (!pending) {
        return;
      }
      pending = false;
      options.signal?.removeEventListener("abort", abort);
      dismissModal(id);
      resolve(choice);
    };
    if (options.signal?.aborted) {
      settle("cancel");
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    presentModal(id, {
      label: options.title,
      description: description(options),
      className: "redux-confirm",
      role: "alertdialog",
      onClose: () => settle("cancel"),
      priority: options.priority,
      actions: createElement(ExitActions, {
        saveLabel: options.saveLabel,
        discardLabel: options.discardLabel,
        cancelLabel: options.cancelLabel,
        choose: settle,
      }),
    });
  });
}

/** Asks for a line or block of text; resolves the entry, or null on cancel or abort. */
export function requestInput(
  options: PromptMessage & {
    defaultValue?: string;
    placeholder?: string;
    multiline?: boolean;
    label?: string;
    cancelLabel?: string;
    signal?: AbortSignal;
  },
): Promise<string | null> {
  return new Promise((resolve) => {
    const id = identity();
    const inputRef: { current: HTMLInputElement | HTMLTextAreaElement | null } = { current: null };
    let pending = true;
    const abort = () => settle(null);
    const settle = (value: string | null) => {
      if (!pending) {
        return;
      }
      pending = false;
      options.signal?.removeEventListener("abort", abort);
      dismissModal(id);
      resolve(value);
    };
    const submit = () => settle(inputRef.current?.value ?? options.defaultValue ?? "");
    if (options.signal?.aborted) {
      settle(null);
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    presentModal(id, {
      label: options.title,
      description: options.detail,
      className: "redux-prompt-dialog",
      onClose: () => settle(null),
      priority: options.priority,
      actions: createElement(InputActions, {
        confirmLabel: options.label,
        cancelLabel: options.cancelLabel,
        cancel: () => settle(null),
        submit,
      }),
      children: createElement(PromptInput, {
        inputRef,
        title: options.title,
        label: options.description?.trim() || undefined,
        defaultValue: options.defaultValue,
        placeholder: options.placeholder,
        multiline: options.multiline,
        submit,
      }),
    });
  });
}

/** Asks for one option from a list; resolves its value, or null on cancel or abort. */
export function requestSelect(
  options: PromptMessage & {
    entries: readonly ScriptUiSelectOption[];
    defaultValue?: string;
    cancelLabel?: string;
    signal?: AbortSignal;
  },
): Promise<string | null> {
  return new Promise((resolve) => {
    const id = identity();
    let pending = true;
    const abort = () => settle();
    const settle = (value?: string) => {
      if (!pending) {
        return;
      }
      pending = false;
      options.signal?.removeEventListener("abort", abort);
      dismissModal(id);
      resolve(value ?? null);
    };
    if (options.signal?.aborted) {
      settle();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    presentModal(id, {
      label: options.title,
      description: description(options),
      className: "redux-prompt-dialog",
      onClose: () => settle(),
      priority: options.priority,
      actions: createElement(PromptActions, {
        confirm: false,
        cancelLabel: options.cancelLabel,
        settle: () => settle(),
      }),
      children: createElement(PromptSelect, {
        choices: options.entries,
        selectedValue: options.defaultValue,
        choose: settle,
      }),
    });
  });
}

/**
 * Asks for one caller-defined answer rendered as a footer button.
 *
 * Dismissal, Escape, or an abort resolves `cancelValue`, so the surface never
 * needs a second close path. Answers keep the order the caller supplied.
 */
export function requestActionChoice<T extends string>(
  options: PromptMessage & {
    entries: readonly ActionChoice<T>[];
    cancelValue: T;
    actionsClassName?: string;
    signal?: AbortSignal;
  },
): Promise<T> {
  return new Promise((resolve) => {
    const id = identity();
    let pending = true;
    const abort = () => settle(options.cancelValue);
    const settle = (value: T) => {
      if (!pending) {
        return;
      }
      pending = false;
      options.signal?.removeEventListener("abort", abort);
      dismissModal(id);
      resolve(value);
    };
    if (options.signal?.aborted) {
      settle(options.cancelValue);
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    presentModal(id, {
      label: options.title,
      description: description(options),
      className: "redux-confirm",
      closeButton: false,
      role: "alertdialog",
      onClose: () => settle(options.cancelValue),
      priority: options.priority,
      actionsClassName: options.actionsClassName,
      actions: createElement(ActionChoiceActions, {
        choices: options.entries,
        choose: settle,
      }),
    });
  });
}

/** Asks for one entry rendered as a footer button; resolves it, or null on dismissal. */
export function requestChoice<T>(
  options: PromptMessage & {
    entries: readonly T[];
    label(entry: T): string;
    /** Extra class for the footer when its answers must stay on one row. */
    actionsClassName?: string;
  },
): Promise<T | null> {
  return new Promise((resolve) => {
    const id = identity();
    let pending = true;
    const settle = (index?: number) => {
      if (!pending) {
        return;
      }
      pending = false;
      dismissModal(id);
      resolve(index === undefined ? null : (options.entries[index] ?? null));
    };
    presentModal(id, {
      label: options.title,
      description: description(options),
      className: "redux-prompt-dialog",
      actionsClassName: options.actionsClassName,
      onClose: () => settle(),
      actions: createElement(ChoiceActions, {
        labels: options.entries.map(options.label),
        choose: settle,
      }),
    });
  });
}
