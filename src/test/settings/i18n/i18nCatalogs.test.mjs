/** English and Chinese catalogs expose the same keys and interpolation slots. */
import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITY_CATALOG } from "../../../core/extensions/capabilityCatalog.ts";
import { en, zh } from "../../../i18n/messages/index.ts";

const placeholders = (value) =>
  [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]);

const CAPABILITY_KEY_PREFIX = "settings.extensions.capability.";

/** Trailing closing quotes or brackets a sentence may carry after its full stop. */
const CLOSERS = /["'”’»)\]]+$/;

/** Whether `value` ends as a sentence in a language whose stop marks are `marks`. */
const endsSentence = (value, marks) => marks.test(value.trim().replace(CLOSERS, ""));

test("both catalogs declare the same message keys", () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
});

test("every catalog value is a non-empty string", () => {
  for (const [key, value] of Object.entries(en)) {
    assert.equal(typeof value, "string", `en.${key} is not a string`);
    assert.ok(value.trim().length > 0, `en.${key} is empty`);
  }
  for (const [key, value] of Object.entries(zh)) {
    assert.equal(typeof value, "string", `zh.${key} is not a string`);
    assert.ok(value.trim().length > 0, `zh.${key} is empty`);
  }
});

test("settings descriptions close as a sentence in both catalogs", () => {
  const EN_STOP = /[.!?…]$/;
  const ZH_STOP = /[。！？…]$/;
  const keys = Object.keys(en).filter((key) => /^settings\..+\.description$/.test(key));
  assert.ok(keys.length > 0, "no settings description keys found");
  for (const key of keys) {
    assert.ok(
      endsSentence(en[key], EN_STOP),
      `en.${key} does not end with a full stop: ${en[key]}`,
    );
    assert.ok(
      endsSentence(zh[key], ZH_STOP),
      `zh.${key} does not end with a full stop: ${zh[key]}`,
    );
  }
});

test("paired entries interpolate the same parameters", () => {
  for (const key of Object.keys(en)) {
    assert.deepEqual(
      placeholders(zh[key]).sort(),
      placeholders(en[key]).sort(),
      `${key} has mismatched placeholders`,
    );
  }
});

test("the capability catalog has matching English and Chinese keys and no extras", () => {
  const expected = new Set(CAPABILITY_CATALOG.flatMap((row) => [row.labelKey, row.descriptionKey]));
  assert.equal(expected.size, CAPABILITY_CATALOG.length * 2);
  for (const key of expected) {
    assert.equal(typeof en[key], "string", `en.${key} is missing`);
    assert.ok(en[key].trim().length > 0, `en.${key} is empty`);
    assert.equal(typeof zh[key], "string", `zh.${key} is missing`);
    assert.ok(zh[key].trim().length > 0, `zh.${key} is empty`);
  }
  for (const catalog of [en, zh]) {
    const actual = Object.keys(catalog).filter((key) => key.startsWith(CAPABILITY_KEY_PREFIX));
    assert.deepEqual(actual.sort(), [...expected].sort());
  }
});
