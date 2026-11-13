/** Shared timing page composition for the compact Inspector and wide workspace. */
import { useTranslation } from "../../../../../i18n/react.ts";
import { InspectorPageSplit } from "../../../../chrome/inspectorPage/InspectorPageSplit.tsx";
import { GlobalTimingInspector } from "./GlobalTimingInspector.tsx";
import { GlobalTimingWorkspace } from "./GlobalTimingWorkspace.tsx";

/** Places one timing list and one property face in the requested layout. */
export function TimingPageLayout({ layout }: { layout: "compact" | "expanded" }) {
  const { t } = useTranslation();
  const list = <GlobalTimingWorkspace />;
  const properties = <GlobalTimingInspector />;

  if (layout === "compact") {
    return (
      <InspectorPageSplit
        topLabel={t("editorPanels.inspector.form.bpm.title")}
        bottomLabel={t("editorPanels.inspector.form.bpm.attributes")}
        top={list}
        bottom={properties}
      />
    );
  }

  return (
    <div className="timing-studio">
      <div className="studio-body">
        <div className="studio-list-pane">{list}</div>
        <div className="studio-detail-pane mode-handoff-detail">{properties}</div>
      </div>
    </div>
  );
}
