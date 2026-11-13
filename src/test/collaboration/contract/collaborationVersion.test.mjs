/** Checks the collaboration version direction helpers used for admission copy. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  compareProductVersions,
  versionMismatchCode,
  versionMismatchMessage,
} from "../../../core/collaboration/version.ts";

test("dotted product versions compare numerically", () => {
  assert.equal(compareProductVersions("1.0.7", "1.0.7"), 0);
  assert.equal(compareProductVersions("1.0.10", "1.0.9"), 1);
  assert.equal(compareProductVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareProductVersions("2.0", "2.0.0"), 0);
  assert.equal(compareProductVersions("1.0.6", "1.0.7"), -1);
});

test("pre-release and build suffixes do not change the direction", () => {
  assert.equal(compareProductVersions("1.0.7-beta.1", "1.0.7"), 0);
  assert.equal(compareProductVersions("v1.0.9", "1.0.7"), 1);
  assert.equal(compareProductVersions("1.0.6+42", "1.0.7"), -1);
});

test("unparsable versions report an unknown direction", () => {
  assert.equal(compareProductVersions("preview", "1.0.7"), 0);
  assert.equal(versionMismatchCode("1.0.7", "preview"), "version_mismatch_unknown");
  assert.equal(versionMismatchCode("1.0.7", ""), "version_mismatch_unknown");
});

test("mismatch codes name which client is out of date", () => {
  assert.equal(versionMismatchCode("1.0.7", "1.0.9"), "version_mismatch_client_newer");
  assert.equal(versionMismatchCode("1.0.7", "1.0.6"), "version_mismatch_client_older");
  assert.equal(versionMismatchCode("1.0.7", "1.0.9-beta"), "version_mismatch_client_newer");
});

test("mismatch messages state the remedy for each direction", () => {
  const newer = versionMismatchMessage("1.0.7", "1.0.9");
  assert.match(newer, /Ask the host to update RPE Redux/);
  assert.match(newer, /newer \(1\.0\.9\)/);

  const older = versionMismatchMessage("1.0.7", "1.0.6");
  assert.match(older, /Update RPE Redux/);

  const generic = versionMismatchMessage("1.0.7", "preview");
  assert.match(generic, /Both copies must use the same version/);
});
