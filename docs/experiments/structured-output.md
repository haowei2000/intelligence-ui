# Structured output experiment (P0 gate)

Question: do providers' structured output modes accept the canonical recursive document schema
(`protocol/ui-document.schema.json`), and do the results validate for the reference scenarios?

Gate: at least three providers, each passing in at least one mode (canonical schema, or a documented
adapter such as JSON mode plus validation and repair). Harness: `scripts/structured-output-experiment.mjs`.

## Run 1 — 2026-10-22

Contract: deployment contract with `submit-plan` and `refresh-prices`. Three scenarios (trip card, hotel
table in tabs, conditional settings form), three runs each. Instructions from `instructions(contract)`
were the only system prompt.

| Vendor | Model | Mode | Runs | Valid | Inconclusive | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Zhipu GLM | glm-5.3 | strict `json_schema` (canonical schema) | 9 | 9 | 0 | Schema accepted; all valid |
| Zhipu GLM | glm-5.3 | `json_object` | 9 | 8 | 0 | One invalid |
| Zhipu GLM | glm-5.3-flash | `json_object` | 9 | 8 | 1 (5-minute timeout) | All completed runs valid |

The one invalid output placed `defaultTab` outside the Tabs component and omitted `type` on one child
(`UNKNOWN_PROPERTY /defaultTab`, `MISSING_PROPERTY /root/children/1/type`). Neither is a deterministic fix;
both are reported as diagnostics the Agent repair loop can act on.

Findings:

- The recursive schema with a 17-way `oneOf` is accepted by GLM's strict mode and removes structural
  errors entirely for these scenarios.
- Without schema enforcement, roughly 1 in 9 outputs needs a model repair turn, which the protocol's
  diagnostics support.

Status: **incomplete — 1 of 3 providers tested (passed).** DeepSeek, Z.ai and Xiaomi MiMo keys available in
the environment were rejected as invalid. The recursive schema remains the planned direction; the gate
closes after two more providers pass.
