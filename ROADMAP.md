# KRS-Lite maintenance policy

**Lifecycle:** Frozen Core Edition, maintained on the `1.0.x` line.

This repository has no forward feature roadmap. Its purpose is to preserve
established behavior and note compatibility for existing users.

## Permitted changes

- Security fixes.
- Defect and data-integrity repairs.
- Compatibility corrections required to keep supported environments usable.
- Build, release, dependency, and documentation hygiene.
- Selective upstream backports that preserve frozen behavior.

## Excluded changes

- New product capabilities or governance semantics.
- Automatic adoption of current GKOS-Engine releases.
- Feature parity with Kosmos Research Studio (main).
- Breaking data-model, plugin-identity, or workflow changes.
- Use as evidence of a second independent GKOS implementation.

Every backport must identify its upstream source, explain why it fits this
policy, include regression evidence, and update `VERSIONING.md` when the
declared baseline or approved differences change.

New capabilities and architectural expansion belong in
[Kosmos Research Studio](https://github.com/Odenknight/Kosmos-Oden). Normative
and GKX contract changes belong in
[gkos-standard](https://github.com/Odenknight/gkos-standard).
