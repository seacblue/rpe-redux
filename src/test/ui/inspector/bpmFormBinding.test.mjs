/** The BPM form binding keeps overlapping compact and expanded timing views safe. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createBpmForm,
  retainBpmForm,
} from "../../../frontend/screens/editor/inspector/bpm/model.ts";

const session = (bpm = 120) => ({
  chart: {
    BPMList: [{ bpm, startTime: [0, 0, 1] }],
  },
});

test("a compact and expanded timing view share a retained BPM request", () => {
  const form = createBpmForm();
  const current = session();
  const releaseCompact = retainBpmForm(form, current);
  const releaseStudio = retainBpmForm(form, current);

  assert.equal(form.get()?.session, current);
  releaseStudio();
  assert.equal(form.get()?.session, current);
  releaseCompact();
  assert.equal(form.get(), null);
});

test("releasing a binding twice does not clear a later owner", () => {
  const form = createBpmForm();
  const current = session();
  const releaseFirst = retainBpmForm(form, current);
  releaseFirst();
  releaseFirst();
  const releaseSecond = retainBpmForm(form, current);

  releaseFirst();
  assert.equal(form.get()?.session, current);
  releaseSecond();
  assert.equal(form.get(), null);
});
