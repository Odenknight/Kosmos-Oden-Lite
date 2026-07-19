/** Host↔renderer protocol validation tests (Doc1 §3.4, Doc2 §5.7). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  KOSMOS_PROTOCOL,
  KOSMOS_PROTOCOL_VERSION,
  validateHostMessage,
  validateRendererMessage,
  wrap,
} from "../dist/kosmos-protocol.mjs";

test("wrap produces a versioned envelope", () => {
  const m = wrap("vault-snapshot", { files: [] });
  assert.equal(m.protocol, KOSMOS_PROTOCOL);
  assert.equal(m.version, KOSMOS_PROTOCOL_VERSION);
  assert.equal(m.type, "vault-snapshot");
});

test("valid snapshot accepted", () => {
  const r = validateHostMessage(wrap("vault-snapshot", {
    files: [{ relativePath: "Notes/A.md", content: "hi" }], folders: ["Notes"], attachments: [],
  }));
  assert.equal(r.ok, true);
});

test("valid delta accepted", () => {
  const r = validateHostMessage(wrap("vault-delta", {
    changed: [{ relativePath: "A.md", content: "x" }], removed: ["B.md"], renames: [{ from: "C.md", to: "D.md" }],
  }));
  assert.equal(r.ok, true);
});

test("foreign messages ignored silently (no reason)", () => {
  assert.deepEqual(validateHostMessage(null), { ok: false });
  assert.deepEqual(validateHostMessage({ type: "kosmos:files" }), { ok: false });
  assert.deepEqual(validateHostMessage({ protocol: "something-else", version: 1 }), { ok: false });
});

test("unknown protocol version rejected with a reason", () => {
  const r = validateHostMessage({ protocol: KOSMOS_PROTOCOL, version: 999, type: "vault-snapshot", payload: { files: [] } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unsupported protocol version/);
});

test("unknown message type rejected with a reason", () => {
  const r = validateHostMessage(wrap("do-evil", {}));
  assert.equal(r.ok, false);
  assert.match(r.reason, /unsupported message type/);
});

test("path traversal / absolute paths rejected in snapshots", () => {
  for (const bad of ["../secret.md", "/etc/passwd.md", "C:\\Windows\\x.md", "sub/../../x.md"]) {
    const r = validateHostMessage(wrap("vault-snapshot", { files: [{ relativePath: bad, content: "x" }] }));
    assert.equal(r.ok, false, `should reject ${bad}`);
    assert.match(r.reason, /malformed or unsafe path/);
  }
});

test("path traversal rejected in delta removed/renames", () => {
  assert.equal(validateHostMessage(wrap("vault-delta", { removed: ["../x.md"] })).ok, false);
  assert.equal(validateHostMessage(wrap("vault-delta", { renames: [{ from: "a.md", to: "/abs.md" }] })).ok, false);
});

test("malformed payloads rejected", () => {
  assert.match(validateHostMessage(wrap("vault-snapshot", { files: "nope" })).reason, /must be an array/);
  assert.match(validateHostMessage({ protocol: KOSMOS_PROTOCOL, version: 1, type: "vault-snapshot" }).reason, /missing payload/);
});

test("visibility (host->renderer): boolean accepted, non-boolean rejected", () => {
  assert.equal(validateHostMessage(wrap("visibility", { visible: false })).ok, true);
  assert.equal(validateHostMessage(wrap("visibility", { visible: true })).ok, true);
  const bad = validateHostMessage(wrap("visibility", { visible: "yes" }));
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /must be a boolean/);
});

test("agent-traversal (host->renderer): valid accepted, unsafe paths rejected", () => {
  const ok = validateHostMessage(wrap("agent-traversal", { paths: ["Ideas/Engine v2.md"], tool: "get_note" }));
  assert.equal(ok.ok, true);
  const bad = validateHostMessage(wrap("agent-traversal", { paths: ["../secret.md"], tool: "get_note" }));
  assert.equal(bad.ok, false);
  const noTool = validateHostMessage(wrap("agent-traversal", { paths: ["a.md"], tool: 5 }));
  assert.equal(noTool.ok, false);
});

test("renderer->host: open-note and open-folder accepted; unsafe/foreign rejected", () => {
  assert.equal(validateRendererMessage(wrap("open-note", { path: "Ideas/Engine v2.md", label: "Engine v2" })).ok, true);
  assert.equal(validateRendererMessage(wrap("open-folder", { path: "Ideas" })).ok, true);
  assert.equal(validateRendererMessage(wrap("open-folder", { path: "../etc" })).ok, false);
  assert.deepEqual(validateRendererMessage({ type: "kosmos:open", path: "a.md" }), { ok: false }); // not ours
  assert.match(validateRendererMessage(wrap("delete-everything", {})).reason, /unsupported message type/);
});
