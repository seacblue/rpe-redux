/**
 * Connects script UI requests to the shell's own surfaces.
 *
 * Notices, progress, confirmations, inputs, and selects are answered through the
 * dialog host and the one shared notice stack.
 */
import { showStickyToast, type ToastHandle } from "../../design/patterns/ToastHost.tsx";
import { requestConfirm, requestInput, requestSelect } from "../overlays/modals/prompts.ts";
import {
  connectScriptUiHost,
  type ScriptUiNoticeOptions,
  type ScriptUiInputOptions,
  type ScriptUiSelectOptions,
  type ScriptUiProgressHandle,
  type ScriptUiRequest,
} from "../../core/extensions/scriptUi.ts";
import { tRaw } from "../../i18n/index.ts";
import { disposeScriptGuides, requestScriptGuide } from "./ScriptGuideHost.tsx";

interface ActiveNotice {
  handle: ToastHandle;
  dispose(): void;
}

const notices = new Map<number, ActiveNotice>();

/** Dismisses one notice and releases its abort listener. */
function removeNotice(id: number): void {
  const notice = notices.get(id);
  if (!notice) {
    return;
  }
  notices.delete(id);
  notice.dispose();
}

/**
 * Publishes one script notice into the shared stack.
 *
 * The signal owns its lifetime: aborting the script request dismisses the row, and
 * a progress handle additionally exposes a cancel action.
 */
function addNotice(
  request: ScriptUiRequest,
  message: string,
  options: ScriptUiNoticeOptions = {},
): ToastHandle | null {
  if (request.signal.aborted) {
    return null;
  }
  const step =
    options.step !== undefined && options.totalSteps !== undefined && options.totalSteps > 0
      ? { current: options.step, total: options.totalSteps }
      : undefined;
  const handle = showStickyToast({
    message,
    level: options.level ?? "info",
    source: request.source.name,
    duration: options.timeoutMs ?? 5000,
    ...(step ? { step } : {}),
    onDismiss: (id) => removeNotice(id),
  });
  if (handle.id < 0) {
    return null;
  }
  const abort = () => {
    handle.dismiss();
    removeNotice(handle.id);
  };
  request.signal.addEventListener("abort", abort, { once: true });
  notices.set(handle.id, {
    handle,
    dispose() {
      request.signal.removeEventListener("abort", abort);
    },
  });
  return handle;
}

/** Connects script notices, dialogs, progress, and guides to the shell surfaces. */
export function installScriptUiHost(): () => void {
  const disconnect = connectScriptUiHost({
    capabilities: ["notice", "confirm", "progress", "input", "select", "guide"],
    notice(request, message, options) {
      addNotice(request, message, options);
    },
    confirm(request, message) {
      return requestConfirm({
        title: `${request.source.name}, Extension`,
        description: message,
        signal: request.signal,
      });
    },
    input(request, options: ScriptUiInputOptions) {
      return requestInput({
        title: options.title,
        description: options.description ?? "",
        defaultValue: options.defaultValue,
        placeholder: options.placeholder,
        multiline: options.multiline,
        label: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        signal: request.signal,
      });
    },
    select(request, options: ScriptUiSelectOptions) {
      return requestSelect({
        title: options.title,
        description: options.description ?? "",
        entries: options.options,
        defaultValue: options.defaultValue,
        cancelLabel: options.cancelLabel,
        signal: request.signal,
      });
    },
    guide(request, options) {
      return requestScriptGuide(request, options);
    },
    progress(request, title, totalSteps): ScriptUiProgressHandle {
      const controller = new AbortController();
      if (request.signal.aborted) {
        controller.abort();
      }
      const handle = addNotice(request, title, {
        level: "info",
        totalSteps,
        step: 0,
        timeoutMs: 0,
      });
      let closed = false;
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        request.signal.removeEventListener("abort", cancel);
        if (handle) {
          removeNotice(handle.id);
          handle.dismiss();
        }
      };
      const cancel = () => {
        if (closed) {
          return;
        }
        controller.abort();
        close();
      };
      request.signal.addEventListener("abort", cancel, { once: true });
      handle?.update({
        actions: [
          {
            label: tRaw("common.action.cancel"),
            variant: "outlined",
            onSelect: cancel,
          },
        ],
      });
      return {
        signal: controller.signal,
        update(message, options) {
          if (closed || request.signal.aborted || !handle) {
            return;
          }
          handle.update({
            message,
            ...(options?.level ? { level: options.level } : {}),
            ...(options?.step !== undefined &&
            options.totalSteps !== undefined &&
            options.totalSteps > 0
              ? { step: { current: options.step, total: options.totalSteps } }
              : {}),
          });
        },
        close,
      };
    },
  });
  return () => {
    disconnect();
    for (const notice of [...notices.values()]) {
      notice.handle.dismiss();
      notice.dispose();
    }
    notices.clear();
    disposeScriptGuides();
  };
}
