/** Pins the backend port shown in the document occupancy prompt. */
import assert from "node:assert/strict";
import test from "node:test";
import { originPort } from "../../../frontend/screens/editor/workspace/document/open/documentLease.ts";

test("originPort reads the explicit loopback port", () => {
  assert.equal(originPort("http://127.0.0.1:47821"), 47821);
  assert.equal(originPort("http://localhost:44058"), 44058);
});

test("originPort falls back to the scheme default and rejects malformed origins", () => {
  assert.equal(originPort("http://127.0.0.1"), 80);
  assert.equal(originPort("https://example.com"), 443);
  assert.equal(originPort("not a URL"), 0);
});
