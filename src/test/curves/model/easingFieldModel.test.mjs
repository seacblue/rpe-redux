/** Linear easing disables its direction placeholder while keeping it visible. */
import assert from "node:assert/strict";
import test from "node:test";
import { easingDirectionControlState } from "../../../design/components/easing/easingFieldModel.ts";
import {
  easingDirections,
  rotateEasingDirection,
  rotateEasingFamily,
  stepEasingId,
} from "../../../design/components/easing/easingTable.ts";

test("Linear direction placeholder is natively disabled", () => {
  assert.deepEqual(easingDirectionControlState(false, false), {
    disabled: true,
    ariaDisabled: undefined,
    tabIndex: undefined,
  });
});

test("a disabled easing field still disables its direction control", () => {
  assert.deepEqual(easingDirectionControlState(false, true), {
    disabled: true,
    ariaDisabled: undefined,
    tabIndex: undefined,
  });
});

test("easing id wheel steps stop at the chart bounds", () => {
  assert.equal(stepEasingId(12, 1), 13);
  assert.equal(stepEasingId(1, -1), 1);
  assert.equal(stepEasingId(29, 1), 29);
});

test("easing family wheel wraps through the full family list", () => {
  assert.equal(rotateEasingFamily("Linear", -1), "Bounce");
  assert.equal(rotateEasingFamily("Bounce", 1), "Linear");
});

test("easing direction wheel wraps only the current family's directions", () => {
  const directions = easingDirections("Sine");
  assert.equal(rotateEasingDirection(directions, "In", -1), "InOut");
  assert.equal(rotateEasingDirection(directions, "InOut", 1), "In");
  assert.equal(rotateEasingDirection([], undefined, 1), null);
});
