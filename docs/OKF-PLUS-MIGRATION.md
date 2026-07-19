# OKF+ Human-Editable Formatting Behavior

Kosmos-Oden beta.12 uses compact flat OKF+ 2.2 Obsidian Properties as the
default human authoring surface. A person can change a tag or relationship
wikilink in the note, and Obsidian's normal metadata-change event updates the
cosmos, search, REST, MCP, and Graphiti projection without a conversion step.
OKF+ 2.3 remains the stricter read-only validating projection unless the user
explicitly chooses native 2.3 conversion.

**Scan and repair** leaves valid editable 2.2 and genuinely authored native 2.3
notes unchanged. It proposes a bounded flat repair only for notes carrying the
deterministic-migration marker written by beta.10. **Convert all to editable
2.2** also onboards mechanically recoverable ordinary, Google OKF, reserved,
and legacy notes. **Convert all to editable 2.3** onboards mechanically
recoverable notes into the flat editable OKF+ 2.3 profile: the same
Obsidian-Properties-safe surface as 2.2 (scalars plus flat quoted-wikilink
lists, with `epistemic_state`, `sensitivity`, and `authorship_origin` as flat
scalars) under `okf_version: "2.3"`. No nested governance blocks are written
into notes; the validating projection supplies spec-permitted in-memory
defaults, and governed values belong in `.okf/` sidecars. Hand-authored nested
2.3 notes remain fully supported by the reader and are never flattened.

Both operations are explicit, previewed, hash-bound, and backup-protected;
scanning alone never rewrites a note. The writer preserves Markdown body bytes,
unknown parseable fields, source tags, and human comments, and rechecks source
hashes before applying. It prohibits automatic epistemic promotion and
sensitivity reduction. Consequential semantic changes still require separate
governed authority.

Projection modes remain:

- `strict-v2.3`: authored 2.3 source (nested or flat editable profile),
  preserved without rewriting;
- `compatible`: versioned flat 2.2 source projected without rewrite; and
- `legacy`: unversioned recognizable metadata projected conservatively.
