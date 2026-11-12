/** Shared timing page composition rendered in compact and expanded locations. */
import { useTranslation } from "../../../../../i18n/react.ts";
import { InspectorPageSplit } from "../../../../chrome/inspectorPage/InspectorPageSplit.tsx";
import { GlobalTimingInspector } from "./GlobalTimingInspector.tsx";
import { GlobalTimingWorkspace } from "./GlobalTimingWorkspace.tsx";

/** Places the same timing list and property faces for one workspace state. */
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
        <div className="studio-detail-pane">{properties}</div>
      </div>
    </div>
  );
}
