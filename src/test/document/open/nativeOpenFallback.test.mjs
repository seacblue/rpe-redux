/**
 * Contract: a native archive open that finds no RPE chart is the only failure
 * handed to the external-chart converter; the failed load card is dismissed
 * before conversion, and every other failure keeps its native wording.
 */
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { beginLoading, loadingProgress } from "../../../core/global/document/loading.ts";
import { PEZ_CHART_MISSING_CODE } from "../../../core/platform/desktop/documentErrors.ts";
import {
  isMissingRpeChartError,
  openNativeChartPath,
} from "../../../frontend/screens/editor/workspace/document/open/nativeOpenFallback.ts";

/** The localized error the desktop document store throws for a chart-less archive. */
function pezChartMissing() {
  return Object.assign(new Error("PEZ 包中没有找到可打开的 RPE 谱面。"), {
    code: PEZ_CHART_MISSING_CODE,
    solution: "…",
    documentError: true,
  });
}

/** One visible failed-load card, the state the fallback has to clear. */
function failedLoadCard(error) {
  const task = beginLoading("Quon.zip");
  task.fail(error);
}

beforeEach(() => {
  loadingProgress.dismiss();
});

afterEach(() => {
  loadingProgress.dismiss();
});

test("only the missing-RPE-chart failure is recognized", () => {
  assert.equal(isMissingRpeChartError(pezChartMissing()), true);
  assert.equal(
    isMissingRpeChartError(new Error("No RPE chart found in the PEZ archive.")),
    true,
    "the unlocalized native wording must also be recognized",
  );
  assert.equal(isMissingRpeChartError(new Error("PEZ contains multiple charts.")), false);
  assert.equal(
    isMissingRpeChartError(Object.assign(new Error("damaged"), { code: "chart_too_large" })),
    false,
  );
  assert.equal(isMissingRpeChartError(null), false);
  assert.equal(isMissingRpeChartError("pez_chart_missing"), false);
});

test("a successful native open never reaches the converter", async () => {
  const calls = [];
  await openNativeChartPath("chart.pez", {
    open: async (path) => {
      calls.push(path);
    },
    importExternalChart: async () => {
      throw new Error("converter must not run");
    },
  });
  assert.deepEqual(calls, ["chart.pez"]);
});

test("a chart-less archive is converted and the load error card is dismissed", async () => {
  const failure = pezChartMissing();
  failedLoadCard(failure);
  const converted = [];
  await openNativeChartPath("Quon.zip", {
    open: async () => {
      throw failure;
    },
    importExternalChart: async (path) => {
      converted.push(path);
      return true;
    },
  });
  assert.deepEqual(converted, ["Quon.zip"]);
  assert.equal(loadingProgress.getSnapshot(), null);
});

test("an archive that is not an external chart restores the native failure card", async () => {
  const failure = pezChartMissing();
  const converted = [];
  await assert.rejects(
    openNativeChartPath("broken.zip", {
      open: async () => {
        throw failure;
      },
      importExternalChart: async (path) => {
        converted.push(path);
        return false;
      },
    }),
    (error) => error === failure,
  );
  assert.deepEqual(converted, ["broken.zip"]);
  const card = loadingProgress.getSnapshot();
  assert.equal(card?.status, "error");
  assert.equal(card?.errorCode, PEZ_CHART_MISSING_CODE);
  assert.equal(card?.name, "broken.zip");
});

test("other native failures keep their error and their loading card", async () => {
  const failure = Object.assign(new Error("The chart is too large."), { code: "chart_too_large" });
  failedLoadCard(failure);
  await assert.rejects(
    openNativeChartPath("huge.json", {
      open: async () => {
        throw failure;
      },
      importExternalChart: async () => {
        throw new Error("converter must not run");
      },
    }),
    (error) => error === failure,
  );
  assert.equal(loadingProgress.getSnapshot()?.status, "error");
});

test("a conversion failure replaces the native failure as the diagnosis", async () => {
  const importFailure = new Error("library service down");
  await assert.rejects(
    openNativeChartPath("Quon.zip", {
      open: async () => {
        throw pezChartMissing();
      },
      importExternalChart: async () => {
        throw importFailure;
      },
    }),
    (error) => error === importFailure,
  );
  assert.equal(loadingProgress.getSnapshot(), null);
});

test("a host without a converter keeps the native failure path", async () => {
  const failure = pezChartMissing();
  failedLoadCard(failure);
  await assert.rejects(
    openNativeChartPath("Quon.zip", {
      open: async () => {
        throw failure;
      },
    }),
    (error) => error === failure,
  );
  assert.equal(loadingProgress.getSnapshot()?.status, "error");
});
