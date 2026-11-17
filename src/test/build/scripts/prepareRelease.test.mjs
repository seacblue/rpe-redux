/**
 * Verifies release preparation: one command bumps every product version input,
 * rebuilds the bilingual changelog from the pending Changesets, consumes those
 * Changesets, and refuses a release that would publish stale or repeated notes.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeVersion, prepareRelease } from "../../../../scripts/prepareRelease.mjs";

const CHANGELOG = `# Changelog

Intro text.

## 1.0.11

### 中文

**修复**

- 旧条目。

### English

**Fixes**

- Old entry.
`;

/** Build one throwaway repository tree that carries every release input. */
function createFixture({ version = "1.0.11", changesets = ["first"], changelog = CHANGELOG } = {}) {
  const root = mkdtempSync(join(tmpdir(), "redux-release-test-"));
  mkdirSync(join(root, "src-tauri"), { recursive: true });
  mkdirSync(join(root, ".changeset"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "rpe-redux", version, private: true }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "package-lock.json"),
    `${JSON.stringify(
      {
        name: "rpe-redux",
        version,
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "rpe-redux", version, license: "PolyForm-Noncommercial-1.0.0" },
          "node_modules/zip": { version: "9.5.1" },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "src-tauri", "tauri.conf.json"),
    `${JSON.stringify(
      {
        $schema: "https://schema.tauri.app/config/2",
        productName: "RPE Redux",
        version,
        identifier: "io.rperedux.editor",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "src-tauri", "Cargo.toml"),
    `[package]\nname = "rpe-redux"\nversion = "${version}"\nedition = "2021"\n\n[dependencies]\ntauri = { version = "2", features = [] }\n`,
  );
  writeFileSync(
    join(root, "src-tauri", "Cargo.lock"),
    `version = 4\n\n[[package]]\nname = "rpe-redux"\nversion = "${version}"\ndependencies = []\n\n[[package]]\nname = "tauri"\nversion = "2.0.0"\n`,
  );
  writeFileSync(join(root, "CHANGELOG.md"), changelog);
  writeFileSync(join(root, ".changeset", "README.md"), "# Changesets\n");
  for (const [index, name] of changesets.entries()) {
    writeFileSync(
      join(root, ".changeset", `${name}.md`),
      `---\n"rpe-redux": patch\n---\n\n### 中文\n\n**修复**\n\n- 第 ${index + 1} 条修复。\n\n### English\n\n**Fixes**\n\n- Fix number ${index + 1}.\n`,
    );
  }
  return root;
}

/** Run one preparation against a fixture and clean it up afterwards. */
function withFixture(options, run) {
  const root = createFixture(options);
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Read the release inputs a preparation is expected to keep in agreement. */
function versionsOf(root) {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  return {
    package: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
    lock: lock.version,
    workspace: lock.packages[""].version,
    tauri: JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")).version,
    cargo: /^version = "([^"]+)"/mu.exec(
      readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8"),
    )?.[1],
    cargoLock: /\[\[package\]\]\nname = "rpe-redux"\nversion = "([^"]+)"/u.exec(
      readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8"),
    )?.[1],
  };
}

test("prepares a patch release from the pending changesets", () => {
  withFixture({ changesets: ["first", "second"] }, (root) => {
    const plan = prepareRelease({ root });
    assert.equal(plan.previousVersion, "1.0.11");
    assert.equal(plan.version, "1.0.12");
    assert.equal(plan.bump, "patch");
    assert.deepEqual(plan.consumed, [".changeset/first.md", ".changeset/second.md"]);

    assert.deepEqual(versionsOf(root), {
      package: "1.0.12",
      lock: "1.0.12",
      workspace: "1.0.12",
      tauri: "1.0.12",
      cargo: "1.0.12",
      cargoLock: "1.0.12",
    });
  });
});

test("bumps only the product version and leaves dependency versions alone", () => {
  withFixture({}, (root) => {
    prepareRelease({ root });
    const lock = readFileSync(join(root, "package-lock.json"), "utf8");
    assert.match(lock, /"node_modules\/zip": \{\n\s+"version": "9\.5\.1"/u);
    assert.match(
      readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8"),
      /tauri = \{ version = "2"/u,
    );
    assert.match(
      readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8"),
      /name = "tauri"\nversion = "2\.0\.0"/u,
    );
  });
});

test("consumes the pending changesets and keeps the directory guide", () => {
  withFixture({ changesets: ["first", "second"] }, (root) => {
    prepareRelease({ root });
    assert.equal(existsSync(join(root, ".changeset", "first.md")), false);
    assert.equal(existsSync(join(root, ".changeset", "second.md")), false);
    assert.equal(existsSync(join(root, ".changeset", "README.md")), true);
  });
});

test("rewrites the changelog as one bilingual section that keeps the preamble", () => {
  withFixture({ changesets: ["first", "second"] }, (root) => {
    prepareRelease({ root });
    const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    assert.match(changelog, /^# Changelog\n\nIntro text\.\n\n## 1\.0\.12\n/u);
    assert.equal(changelog.match(/^## /gmu)?.length, 1);
    assert.ok(changelog.indexOf("### 中文") < changelog.indexOf("### English"));
    assert.match(changelog, /- 第 1 条修复。/u);
    assert.match(changelog, /- 第 2 条修复。/u);
    assert.match(changelog, /- Fix number 1\./u);
    assert.match(changelog, /- Fix number 2\./u);
    assert.doesNotMatch(changelog, /1\.0\.11/u);
  });
});

test("derives a minor release from the highest pending bump", () => {
  withFixture({}, (root) => {
    writeFileSync(
      join(root, ".changeset", "feature.md"),
      '---\n"rpe-redux": minor\n---\n\n### 中文\n\n**新功能**\n\n- 新功能。\n\n### English\n\n**Features**\n\n- A feature.\n',
    );
    const plan = prepareRelease({ root });
    assert.equal(plan.bump, "minor");
    assert.equal(plan.version, "1.1.0");
  });
});

test("honours an explicit release version", () => {
  withFixture({}, (root) => {
    const plan = prepareRelease({ root, version: "v2.0.0" });
    assert.equal(plan.version, "2.0.0");
    assert.equal(versionsOf(root).cargo, "2.0.0");
  });
});

test("a dry run reports the same plan without touching the tree", () => {
  withFixture({ changesets: ["first"] }, (root) => {
    const plan = prepareRelease({ root, dryRun: true });
    assert.equal(plan.version, "1.0.12");
    assert.equal(plan.consumed.length, 1);
    assert.equal(versionsOf(root).package, "1.0.11");
    assert.equal(existsSync(join(root, ".changeset", "first.md")), true);
    assert.match(readFileSync(join(root, "CHANGELOG.md"), "utf8"), /## 1\.0\.11/u);
  });
});

test("refuses a release without a pending changeset", () => {
  withFixture({ changesets: [] }, (root) => {
    assert.throws(() => prepareRelease({ root }), /No active Changesets/u);
  });
});

test("refuses a release version that does not move forward", () => {
  withFixture({}, (root) => {
    assert.throws(
      () => prepareRelease({ root, version: "1.0.11" }),
      /must be newer than 1\.0\.11/u,
    );
    assert.throws(() => prepareRelease({ root, version: "1.0.9" }), /must be newer than 1\.0\.11/u);
  });
});

test("refuses a changeset that carries only one language", () => {
  withFixture({ changesets: [] }, (root) => {
    writeFileSync(
      join(root, ".changeset", "half.md"),
      '---\n"rpe-redux": patch\n---\n\n### 中文\n\n**修复**\n\n- 只有中文。\n',
    );
    assert.throws(() => prepareRelease({ root }), /non-empty English section/u);
  });
});

test("rejects a malformed release version", () => {
  assert.equal(normalizeVersion(" v1.2.3 "), "1.2.3");
  assert.throws(() => normalizeVersion("1.2"), /Unsupported release version/u);
  assert.throws(() => normalizeVersion("latest"), /Unsupported release version/u);
});
