# Kosmos Governed Context Projection (KGCP)

KGCP is Kosmos-Oden's deterministic, agent-facing projection of an Obsidian vault. It is the formal name for the built-in Graphiti-like operability that does not require Graphiti, a graph database, embeddings, or an LLM.

KGCP provides UID-first identity, explicit typed relationships, canonical lineage, point-in-time state, sensitivity filtering, OKF+ v2.3 governance origins, assessments, diagnostics, lexical search, REST, MCP, and reproducible Graphiti adapter episodes. Source notes remain authoritative.

Graphiti is optional. The `okf-plus-graphiti/2.3.0` adapter turns KGCP records into chronological JSON episodes and authored `fact_triple` episodes. Graphiti may then infer entities, facts, communities, and semantic retrieval indexes. Those results are derived proposals and must never be imported into authored OKF+ fields. A future import workflow may store them only as derived/proposal sidecars requiring review.

## Time model

- `created_at`: preserved creation/event time, ISO-8601 UTC with `Z`.
- `updated_at`: last Obsidian modification time, ISO-8601 UTC with `Z`.
- `reference_time`: Graphiti event time, normally `created_at`.
- `processing_time`: Kosmos indexing/export time.
- Graphiti ingestion time remains Graphiti-owned.

The plugin maintains `created_at` and `updated_at` when portable timestamping is enabled. `.obsidian/` and `.okf/` are excluded and write-loop suppression prevents timestamp updates from recursively stamping themselves.

## Graphiti 0.29 contract

Kosmos-Oden tests against `graphiti-core==0.29.0` and requires a security floor of 0.28.2. The generated Python script uses the awaited core API; its return is the direct-ingestion readiness boundary. Graphiti MCP queue acceptance is not treated as searchable readiness because upstream does not expose a documented per-job completion contract.

Combined extraction is experimental and disabled by default. In 0.29.0 it is available only through `extract_nodes_and_edges_bulk(..., use_combined_extraction=True)`, not public `add_episode`/`add_episode_bulk`. A trial must record token cost, ingestion duration, entity recall, and edge accuracy against authored fact-triple fixtures. Null means not measured.

`episode_metadata` is included in the adapter envelope and episode body/filter contract. Graphiti 0.29's `EpisodicNode` supports it, but the tagged public add APIs do not accept it directly; the generated profile states this limitation instead of silently dropping provenance.

FalkorDB is preferred for easy local operation and Neo4j for mature deployments. New Kuzu deployments are unsupported because upstream has deprecated Kuzu.
