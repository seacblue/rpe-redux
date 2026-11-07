/**
 * Shows the loopback code-cell endpoints with a copyable, editable AI prompt.
 *
 * Code cells are the only AI entry point; the control presents the guide and
 * run URLs and lets the user inspect, adjust, paste into, or copy the prompt.
 * The prompt editor grows with its content instead of exposing a manual resize
 * handle.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { aiServiceOrigin } from "../../../core/global/library/client.ts";
import { isDesktop } from "../../../core/platform/environment.ts";
import { useTranslation } from "../../../i18n/react.ts";
import { Textarea } from "../../../design/components/input/Textarea.tsx";
import { Button } from "../../../design/components/button/Button.tsx";
import { Modal } from "../../../design/components/modal/Modal.tsx";
import { showToast } from "../../../design/patterns/ToastHost.tsx";
import { useSetting } from "./useSetting.ts";
import { registerSettingControl } from "./settingsContributions.ts";

/** Show the configured code-cell endpoints with a copyable client prompt. */
export function CodeCellAccessControl() {
  const { t } = useTranslation();
  const codeEnabled = useSetting("code-execution-enabled", false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);
  const origin = aiServiceOrigin();
  const guideEndpoint = `${origin}/api/cell/guide`;
  const runEndpoint = `${origin}/api/cell/run`;

  // Focus the editor when the dialog opens so a paste shortcut targets the
  // draft instead of the dialog chrome.
  useLayoutEffect(() => {
    if (promptOpen) {
      promptRef.current?.focus();
    }
  }, [promptOpen]);

  // Let the editor follow its wrapped content up to the CSS max-height. The
  // observer re-fits it when the modal or window width changes; the border
  // delta keeps `scrollHeight` from clipping the last line in a border-box.
  useLayoutEffect(() => {
    const area = promptRef.current;
    if (!area) {
      return;
    }
    const fit = () => {
      area.style.height = "auto";
      area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`;
      if (caretRef.current !== null) {
        const caret = caretRef.current;
        caretRef.current = null;
        area.focus();
        area.setSelectionRange(caret, caret);
      }
    };
    fit();
    let width = area.clientWidth;
    const observer = new ResizeObserver(() => {
      // Height changes are our own output; only a new available width changes
      // the wrapped line count and needs another fit.
      if (area.clientWidth !== width) {
        width = area.clientWidth;
        fit();
      }
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [promptDraft, promptOpen]);

  if (!isDesktop()) {
    return <p className="redux-field-description">{t("settings.codeCell.desktopOnly")}</p>;
  }

  const prompt = t("settings.codeCell.aiPrompt", {
    guide: guideEndpoint,
    run: runEndpoint,
  });

  /** Copy one prompt and report the outcome with the shared toast stack. */
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        showToast({
          message: t("settings.codeCell.copyPromptSuccess"),
          source: t("settings.field.code-cell-access.label"),
        });
      },
      () => {
        showToast({
          message: t("settings.codeCell.copyPromptFailed"),
          level: "error",
          source: t("settings.field.code-cell-access.label"),
        });
      },
    );
  };

  /** Replace the draft's selection with plain text and place the caret after it. */
  const insertPromptText = (text: string) => {
    const area = promptRef.current;
    const start = area?.selectionStart ?? promptDraft.length;
    const end = area?.selectionEnd ?? start;
    caretRef.current = start + text.length;
    setPromptDraft(`${promptDraft.slice(0, start)}${text}${promptDraft.slice(end)}`);
  };

  /** Open the editor with the current generated prompt. */
  const editPrompt = () => {
    setPromptDraft(prompt);
    setPromptOpen(true);
  };

  return (
    <>
      <div className="code-cell-access">
        <div className="code-cell-access-header">
          <span className="code-cell-access-title">
            {t("settings.field.code-cell-access.label")}
          </span>
          {codeEnabled && (
            <div className="code-cell-access-header-actions">
              <Button variant="outlined" onClick={editPrompt}>
                {t("settings.codeCell.promptEdit")}
              </Button>
              <Button variant="outlined" onClick={() => copy(prompt)}>
                {t("settings.codeCell.copyPrompt")}
              </Button>
            </div>
          )}
        </div>
        <div className="code-cell-access-list">
          {codeEnabled && (
            <>
              <div className="code-cell-access-line">
                <span>{t("settings.codeCell.cellGuide")}</span>
                <code>{guideEndpoint}</code>
              </div>
              <div className="code-cell-access-line">
                <span>{t("settings.codeCell.cellRun")}</span>
                <code>{runEndpoint}</code>
              </div>
            </>
          )}
          {!codeEnabled && (
            <p className="redux-field-description">{t("settings.codeCell.nothingEnabled")}</p>
          )}
        </div>
      </div>
      <Modal
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        priority={10}
        className="code-cell-prompt"
        label={t("settings.codeCell.promptTitle")}
        actions={
          <Button variant="outlined" onClick={() => setPromptOpen(false)}>
            {t("common.action.close")}
          </Button>
        }
      >
        <Textarea
          ref={promptRef}
          className="code-cell-prompt-text"
          aria-label={t("settings.codeCell.promptTitle")}
          rows={12}
          value={promptDraft}
          spellCheck={false}
          onChange={(event) => setPromptDraft(event.target.value)}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (!text) {
              return;
            }
            event.preventDefault();
            insertPromptText(text);
          }}
        />
      </Modal>
    </>
  );
}

registerSettingControl("code-cell-access", CodeCellAccessControl);
