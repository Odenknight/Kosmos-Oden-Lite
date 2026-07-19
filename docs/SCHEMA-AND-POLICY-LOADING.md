# OKF+ 2.3 Schema and Policy Loading

Beta.11 bundles one immutable v2.3 validating-projection contract and the
read-only `policy:okf23-default-v1` policy. `get_policy` and `/okf/policy`
report its version, hash, and trust state. A 2.3 note is never silently
validated as 2.2; older notes enter compatibility mode.

Remote schema and policy updates are disabled and are not implemented in this
release. No REST or MCP route installs or activates schemas.

Before local or remote package loading can be enabled, it must verify manifest,
engine compatibility, checksums, and required signatures; cap bytes and file
count; reject traversal, symlinks, executables, and scripts; validate in an
isolated staging location; activate atomically only after conformance passes;
preserve the previous version; and support explicit pinning and rollback.
Network failure or validation failure must leave the active package unchanged.
