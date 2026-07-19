# OKF+ 2.3 Assessment Scoring

The deterministic assessment reports:

| Dimension | Weight |
|---|---:|
| Structural completeness | 0.15 |
| Provenance quality | 0.20 |
| Evidence support | 0.20 |
| Relationship integrity | 0.15 |
| Temporal freshness | 0.10 |
| Contradiction status | 0.10 |
| Review readiness | 0.10 |

Every dimension is `0..1` or `null`. Null means not assessable and is excluded
under the bundled policy; remaining weights are renormalized. Evidence uses
explicit strength and relevance, policy-mapped source quality, and the maximum
item in each independence group before bounded product aggregation. Missing
evidence never becomes invented evidence.

The overall label ranges from `assessment:strongly-documented` to
`assessment:invalid-or-untraceable`, or `assessment:not-assessable`. These
labels measure documentation and support quality only. They do not certify
truth, consensus, approval, authority, safety, or permitted use.

Every result includes the policy ID/version/hash, engine version, input hash,
component scores, null exclusions, deterministic calculation time, diagnostics,
and the interpretation `documentation-and-support-quality-not-truth`.

