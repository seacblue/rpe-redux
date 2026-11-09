/** Cached update metadata must become a release prompt without another download. */
import assert from "node:assert/strict";
import test from "node:test";
import { releaseFromCachedUpdate } from "../../../frontend/screens/settings/updates/updateStore.ts";

test("a cached installer keeps its release tag and version for the prompt", () => {
  assert.deepEqual(
    releaseFromCachedUpdate(
      { version: "2.1.0", tag: "v2.1.0", prerelease: false, kind: "installer" },
      "acme/rpe",
    ),
    {
      tag: "v2.1.0",
      version: "2.1.0",
      name: "2.1.0",
      notes: "",
      publishedAt: "",
      prerelease: false,
      url: "https://github.com/acme/rpe/releases/tag/v2.1.0",
    },
  );
});

test("a cached release without a stored tag still names a version", () => {
  const release = releaseFromCachedUpdate(
    { version: "2.2.0", tag: " ", prerelease: true, kind: "portable" },
    "",
  );
  assert.equal(release.tag, "v2.2.0");
  assert.equal(release.prerelease, true);
  assert.equal(release.url, "");
});
