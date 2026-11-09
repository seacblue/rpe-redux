/**
 * The compatibility report dialog.
 *
 * It lists what an import carried differently, one row per issue, and is raised
 * from the import notice and from the title-bar badge. The list is deliberately
 * plain: this is a reading surface, not a decision, so it closes with one button.
 */
import { createElement } from "react";
import { dismissModal, presentModal } from "./modalQueue.ts";
import { Button } from "../../../design/components/button/Button.tsx";
import { t } from "../../../i18n/index.ts";
import type { ImportIssue, ImportReport } from "../../screens/welcome/importReport.ts";

let nextId = 0;

/** A migration can produce thousands of lines; the dialog stays readable. */
const MAX_REPORT_ROWS = 200;
/** Charts shown as separate sections; a large folder is summarised after this. */
const MAX_REPORT_GROUPS = 50;

/** One issue row: where it happened, and what happened. */
function IssueList({ issues }: { issues: readonly ImportIssue[] }) {
  const visible = issues.slice(0, MAX_REPORT_ROWS);
  const hidden = issues.length - visible.length;
  return createElement(
    "ul",
    { className: "import-report-list" },
    ...visible.map((issue, index) =>
      createElement(
        "li",
        { key: `${index}:${issue.scope}`, className: "import-report-item" },
        issue.scope
          ? createElement("strong", { className: "import-report-scope" }, issue.scope)
          : null,
        createElement("span", { className: "import-report-detail" }, issue.detail),
      ),
    ),
    hidden > 0
      ? createElement(
          "li",
          { className: "import-report-item import-report-more" },
          t("workspace.welcome.importReport.more", { count: hidden }),
        )
      : null,
  );
}

/**
 * Shows one report, or every recorded report when `projectId` is omitted.
 *
 * The caller awaits nothing: a report has no answer, and dismissing it must not
 * be mistaken for a decision about the import.
 */
export function showImportReport(source: string, reports: readonly ImportReport[]): void {
  if (!reports.length) {
    return;
  }
  const id = `import-report:${++nextId}`;
  const total = reports.reduce((count, report) => count + report.issues.length, 0);
  const groups = reports.slice(0, MAX_REPORT_GROUPS);
  const hiddenGroups = reports.length - groups.length;
  presentModal(id, {
    label: t("workspace.welcome.importReport.title"),
    description: t("workspace.welcome.importReport.description", { source, count: total }),
    className: "redux-prompt-dialog import-report-dialog",
    onClose: () => dismissModal(id),
    actions: createElement(
      Button,
      { variant: "solid", onClick: () => dismissModal(id) },
      t("common.action.close"),
    ),
    children: createElement(
      "div",
      { className: "import-report-groups" },
      ...groups.map((report) =>
        createElement(
          "section",
          { key: report.projectId, className: "import-report-group" },
          createElement(
            "h3",
            { className: "import-report-heading" },
            `${report.title}, ${report.source}`,
          ),
          createElement(IssueList, { issues: report.issues }),
        ),
      ),
      hiddenGroups > 0
        ? createElement(
            "p",
            { className: "import-report-more" },
            t("workspace.welcome.importReport.moreGroups", { count: hiddenGroups }),
          )
        : null,
    ),
  });
}
