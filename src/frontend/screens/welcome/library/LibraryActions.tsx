/**
 * The two creation actions below the home library.
 *
 * They share the detail card's large action size: create a new document or
 * import one, with the primary/secondary split matching the detail card.
 */
import { Button } from "../../../../design/components/button/Button.tsx";
import { Icon } from "../../../../design/components/icon/Icon.tsx";
import { ShortcutBindings } from "../../../../design/components/keyboardHint/Kbd.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import { IMPORT_CHART_EVENT } from "../../../../core/shell/shellEventNames.ts";
import { documents } from "../../editor/workspace/document/lifecycle/service.ts";
import { onboardingAnchorRef } from "../../../onboarding/anchors.ts";
import { useShortcuts } from "../../settings/shortcuts/useShortcuts.ts";

/** Footer buttons that create a document or import a chart. */
export function LibraryActions() {
  const { t } = useTranslation();
  const bindings = useShortcuts();
  const shortcut = (id: string) => bindings.find((entry) => entry.id === id)?.bindings ?? [];
  return (
    <div className="redux-library-actions">
      <Button
        ref={onboardingAnchorRef("home-new")}
        variant="solid"
        size="lg"
        className="redux-library-action"
        data-onboarding="new"
        onClick={() => documents.newDocument()}
      >
        <span className="redux-library-action-icon">
          <Icon name="new" size={16} />
        </span>
        <span className="redux-library-action-title">
          {t("workspace.welcome.library.action.new")}
        </span>
        <ShortcutBindings bindings={shortcut("file.new")} className="redux-shortcut-labels" />
      </Button>
      <Button
        ref={onboardingAnchorRef("home-import")}
        variant="outlined"
        size="lg"
        className="redux-library-action"
        data-onboarding="import"
        onClick={() => window.dispatchEvent(new Event(IMPORT_CHART_EVENT))}
      >
        <span className="redux-library-action-icon">
          <Icon name="open" size={16} />
        </span>
        <span className="redux-library-action-title">
          {t("workspace.welcome.library.action.import")}
        </span>
        <ShortcutBindings bindings={shortcut("file.open")} className="redux-shortcut-labels" />
      </Button>
    </div>
  );
}
