/** Code Cell activity retention and settlement behaviour. */
import assert from "node:assert/strict";
import test from "node:test";
import { CodeCellActivityLog } from "../../../core/edit/codecell/activity.ts";

test("activity entries settle with a duration and status", () => {
  let now = 100;
  const log = new CodeCellActivityLog({ now: () => now });
  const handle = log.begin({ method: "cell.run", params: { source: "return 1;" } });
  now = 145;
  handle.finish({ ok: true, value: { ok: true } });
  assert.equal(log.get().length, 1);
  assert.equal(log.get()[0].method, "cell.run");
  assert.equal(log.get()[0].status, "ok");
  assert.equal(log.get()[0].durationMs, 45);
});

test("activity entries are bounded by count", () => {
  const log = new CodeCellActivityLog({ now: () => 1, limit: 2 });
  for (let index = 0; index < 3; index += 1) {
    const handle = log.begin({ method: "cell.run", index });
    handle.finish({ ok: true });
  }
  assert.equal(log.get().length, 2);
  assert.equal(log.get()[0].request.index, 2);
});
