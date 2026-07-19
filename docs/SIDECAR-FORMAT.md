# OKF+ 2.3 Sidecar Boundary

Reserved sidecar locations are:

```text
.okf/assessments/<uid>.assessment.yaml
.okf/proposals/<proposal-id>.yaml
.okf/decisions/<decision-id>.yaml
.okf/diagnostics/<uid>.diagnostics.yaml
.okf/policy/
.okf/schema/
.okf/cache/
```

Beta.11 assessments and validation are in-memory read projections. REST and MCP
never write these paths. Existing migration and enrichment artifacts are
written only by explicit user commands through their existing hash-bound and
backup-protected workflows.

A future general sidecar writer must use deterministic paths, reject absolute
or traversing paths, write atomically, report the exact destination, preserve
origin, bind the target UID and input hash, and never represent a proposal as a
decision. Partial files must not survive a failed write.
