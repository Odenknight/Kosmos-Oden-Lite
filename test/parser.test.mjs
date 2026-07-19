/** Parser tests (§24): frontmatter, aliases, tags, links, Related footer, attachments, invalid timestamps. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGraph,
  isAttachmentPath,
  isNotePath,
  parseFrontmatter,
  parseMarkdownFile,
  parseMarkdownLinks,
  parseOkfPlus,
  parseWikiLinks,
} from "../dist/kosmos-core.mjs";

test("frontmatter: scalars, block lists, inline lists, quotes, comments", () => {
  const raw = `---
title: "My Note"
type: idea
count: 3
tags: [alpha, beta]
aliases:
  - First Alias
  - 'Second Alias'
status: draft # trailing comment
---
Body text.`;
  const { data, content } = parseFrontmatter(raw);
  assert.equal(data.title, "My Note");
  assert.equal(data.type, "idea");
  assert.deepEqual(data.tags, ["alpha", "beta"]);
  assert.deepEqual(data.aliases, ["First Alias", "Second Alias"]);
  assert.equal(data.status, "draft");
  assert.equal(content, "Body text.");
});

test("frontmatter: UTF-8 BOM must not break parsing (Windows editors)", () => {
  const raw = "﻿---\ntype: idea\n---\nBody";
  const { data, content } = parseFrontmatter(raw);
  assert.equal(data.type, "idea");
  assert.equal(content, "Body");
});

test("frontmatter: CRLF line endings", () => {
  const raw = "---\r\ntype: idea\r\ntags: [a]\r\n---\r\nBody";
  const { data, content } = parseFrontmatter(raw);
  assert.equal(data.type, "idea");
  assert.deepEqual(data.tags, ["a"]);
  assert.equal(content, "Body");
});

test("frontmatter: absent or unterminated stays inert", () => {
  assert.deepEqual(parseFrontmatter("No header").data, {});
  assert.deepEqual(parseFrontmatter("---\nbroken: yes").data, {});
});

test("wikilinks: targets, aliases, headings, embeds", () => {
  const links = parseWikiLinks("See [[Target Note]] and [[Other|shown]] and [[Deep#Section]] and ![[image.png]]");
  assert.deepEqual(links.map((l) => l.target), ["Target Note", "Other", "Deep", "image.png"]);
  assert.equal(links[1].alias, "shown");
  assert.equal(links[2].heading, "Section");
});

test("markdown links: local resolved, external skipped, images skipped", () => {
  const links = parseMarkdownLinks("[a](Notes/A.md) [b](https://example.com) [c](<sub/B%20C.md>) ![img](pic.png)");
  assert.deepEqual(links.map((l) => l.target), ["Notes/A.md", "sub/B C.md"]);
});

test("tags + aliases normalize from every YAML shape", () => {
  const p = parseMarkdownFile("---\ntags: '#one, two'\naliases: [X, Y]\n---\nBody");
  assert.deepEqual(p.tags, ["one", "two"]);
  assert.deepEqual(p.aliases, ["X", "Y"]);
});

test("OKF+: Related footer produces semantic targets", () => {
  const { data, content } = parseFrontmatter("---\ntype: idea\n---\nBody\n\n**Related:** [[A]], [[B|alias]]");
  const okf = parseOkfPlus(data, content);
  assert.ok(okf);
  assert.deepEqual(okf.related, ["A", "B"]);
});

test("OKF+ 2.2: flat governance fields and canonical wikilink lists parse", () => {
  const { data, content } = parseFrontmatter(`---
okf_version: "2.2"
uid: "7f3a9c1e-4b2d-4e8a-9c6f-1d5e8a2b7c4d"
type: semantic
title: Engine
description: Governed engine note
timestamp: 2026-07-01T00:00:00Z
epistemic_state: verified_inference
scope: project
scope_id: kosmos
sensitivity: confidential
supersedes:
  - "[[Engine v1]]"
forked_by:
  - "[[Alternative]]"
depends_on:
  - "[[Ledger]]"
related_to:
  - "[[Fuel]]"
---
Body`);
  const okf = parseOkfPlus(data, content);
  assert.equal(okf.okfVersion, "2.2");
  assert.equal(okf.uid, "7f3a9c1e-4b2d-4e8a-9c6f-1d5e8a2b7c4d");
  assert.equal(okf.description, "Governed engine note");
  assert.equal(okf.epistemicState, "verified_inference");
  assert.equal(okf.scopeId, "kosmos");
  assert.equal(okf.sensitivity, "confidential");
  assert.deepEqual(okf.supersedes, ["Engine v1"]);
  assert.deepEqual(okf.forkedTo, ["Alternative"]); // forked_by read compatibility
  assert.deepEqual(okf.relations.depends_on, ["Ledger"]);
  assert.deepEqual(okf.related, ["Fuel"]);
});

test("OKF+: absent markers -> null; invalid timestamp -> fallback validAt", () => {
  const { data, content } = parseFrontmatter("---\nunrelated: x\n---\nBody");
  assert.equal(parseOkfPlus(data, content), null);

  // invalid timestamp: node falls back to file times, never NaN/crash (§24)
  const graph = buildGraph(
    [{ relativePath: "a.md", content: "---\ntype: idea\ntimestamp: not-a-date\n---\nx", modifiedTime: 1700000000000, createdTime: 1690000000000 }],
    []
  );
  const node = graph.nodes.find((n) => n.id === "file:a.md");
  assert.equal(node.validAt, new Date(1690000000000).toISOString());
});

test("attachment vs note classification", () => {
  assert.ok(isNotePath("x/y.md"));
  assert.ok(isNotePath("x/y.markdown"));
  assert.ok(!isNotePath("x/y.png"));
  assert.ok(isAttachmentPath("x/y.png"));
  assert.ok(isAttachmentPath("deck.pdf"));
  assert.ok(!isAttachmentPath("note.md"));
});

test("buildGraph: property links from frontmatter relations", () => {
  const graph = buildGraph(
    [
      { relativePath: "a.md", content: "---\nproject: '[[B]]'\n---\nx" },
      { relativePath: "B.md", content: "b" },
    ],
    []
  );
  const prop = graph.links.find((l) => l.kind === "property");
  assert.ok(prop);
  assert.equal(prop.source, "file:a.md");
  assert.equal(prop.target, "file:B.md");
});
