# Deferred: Standalone OKF+ 2.3 Engine and Agentic Service

Status: **filed for a later development cycle**. This work is not part of the
Vault Kosmos 0.6.5-beta.9 plugin release.

## Objective

Extract the deterministic OKF+ reader, validator, projector, and assessor from
the Obsidian plugin into a standalone application/package. Make its governed
read-only operations available through a local API and MCP. Keep any agentic
reviewer as a separate, optional process that can submit proposals but cannot
silently modify authoritative source data.

## Required boundaries

- The deterministic engine must run without a model, network connection, or
  Obsidian runtime.
- Parsing, validation, relationship resolution, policy hashing, assessment,
  diagnostics, and effective-state projection remain deterministic.
- Source-authored tags and governed labels remain distinct.
- Proposed values never enter effective state without an accepted authority
  decision.
- The agentic service may recommend derived or proposed labels, relationships,
  and review actions only through proposal sidecars or an equivalent governed
  envelope.
- The deterministic engine must validate every agent-produced envelope before
  it is exposed to a writer or reviewer.
- Remote schema/policy acquisition is disabled by default; installed versions
  must be identifiable and hash-verifiable.
- Obsidian becomes one client/adapter, not the owner of engine semantics.

## Candidate deployment shapes

1. A local standalone desktop/service application exposing REST and MCP.
2. A reusable core package embedded by the plugin plus a separately launched
   MCP process.
3. Both, sharing one conformance-tested deterministic core.

The implementation decision should be made after measuring packaging,
cross-platform process management, local authentication, and update behavior.

## Minimum deliverables

- versioned standalone engine package and command-line entry point;
- file-system/vault input adapter with explicit access scope;
- read-only REST and MCP surface for validate, assess, diagnostics, labels,
  evidence, relationships, policy identity, and corpus assessment;
- optional agentic reviewer service with proposal-only output;
- Obsidian connector that can use the embedded engine or configured local MCP
  service without changing results;
- signed or hash-pinned schema/policy installation design;
- migration and rollback plan from the beta.9 embedded implementation;
- conformance fixtures proving identical deterministic output across embedded,
  CLI, REST, and MCP paths;
- threat model covering local tokens, LAN exposure, prompt injection, proposal
  provenance, authority verification, and sensitive-data filtering.

## Acceptance criteria

- Identical source bytes plus engine/policy versions produce identical
  projections and assessment values through every adapter.
- The service can operate entirely offline.
- An agent cannot approve its own proposal, lower sensitivity, promote an
  epistemic state, change authoritative lineage, or authorize operational use.
- No proposed item appears in effective state without a verified external
  authority decision.
- The Obsidian plugin remains usable when the optional agentic service is
  absent.
- Compatibility and native OKF+ 2.3 fixtures pass in both embedded and
  standalone modes.

## First task when resumed

Write an architecture decision record comparing embedded-library, child-process,
and always-on local-service deployment. Select the process boundary before
moving code so that API ownership and release/version coupling are explicit.
