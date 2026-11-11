/** Checks collaboration drafts survive reopening either collaboration surface. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeCollaborationSettings,
  readCollaborationSettings,
} from "../../../frontend/screens/editor/workspace/collaboration/collaborationSettings.ts";

const defaults = {
  serverUrl: "ws://127.0.0.1:47830",
  displayName: "Member 1234",
  color: "#77b7ff",
  hostMode: "tunnel",
  lanPort: "",
  joinPassword: "",
  joinMethod: "link",
  joinLink: "",
};

test("collaboration drafts keep the endpoint and join password after reopening", () => {
  const stored = mergeCollaborationSettings(null, {
    serverUrl: "wss://room.example.com:47831",
    displayName: "QiruNos",
    color: "#ff8fa3",
    joinPassword: "secret42",
    joinMethod: "custom",
    joinLink: "https://example.test/join",
  });

  assert.deepEqual(readCollaborationSettings(stored, defaults, defaults), {
    ...defaults,
    serverUrl: "wss://room.example.com:47831",
    displayName: "QiruNos",
    color: "#ff8fa3",
    joinPassword: "secret42",
    joinMethod: "custom",
    joinLink: "https://example.test/join",
  });
});
