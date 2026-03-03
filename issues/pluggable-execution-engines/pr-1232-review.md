# PR #1232 Structured Review

**PR**: [feat: unify internal transport to A2A](https://github.com/mckinsey/agents-at-scale-ark/pull/1232)
**State**: Draft, 8 commits, 0 reviews, 0 comments
**Scope**: 96 files, +13,273 / -1,259 lines

---

## 1. Accuracy Check

### Verified correct

| Claim | Live PR value | Status |
|-------|--------------|--------|
| Total files | 96 | Correct |
| Total additions | +13,273 | Correct |
| Total deletions | -1,259 | Correct |
| GenAI core files | 41, +4,592/-742 | Correct |
| Docs files | 7, +883/-62 | Correct |
| Controller files | 2, +348/-53 | Correct |
| Ark API files | 16, +1,582/-226 | Correct |
| Annotations files | 2, +32/-5 | Correct |
| Chainsaw files | 2, +6/-7 | Correct |
| README | 1, +14/-0 | Correct |
| Three-way execution routing | `a2a-native-local`, `a2a-native-a2a-engine`, `a2a-native-external-engine` | Matches `executor_capability.go` and `agent.go` switch |
| Single adapter model | `OpenAIA2AModelAdapter` with `A2ANativeTurnProvider` delegation | Matches `openai_a2a_model_adapter.go` lines 43-69 |
| No Claude/Gemini adapters in PR diff | Files added in `1ac5be6`, removed in `28f0577` | Net zero in final diff; correctly absent from body |
| All file references in review sequence exist in PR | Checked all ~45 file names across 12 phases | All present |
| Provider extensibility section | Links to #1219; correctly directs Claude/Gemini to engine services | Accurate |

### Inaccuracies found

| Claim | Body says | Actual | Impact |
|-------|----------|--------|--------|
| GenAI test file count | 25 | **26** (`provider_a2a_native_turn_contract_test.go` is the 26th) | Low -- reviewer won't miss a file, but total math is wrong |
| Phase 11 total test count | "33 test files total" | **34** (26 genai + 1 controller + 5 ark-api + 2 chainsaw) | Low |
| Area table double-count | `annotations.py` counted in both Annotations (2) and Ark API (16) | Sum is 97, masked by the test undercount | Low -- cosmetic, but misleading if anyone audits totals |

### Stale commit message

Commit `1ac5be6` body contains: "Claude and Gemini A2A model adapters behind A2AModelProvider". These files were removed in `28f0577`. Reviewers browsing commit-by-commit will see phantom references to files that no longer exist in the final diff. This is a minor confusion risk -- not actionable without an interactive rebase.

---

## 2. Reviewer Assistance Quality

### Strengths

**12-phase review sequence with "Key question" column.** This is the most valuable element. For a 96-file PR, phase-by-phase reading order with targeted verification questions reduces review time dramatically. Each phase scopes the reviewer to 3-8 files with a clear concern to evaluate.

**Architecture before/after diagrams.** Concise ASCII diagrams make the core change obvious without reading code. The "single adapter handles all providers" framing is immediately clear.

**Execution capability routing table.** Maps capability names to when/code-path/behavior. This is the single most useful table for understanding the PR's branching logic.

**Provider extensibility model section.** Explicitly prevents the anti-pattern of adding per-provider adapters. Links to #1219 for the full plan. This is a policy statement that protects the codebase.

**"What this does NOT change" section.** Reduces reviewer anxiety on a large PR. Five concrete non-change guarantees help reviewers skip areas they don't need to verify.

### Weaknesses

**No commit-by-commit reading guide.** The 8 commits have a deliberate layering (unify -> clean dead code -> simplify controller -> remove split-path -> restore compat -> fix registry -> add stream/edge/adapters -> harden). A one-line-per-commit summary would let reviewers choose between file-by-file and commit-by-commit strategies.

**No risks or known issues section.** Large transport changes have failure modes. The PR body doesn't surface:
- The deprecated compat path (`agent.go` line 45: `"using deprecated v0.3 compat execution path; migrate to ExecuteA2A"`) and its removal timeline ("after two minor releases").
- The dual-format memory read as a temporary migration artifact (what happens when old-format entries are no longer possible?).
- Stream resubscription as a new failure surface (what if the engine doesn't support resubscribe?).

**`message_conversion.py` is invisible.** This is a 418-line entirely new file -- the 11th largest in the PR -- but it's hidden behind `a2agw/*.py` in Phase 12. Python reviewers need to know this file exists.

**Test coverage gaps aren't flagged.** The PR adds extensive tests but doesn't call out what is NOT tested. Reviewers should know whether there are integration tests for the compat path under streaming, or whether team graph execution with A2A messages is exercised end-to-end.

---

## 3. Prioritized Improvements

### P1 -- Fix numerical inaccuracies (immediate, low effort)

Update the PR body:
- Change "25" to "26" for GenAI test files in both the area table and Phase 11 description.
- Change "33" to "34" for total test count in Phase 11.
- Either remove `annotations.py` from the Ark API count (making it 15) or note the overlap.

### P2 -- Add commit reading guide (medium effort, high reviewer value)

Add a section between "Changes by area" and "Review sequence":

```
### Commit sequence

| # | SHA | What it does |
|---|-----|-------------|
| 1 | b71cd86 | Core: unify dispatch to protocol.Message, add ExecuteA2A |
| 2 | ca5f8fe | Clean: rename experimental->multimodal, remove dead code, consolidate docs |
| 3 | 3ed75a5 | Controller: simplify paths, add token usage reporting from all providers |
| 4 | 6728c51 | Remove: delete split-path A2A payload mode scaffolding |
| 5 | b14fea2 | Compat: restore boundary compatibility, partial error results, regression tests |
| 6 | b484e88 | Fix: registry skill assertion alignment |
| 7 | 1ac5be6 | Features: StreamResubscriber, EdgeAdapter, HistoryExtensionV1, stream correlation IDs |
| 8 | 28f0577 | Harden: telemetry, error propagation, ctx.Err() checks, 11 new tests, remove dead adapters |
```

### P3 -- Add risks and migration notes section (medium effort, high reviewer value)

Add after "Execution capability routing":

```
### Migration and risk notes

- **Deprecated compat path**: `Execute()` on `Agent` logs a deprecation warning and
  will be removed after two minor releases. Callers should migrate to `ExecuteA2A()`.
- **Dual-format memory**: `memory_http.go` reads both OpenAI and A2A formats.
  This is a transitional state -- once all memory entries are written in A2A format,
  the OpenAI reader can be removed.
- **Stream resubscription**: `StreamResubscriber` retries on unexpected stream close.
  Engines that don't support `ResubscribeTask` will fail with an error rather than
  silently dropping tokens.
```

### P4 -- Call out `message_conversion.py` in Phase 12 (low effort)

In Phase 12's "What to read" column, explicitly list `a2agw/message_conversion.py` (418 new lines) alongside the glob.

---

## 4. Reviewer Gate Checklist

Reviewers should verify each gate before approving. Items are ordered by risk.

### Correctness gates

- [ ] **Routing completeness**: `executeAgentA2A` in `agent.go` handles all three capabilities and the default arm returns an error (not nil).
- [ ] **Adapter fallback**: `openai_a2a_model_adapter.go` correctly detects `A2ANativeTurnProvider` via type assertion and falls back to ChatCompletions when absent.
- [ ] **Compat round-trip**: `a2a_execution_compat.go` converts A2A -> OpenAI -> execute -> OpenAI -> A2A without losing tool calls, tool results, or multimodal parts.
- [ ] **Memory dual-read**: `memory_http.go` correctly deserializes both legacy OpenAI-format and new A2A-format entries and produces valid `protocol.Message` slices from each.
- [ ] **Token usage propagation**: All three providers (OpenAI, Azure, Bedrock) populate `A2ATurnUsage` from their API responses, and the adapter records it via telemetry/eventing.
- [ ] **Stream resubscription**: `StreamResubscriber` in `a2a_execution.go` correctly handles reconnect, and the delegated stream bridge buffers across resubscribe gaps.

### Compatibility gates

- [ ] **No CRD schema changes**: Query, Agent, A2AServer, A2ATask, ExecutionEngine CRDs are unchanged.
- [ ] **Memory wire format**: New memory writes use A2A format; old entries are still readable.
- [ ] **Chainsaw tests pass**: `query-parameter-ref` and `query-token-usage` tests are unchanged in behavior (only minor assertion updates).

### Architecture gates

- [ ] **No new provider adapters in operator**: The only `A2AModelProvider` implementation is `openAIA2AModelAdapter`. No Claude, Gemini, or other provider-specific adapters exist.
- [ ] **Edge adapters are boundary-only**: `ChatCompletionsAdapter` and `ResponseAPIAdapter` in `edge_adapter.go` are not called from internal execution paths.
- [ ] **Deprecated path is logged**: `Execute()` in `agent.go` emits a V(0) deprecation log before delegating to `ExecuteA2A`.

### Cross-language parity gates

- [ ] **Annotation constants match**: Go constants in `ark/internal/annotations/annotations.go` match Python constants in `services/ark-api/ark-api/src/ark_api/constants/annotations.py`.
- [ ] **A2A gateway message conversion**: `a2agw/message_conversion.py` (418 lines, entirely new) correctly mirrors the Go conversion logic in `message_conversion.go` and `message_conversion_multimodal.go`.

---

## 5. Files by Review Priority

Top 15 files by churn, annotated with review phase:

| Rank | File | Churn | Phase | Review note |
|------|------|-------|-------|-------------|
| 1 | `agent_tools_test.go` | +716/-3 | 7, 11 | Test-only; verify tool delegation coverage |
| 2 | `a2a.go` | +663/-52 | 8 | Core protocol contracts; high impact |
| 3 | `a2a-native-execution.mdx` | +673/-0 | 12 | New reference doc; verify accuracy |
| 4 | `openai_a2a_model_adapter_test.go` | +539/-0 | 2, 11 | Test-only; verify adapter contract |
| 5 | `provider_a2a_native_turn_contract_test.go` | +534/-0 | 3, 11 | Test-only; verify Bedrock native turn |
| 6 | `a2a_execution.go` | +346/-148 | 1 | Core dispatch; highest risk |
| 7 | `a2a_execution_test.go` | +374/-117 | 1, 11 | Test-only; verify dispatch coverage |
| 8 | `message_conversion_test.go` | +464/-0 | 4, 11 | Test-only; verify round-trip fidelity |
| 9 | `a2a_execution_local_test.go` | +437/-0 | 2, 11 | Test-only; verify local engine loop |
| 10 | `agent_tools.go` | +387/-43 | 7 | Tool delegation changes; medium risk |
| 11 | `message_conversion.py` | +418/-0 | 12 | New Python file; cross-language parity risk |
| 12 | `a2a_local_engine_test.go` | +392/-0 | 2, 11 | Test-only; verify engine turn loop |
| 13 | `memory_http_test.go` | +347/-11 | 6, 11 | Test-only; verify dual-format read |
| 14 | `openai_a2a_model_adapter.go` | +327/-0 | 2 | Single adapter; critical correctness |
| 15 | `execution.py` | +155/-157 | 12 | Heavy refactor; verify behavioral parity |
