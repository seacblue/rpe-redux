/** Verifies the Extension method registry, completeness check, and consent catalog. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTENSION_CAPABILITIES,
  isExtensionCapability,
} from "../../../core/extensions/capabilities.ts";
import {
  CAPABILITY_CATALOG,
  CAPABILITY_CONSENT_ROWS,
  consentRowsFor,
  riskOf,
} from "../../../core/extensions/capabilityCatalog.ts";
import {
  EXTENSION_METHODS,
  ExtensionMethodRegistrationError,
  assertRegistryComplete,
  lookupMethod,
  methodKey,
  methodsForCapability,
} from "../../../core/extensions/methodRegistry.ts";

const FACADE_HANDLES = [
  "chart",
  "transaction",
  "selection",
  "document",
  "library",
  "playback",
  "toolbar",
  "sidebar",
  "contextMenu",
  "settings",
  "values",
  "shortcuts",
  "diagnostics",
  "hitTest",
  "preview",
  "layout",
  "theme",
  "help",
];
const RISK_TIERS = new Set(["read", "write", "sensitive"]);
const FORBIDDEN_NAME =
  /(^|[._])(?:host|patch|eval|exec|raw|internal|shell|fs|ipc|network)([._]|$)/u;

/** Build a facade-shaped object from the registered method paths. */
function facadeFrom(entries) {
  const facade = {};
  for (const entry of entries) {
    if (!entry.handle) {
      continue;
    }
    const parts = entry.method.split(".");
    let target = (facade[entry.handle] ??= {});
    for (const part of parts.slice(0, -1)) {
      target = target[part] ??= {};
    }
    target[parts.at(-1)] = () => {};
  }
  return facade;
}

test("every registry key is unique and names a grantable capability", () => {
  const keys = new Set();
  for (const entry of EXTENSION_METHODS) {
    const key = methodKey(entry.handle, entry.method);
    assert.equal(keys.has(key), false, `duplicate registration: ${key}`);
    keys.add(key);
    assert.ok(isExtensionCapability(entry.capability), `unknown capability: ${key}`);
    assert.notEqual(entry.capability, "host.patch", `retired capability: ${key}`);
    assert.ok(RISK_TIERS.has(entry.risk), `invalid risk: ${key}`);
    assert.equal(typeof entry.since, "string");
    assert.ok(entry.since.length > 0, `missing since: ${key}`);
    if (entry.handle === "") {
      assert.ok(entry.method.includes("."), `context method must be namespaced: ${key}`);
    } else {
      assert.ok(entry.method.length > 0, `missing method name: ${key}`);
    }
  }
  assert.ok(EXTENSION_METHODS.length > FACADE_HANDLES.length);
});

test("read methods never claim to write host state", () => {
  for (const entry of EXTENSION_METHODS) {
    if (entry.writesHostState) {
      assert.notEqual(
        entry.risk,
        "read",
        `read method writes host state: ${methodKey(entry.handle, entry.method)}`,
      );
    }
  }
});

test("the completeness check accepts a facade built from the registry", () => {
  const facade = facadeFrom(EXTENSION_METHODS);
  assert.doesNotThrow(() => assertRegistryComplete(facade));
  assert.equal(lookupMethod("chart", "notes")?.capability, "chart.read");
  assert.equal(lookupMethod("library", "current.createRevision")?.capability, "library.write");
  assert.equal(lookupMethod("", "ui.notice")?.capability, "ui.notice");
});

test("the completeness check rejects an unregistered facade method", () => {
  const facade = facadeFrom(EXTENSION_METHODS);
  facade.chart.unregisteredMethod = () => {};
  assert.throws(
    () => assertRegistryComplete(facade),
    (error) => {
      assert.ok(error instanceof ExtensionMethodRegistrationError);
      assert.equal(error.code, "methodNotRegistered");
      assert.equal(error.path, "chart.unregisteredMethod");
      return true;
    },
  );
});

test("the completeness check rejects an unregistered nested method", () => {
  const facade = facadeFrom(EXTENSION_METHODS);
  facade.diagnostics.trace.unregisteredTraceMethod = () => {};
  assert.throws(
    () => assertRegistryComplete(facade),
    (error) => {
      assert.equal(error.code, "methodNotRegistered");
      assert.equal(error.path, "diagnostics.trace.unregisteredTraceMethod");
      return true;
    },
  );
});

test("the capability vocabulary stays under the charter cap and excludes universal names", () => {
  assert.ok(EXTENSION_CAPABILITIES.length <= 36);
  for (const capability of EXTENSION_CAPABILITIES) {
    if (capability === "host.patch") {
      continue;
    }
    assert.equal(
      FORBIDDEN_NAME.test(capability),
      false,
      `forbidden capability name: ${capability}`,
    );
  }
  for (const entry of EXTENSION_METHODS) {
    const key = methodKey(entry.handle, entry.method);
    assert.equal(FORBIDDEN_NAME.test(key), false, `forbidden method name: ${key}`);
  }
});

test("the capability catalog covers all names and consent excludes host.patch", () => {
  assert.equal(EXTENSION_CAPABILITIES.length, 34);
  assert.equal(CAPABILITY_CATALOG.length, EXTENSION_CAPABILITIES.length);
  assert.deepEqual(
    CAPABILITY_CATALOG.map((row) => row.capability),
    [...EXTENSION_CAPABILITIES],
  );

  const typedKeys = new Set(
    EXTENSION_METHODS.map((entry) => methodKey(entry.handle, entry.method)),
  );
  const seen = new Set();
  for (const row of CAPABILITY_CATALOG) {
    assert.equal(seen.has(row.capability), false, `duplicate row: ${row.capability}`);
    seen.add(row.capability);
    assert.equal(row.risk, riskOf(row.capability));
    assert.equal(row.labelKey, `settings.extensions.capability.${row.capability}.label`);
    assert.equal(
      row.descriptionKey,
      `settings.extensions.capability.${row.capability}.description`,
    );
    assert.ok(row.examples.length <= 5);
    for (const example of row.examples) {
      assert.ok(typedKeys.has(example), `unregistered example: ${example}`);
    }
  }
  assert.equal(seen.size, EXTENSION_CAPABILITIES.length);

  const shortcutRead = CAPABILITY_CATALOG.find((row) => row.capability === "shortcuts.read");
  assert.ok(shortcutRead);
  assert.equal(shortcutRead.risk, "read");
  assert.deepEqual(shortcutRead.examples, []);
  assert.equal(
    methodsForCapability("shortcuts.read").some((entry) => entry.writesHostState),
    false,
  );

  const grantable = EXTENSION_CAPABILITIES.filter((capability) => capability !== "host.patch");
  assert.equal(CAPABILITY_CONSENT_ROWS.length, grantable.length);
  assert.equal(CAPABILITY_CONSENT_ROWS.length, 33);
  assert.deepEqual(
    CAPABILITY_CONSENT_ROWS.map((row) => row.capability),
    grantable,
  );
});

test("consentRowsFor keeps only declared capabilities", () => {
  const rows = consentRowsFor(["chart.read", "document.write", "host.patch"]);
  assert.deepEqual(
    rows.map((row) => row.capability),
    ["chart.read", "document.write"],
  );
  assert.equal(methodsForCapability("shortcuts.read").length, 0);
});
