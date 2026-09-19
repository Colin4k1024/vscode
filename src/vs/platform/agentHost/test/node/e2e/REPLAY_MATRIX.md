# Codex Desktop replay acceptance matrix

D11 (#13) extends the 103 committed Codex replay captures into an acceptance
matrix that covers this product's promised capabilities, keeps the run
tokenless / networkless / deterministic, and makes every gap explicit instead
of silent. This file is the registry for that matrix: what is covered where,
what is deliberately live-only, what is a known gap, and which captures are
pending on not-yet-shipped behavior.

Authoritative harness documentation lives in the [README](./README.md); active
gated tests live in [KNOWN_ISSUES.md](./KNOWN_ISSUES.md). This file registers
*coverage decisions*, not test authoring guidance.

---

## Harness-integrity guarantees (executable, not documented)

The record/replay contract itself is part of the acceptance matrix. Three
scenarios in `providers/codexReplayMatrixAgentHostE2E.integrationTest.ts`
deliberately trigger each failure mode and assert the harness reports it:

| Guarantee | Scenario | Failure mode it pins down |
|---|---|---|
| Strictness (D14) | `an unrecorded model request fails the suite run` | A model request with no recorded response must surface as `[capi-replay] … cache miss(es): POST /responses (call #1) — no recorded response`, never as a silent pass or an upstream contact. |
| Completeness (D14) | `a provider that stops early fails on its unconsumed recorded responses` | A fixture exchange left unconsumed at teardown must fail with `unconsumed recorded responses: POST /responses: 1 response(s)`, so a provider that stops early cannot pass by leaving fixtures unused. |
| Isolation (D13) | `ambient CODEX_HOME override stays isolated from the suite codex home` | With `CODEX_HOME` exported to a probe directory (canary invalid `config.toml` + before/after snapshot), the server must confine codex to the lease's temp home; the probe is never written and the turn still completes. |

## Acceptance-core B-section coverage

Negative scenarios from `.agents/research/codex-desktop/01-ACCEPTANCE-CORE.md`
§B. "Covered" rows run in strict replay inside
`providers/codexReplayMatrixAgentHostE2E.integrationTest.ts` unless another
entry point is named.

| # | Scenario | Status | Where |
|---|---|---|---|
| B1 | Codex binary not executable | **covered** (host-only replay; skipped on Windows — `access(X_OK)` cannot distinguish a non-executable regular file there) | `a codex sdk root with a non executable binary fails sessions with an actionable error` — asserts the `Codex binary not executable: <path>` error over AHP, the host stays alive, and a Copilot session still materializes on the same server. |
| B2 | No `product.agentSdks.codex`, no env override (factory build) | **covered for its AHP-observable slice** (host-only replay) | `a host without a codex sdk root keeps codex unregistered while healthy providers keep working` — codex absent from the root agent catalog, `createSession` fails with an error naming the provider, healthy providers unaffected. Not replay-assertable from a source checkout: the repo `node_modules` dev fallback resolves the SDK even without configuration (by design), and the downloader's `no \`product.agentSdks.codex\` configured` text plus the deferred-migration marker are not AHP-observable (principle 1 forbids reading host state). |
| B7 | Connection replaced (`CodexConnectionReplacedError`) | **live-only** | A stale result from a replaced app-server connection must race the replacement's `generation`; the interleaving is not schedulable over AHP and cannot be reproduced from fixtures. Needs the real app-server (live) or a host-side unit test with a scripted connection once such a seam exists. |
| B8 | JSON-RPC `-32001 Server overloaded` backoff | **known gap (implementation absent)** | `src/vs/platform/agentHost/node/codex/` has no `-32001` handling to exercise (finding G14): there is no retry-with-backoff path to assert. Driving it through e2e would require a fake binary impersonating the codex app-server, which the harness's "real bundled SDK subprocess" boundary excludes. Revisit as a unit test with a scripted app-server client when retry is implemented. |
| B16 | MCP server startup failure / OAuth expiry | **covered** (model-backed replay) | `a broken plugin MCP server surfaces a startup error without blocking the turn` — plugin `.mcp.json` server exits before the handshake; asserts `McpServerStatus.Error` + `mcp-server-failed` in customization state and that the recorded turn still completes. OAuth-expiry (`reauthenticationRequired`) needs a real OAuth flow: live-only. |
| B17 | Elicitation with unknown semantic input | **covered** (model-backed replay) | `an elicitation with an unsupported mode waits for the user instead of erroring` — plugin MCP server elicits with `mode: "openai/form"`; asserts a message-only `chat/inputRequested` (no partial form), no JSON-RPC error, and a completed turn after the user cancels. |
| B18 | Dynamic tool response with empty body | **covered** (model-backed replay) | `a dynamic tool result with no output still completes the turn` — client completes `return_nothing` with `content: []` and no past-tense summary; codex rejects empty tool bodies, so a completed turn proves the host backfilled a non-empty one. |
| B25 | Cancel a turn paused for input, then start a replacement | **covered (pre-existing)** | Capture `captures/codex-cancelling-a-turn-paused-for-input-allows-a-replacement-turn.yaml`, gated by `supportsPausedTurnCancellationE2E` in the shared suite. Registered here for completeness; no new capture needed. |
| B28 | Disk full / `agent-host.db` write failure | **known gap (no deterministic seam)** | `_persistDefaultChatBacking`'s two independent writes (I5) are not reachable through a fault-injection point on the AHP boundary; simulating disk-full via filesystem tricks would wedge shared host state and assert implementation timing. Belongs to a unit test with a failing storage service. |

## Live-only scenarios

Scenarios that can only run against the real app-server
(`AGENT_HOST_REAL_CODEX=1`, `providers/codexAgentHostLive.integrationTest.ts`),
with the reason each cannot be deterministically replayed. They are excluded
from the replay matrix explicitly — not silently missing.

| Scenario | Why not deterministically replayable |
|---|---|
| Mid-turn steering (`turn/steer` promotion) | Depends on a turn being observably in progress when the steering message arrives; replay is instantaneous, so the interleave cannot be scheduled. |
| Late tool registration (`client tool registered after session creation`) | Races the codex thread's `thread/start.dynamicTools` window; the accept/reject outcome depends on real timing. (The *deterministic* client-tool contract — empty-result backfill — is covered by B18 in replay.) |
| Truncate | Depends on live turn state and provider-side transcript compaction timing. |
| File-change approval surfaced and approved | Approval emission depends on real model tool choice during a live patch-shaped turn. |
| Plan-mode `request_user_input` reachability via live model | The deterministic twin already exists in replay (`codex-planning-mode-input-stays-on-the-same-session-…yaml`); the live variant pins real-model reachability only. |
| B7 connection replacement | See the B-section table above. |

## Pending captures blocked on D03–D05

These behaviors are promised but not implemented yet (D03 authentication
directory, D04 GitHub decoupling, D05 default provider). No fixture is recorded
for them: a capture without an implementation would be fiction, and re-recording
later would silently bless whatever the first implementation did. They are
registered here so the matrix shows the hole.

| Pending capture | Blocked by | Why it cannot be recorded today |
|---|---|---|
| API-Key-auth directory is usable and can start a turn | D03 (G4: API-key auth currently maps to `unavailable`) | The host has no API-key auth mode to drive; any fixture would encode the broken behavior as expected. |
| ChatGPT-login directory after sign-in | D03 | Sign-in flows (`account/login/*`) are not wired into the harness; a recorded login round trip requires the real OAuth path and consent. |
| Complete turn with no GitHub token at all | D04 (G5/G7: tokenless operation, built-in GitHub MCP decoupling) | `createRealSession` authenticates against `https://api.github.com` before any session can materialize; the tokenless path does not exist yet. |
| Default provider falls back to openai when nothing is selected | D05 (default-provider policy) | No default-provider resolution behavior to observe; today a provider must be named explicitly. |
| Permission profile denies an out-of-profile write | D03/D05 (vscode-workspace profile injection policy) | The profile-override precedence (user `config.toml` cannot relax the injected profile) needs the profile wiring first; asserting it now would pass vacuously. |

When each blocker lands, add the scenario to the shared suite or the acceptance
matrix entry point, record its fixture with `AGENT_HOST_UPDATE_SNAPSHOTS=1`,
and delete the row here.

## Coverage

`npm run test-agent-host-e2e-coverage` rewrites the checked-in stats:

- `coverage/summary.json` — line coverage of `agentHost/common` + `agentHost/node`.
- `coverage/protocol-surface.json` — AHP contract-surface coverage.

Read the `uncovered` lists, not the percentages (see the README's *Collecting
coverage*). Items that remain uncovered after this round and are **not**
reachable deterministically are the B7/B8/B28 rows above; everything else the
product promises is either covered in replay, covered live, or pending on
D03–D05 as registered above.
