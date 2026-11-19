# What 5.0.0 does not do yet

Each item here is a row in the findings ledger (`docs/quality/findings-ledger.json`), with an
owner and the condition that closes it. None of them is a Blocker or a Critical.

| Area             | Limitation                                                                                                                                              | Ledger    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Connectors       | Every connector is proven against a fake built from its documentation, not yet against a real account. [Help raise one](connectors.md).                 | —         |
| AI-written code  | Attribution comes from GitHub delivery sync only. A GitLab or self-hosted repository shows attribution as unknown, never as human.                      | —         |
| Failure causes   | Causes are grouped by a deterministic error signature. There is no AI summary of a cause yet.                                                           | —         |
| Test categories  | A plain JUnit upload is recorded and counted, but the QA score places a result in a row only when it names a category (a detected or declared command). | REL-5     |
| Agent domains    | Security and mobile agent runs answer `501 AGENT_NOT_CONFIGURED`.                                                                                       | BK-2      |
| Evals            | Pooled attempts can overstate how significant an eval change is.                                                                                        | W7-22     |
| Measured quality | Four of five measured-quality clauses have no measurement yet, and the complexity ceiling is 15, not 10.                                                | Q-1       |
| Dashboard schema | A third of the dashboard schema is not reachable from a screen.                                                                                         | C-6       |
| Vault            | Boot-time vault rotation re-seals the installation workspace only.                                                                                      | W7-23     |
| Runtime          | Node 26 is not supported until it is an LTS release; use Node 24.                                                                                       | RUNTIME-1 |
| Database         | PostgreSQL 16 is the supported version; 18 is a later target.                                                                                           | DEP-5     |
