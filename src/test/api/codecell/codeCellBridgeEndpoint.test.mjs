/** Code Cell endpoint file parsing and bridge URL construction. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  codeCellBridgeUrl,
  parseCodeCellEndpointFile,
} from "../../../core/edit/codecell/bridgeEndpoint.ts";

test("endpoint parsing accepts only a non-empty token", () => {
  assert.equal(
    parseCodeCellEndpointFile(JSON.stringify({ version: 1, token: "session-token" })),
    "session-token",
  );
  assert.equal(parseCodeCellEndpointFile("not json"), null);
  assert.equal(parseCodeCellEndpointFile(JSON.stringify({ version: 1, token: "" })), null);
  assert.equal(parseCodeCellEndpointFile(JSON.stringify({ version: 1, token: 7 })), null);
});

test("bridge URL uses the Code Cell path and preserves the token", () => {
  assert.equal(
    codeCellBridgeUrl("http://127.0.0.1:47822", "a b&c"),
    "ws://127.0.0.1:47822/api/cell/bridge?token=a+b%26c",
  );
});
