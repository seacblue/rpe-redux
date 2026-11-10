/**
 * Frame codec tests: split boundaries, raw line text, and JSON frames.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ChartFrameDecoder,
  decodeJsonFrame,
  decodeLineFrame,
  decodeLinesFrame,
  encodeJsonFrame,
  encodeLineFrame,
  encodeLinesFrame,
} from "../../../core/global/chart/streaming/chartStreamCodec.ts";
import { CHART_FRAME } from "../../../core/global/chart/streaming/chartStreamTypes.ts";

test("decoder reassembles frames split at every byte boundary", () => {
  const first = encodeJsonFrame(CHART_FRAME.header, { META: { name: "A" } });
  const second = encodeLineFrame(3, '{"Name":"Line 3"}');
  const all = new Uint8Array(first.length + second.length);
  all.set(first);
  all.set(second, first.length);
  const decoder = new ChartFrameDecoder();
  const frames = [];
  for (const byte of all) {
    frames.push(...decoder.push(new Uint8Array([byte])));
  }
  assert.equal(frames.length, 2);
  assert.deepEqual(decodeJsonFrame(frames[0]), { META: { name: "A" } });
  assert.deepEqual(decodeLineFrame(frames[1]), { index: 3, raw: '{"Name":"Line 3"}' });
});

test("line batch frames preserve start, count, and raw array text", () => {
  const frame = encodeLinesFrame(4, 2, '[{"Name":"A"},{"Name":"B"}]');
  const decoder = new ChartFrameDecoder();
  const frames = decoder.push(frame);
  assert.equal(frames.length, 1);
  assert.deepEqual(decodeLinesFrame(frames[0]), {
    start: 4,
    count: 2,
    raw: '[{"Name":"A"},{"Name":"B"}]',
  });
});
