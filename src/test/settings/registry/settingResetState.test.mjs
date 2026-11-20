/**
 * The settings reset affordance follows provenance as well as value equality.
 *
 * A row whose value is back at its default is still resettable while the user's
 * commit remains recorded; an action row never offers a reset.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  settingDiffers,
  settingShowsReset,
} from "../../../frontend/screens/settings/settingResetState.ts";

const numeric = {
  key: "test.reset.numeric",
  navigation: "test",
  group: "",
  label: "test.setting.label",
  control: "number",
  default: 4,
};

test("a modified value equal to the default still offers reset", () => {
  assert.equal(settingShowsReset(numeric, 4, false), false);
  assert.equal(settingShowsReset(numeric, 4, true), true);
  assert.equal(settingShowsReset(numeric, 8, false), true);
});

test("numeric and colour comparisons ignore formatting differences", () => {
  assert.equal(settingDiffers(numeric, "4"), false);
  assert.equal(settingDiffers(numeric, "4.0"), false);
  assert.equal(settingDiffers(numeric, "5"), true);
  const colour = { ...numeric, control: "color", default: "#ffcc66" };
  assert.equal(settingDiffers(colour, "#FFCC66"), false);
  assert.equal(settingDiffers(colour, "#ffffff"), true);
});

test("action rows never offer a reset", () => {
  const action = {
    ...numeric,
    control: "action",
    action: { kind: "navigate", target: "test" },
  };
  assert.equal(settingShowsReset(action, 4, true), false);
  assert.equal(settingShowsReset({ ...numeric, default: undefined }, 4, true), false);
});
