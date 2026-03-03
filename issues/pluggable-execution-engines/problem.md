# Feature: Pluggable Execution Engines

**Status**: OPEN
**Type**: FEATURE
**Priority**: High
**Location**: `ark/internal/genai/`, `ark/internal/controller/`, `ark/internal/validation/`

## Problem Description

The Ark operator currently contains all LLM execution code in-process (OpenAI, Azure, Bedrock providers). This architectural constraint creates several problems:

1. **Tight coupling**: Adding new model types requires modifying and redeploying the operator
2. **Scaling bottleneck**: Controller is both orchestrator and executor, limiting throughput
3. **Binary validation**: `validateNoMixedTeam()` uses internal/external binary checks instead of capability-based matching
4. **Inconsistent patterns**: Standalone Claude/Gemini adapters bypass the extensibility pattern
5. **Limited extensibility**: Third-party frameworks (LangChain, AutoGen, custom engines) cannot be easily integrated

The goal is to transform the operator into an A2A client that dispatches to pluggable execution engines, with every execution engine being an A2A server.

## Impact / Benefits

- **Extensibility**: New model types can be added without operator changes
- **Scalability**: Execution can be horizontally scaled independent of the controller
- **Ecosystem**: Third-party engines (LangChain, AutoGen, custom) can be integrated
- **Zero-downtime**: Engine updates do not require operator restarts
- **Capability matching**: Teams can be validated based on declared capabilities rather than binary internal/external checks

## Code Analysis

### Current Execution Flow

The Query reconciler dispatches to agents/teams which execute locally:

```go
// ark/internal/genai/agent.go:132-148
func (a *Agent) executeAgentA2A(ctx context.Context, userInput protocol.Message, history []protocol.Message, memory MemoryInterface, eventStream EventStreamInterface) (*ExecutionResult, error) {
    capability := a.resolvedCapability
    if capability == "" {
        capability = resolveA2AExecutionCapability(a.ExecutionEngine)
    }

    switch capability {
    case executionCapabilityA2ANativeA2AEngine:
        return a.executeWithA2AExecutionEngineNative(ctx, userInput, history, eventStream)
    case executionCapabilityA2ANativeExternalEngine:
        return a.executeWithExternalA2ANativeExecutionEngine(ctx, userInput, history, memory, eventStream)
    case executionCapabilityA2ANativeLocal:
        return a.executeLocallyA2ANative(ctx, userInput, history, memory, eventStream)
    default:
        return nil, fmt.Errorf("agent %s has unsupported execution capability %s", a.FullName(), capability)
    }
}
```

### Current Capability Resolution

Capabilities are resolved using simple name matching:

```go
// ark/internal/genai/executor_capability.go:15-23
func resolveA2AExecutionCapability(engineRef *arkv1alpha1.ExecutionEngineRef) executionCapability {
    if engineRef == nil {
        return executionCapabilityA2ANativeLocal
    }
    if engineRef.Name == ExecutionEngineA2A {
        return executionCapabilityA2ANativeA2AEngine
    }
    return executionCapabilityA2ANativeExternalEngine
}
```

### Binary Team Validation (Anti-pattern)

Team validation uses binary internal/external classification:

```go
// ark/internal/validation/team.go:47-71
func (v *Validator) validateNoMixedTeam(ctx context.Context, team *arkv1alpha1.Team) error {
    var hasInternalAgents, hasExternalAgents bool

    for i, member := range team.Spec.Members {
        if member.Type != MemberTypeAgent {
            continue
        }
        obj, err := v.Lookup.GetResource(ctx, "Agent", team.Namespace, member.Name)
        if err != nil {
            return fmt.Errorf("team member %d: failed to load agent '%s': %v", i, member.Name, err)
        }
        agent := obj.(*arkv1alpha1.Agent)
        isExternal := agent.Spec.ExecutionEngine != nil && agent.Spec.ExecutionEngine.Name != "" && agent.Spec.ExecutionEngine.Name != genai.ExecutionEngineA2A
        if isExternal {
            hasExternalAgents = true
        } else {
            hasInternalAgents = true
        }
        if hasInternalAgents && hasExternalAgents {
            return fmt.Errorf("mixed teams are not allowed: team contains both internal and external agents. Team member %d: agent '%s' uses external execution engine '%s'",
                i, member.Name, agent.Spec.ExecutionEngine.Name)
        }
    }
    return nil
}
```

### In-Process Provider Implementations

Providers (OpenAI, Azure, Bedrock) all implement in-process execution:

```go
// ark/internal/genai/provider_openai.go:27
var _ A2ANativeTurnProvider = (*OpenAIProvider)(nil)

// ark/internal/genai/provider_bedrock.go:31
var _ A2ANativeTurnProvider = (*BedrockModel)(nil)
```

The A2A model provider interface is:

```go
// ark/internal/genai/a2a_model_provider.go:39-41
type A2AModelProvider interface {
    A2ATurn(ctx context.Context, messages []protocol.Message, toolOutcomes []A2AToolOutcome, tools []A2AToolDefinition, eventStream EventStreamInterface) (*A2ATurnResult, error)
}
```

### Current ExecutionEngine CRD (v1prealpha1)

The ExecutionEngine CRD is minimal:

```go
// ark/api/v1prealpha1/executionengine_types.go:13-20
type ExecutionEngineSpec struct {
    Address     ValueSource `json:"address"`
    Description string      `json:"description,omitempty"`
}
```

### Existing A2A Payload Contracts

Ark already defines payload schemas for A2A communication:

```go
// ark/internal/genai/a2a_payload_contract.go:10-16
const (
    A2APayloadSchemaDelegatedInvocationV1 = "https://ark.mckinsey.com/payloads/delegated-invocation/v1"
    A2APayloadSchemaStepEventV1           = "https://ark.mckinsey.com/payloads/step-event/v1"
    A2APayloadSchemaToolCallsV1           = "https://ark.mckinsey.com/payloads/tool-calls/v1"
    A2APayloadSchemaToolResultV1          = "https://ark.mckinsey.com/payloads/tool-result/v1"
    A2APayloadSchemaRoleHintV1            = "https://ark.mckinsey.com/payloads/role-hint/v1"
)
```

## Related Files

- `ark/internal/genai/agent.go:132-148` - Agent execution dispatch
- `ark/internal/genai/executor_capability.go:1-24` - Capability resolution (needs capability matching)
- `ark/internal/validation/team.go:47-71` - Binary team validation (needs capability-based validation)
- `ark/internal/genai/a2a_local_engine.go:1-183` - Local turn loop (moves to `services/ark-query-engine/`)
- `ark/internal/genai/openai_a2a_model_adapter.go:1-327` - OpenAI adapter (moves to `services/ark-query-engine/`)
- `ark/internal/genai/provider_openai.go:1-339` - OpenAI provider (moves to `services/ark-query-engine/`)
- `ark/internal/genai/provider_bedrock.go:1-425` - Bedrock provider (moves to `services/ark-query-engine/`)
- `ark/internal/genai/provider_azure.go` - Azure provider (moves to `services/ark-query-engine/`)
- `ark/internal/genai/a2a_payload_contract.go:1-96` - Existing payload contracts (needs extension)
- `ark/internal/genai/execution_engine.go:1-354` - Execution engine A2A client
- `ark/internal/genai/tools.go:1-604` - Tool registry (tool callback design)
- `ark/internal/controller/query_controller.go` - Query reconciliation
- `ark/api/v1prealpha1/executionengine_types.go` - ExecutionEngine CRD (needs capability fields)
- `ark/api/v1alpha1/agent_types.go:67-78` - Agent ExecutionEngineRef

## Proposed Implementation

### Phase 1: Engine Extraction (Agreed Next Steps — Issue #1219)

Extract the LLM execution loop from the controller into a standalone A2A service. The controller becomes a query router. Adding new model support means deploying a new engine, not changing the controller. Builds on PR #1232 (A2A as internal transport).

**Source**: [Agreed Next Steps](https://github.com/mckinsey/agents-at-scale-ark/issues/1219#issuecomment-3987156542)

1. **Create `services/ark-query-engine/`** — A2A server with turn loop, provider adapters, tool callback client, health endpoint. Own `main.go`, `Dockerfile`, `Makefile`.
2. **Remove execution from controller** — Delete `a2a_local_engine.go`, `provider_*.go`, adapters, `a2a-native-local` path. Controller dispatches all execution via A2A client.
3. **Wire the sidecar** — Add engine container to controller pod spec. Default `ExecutionEngine` CR in `ark-system` at `localhost:PORT`. Helm config supports sidecar/service/loopback modes from day one.
4. **Minimal tool callback contract** — Extend `a2a_payload_contract.go` with `tool-request/v1` and `tool-result/v1` payload types. Engine signals `input-required`; controller executes tools via `ToolRegistry` and returns results.
5. **Basic Agent Card** — Engine exposes `/.well-known/agent-card.json` for health-check and discovery. Full `execution-profile/v1` deferred to Phase 2.
6. **Crash recovery anchor** — Persist `taskId` and `contextId` to `query.status.response.a2a` before first token. Controller restart recovers via `tasks/get` and `tasks/resubscribe`.
7. **Error response contract** — Minimal machine-readable error codes (`unsupported-model`, `provider-error`, `invalid-config`) so the controller can distinguish recoverable from terminal failures.
8. **Test** — 100% unit coverage on new module. All existing chainsaw tests pass. Add at least one streaming e2e chainsaw test to validate the engine SSE -> controller -> client pipeline.

**Phase 1 success criteria**:
- Controller has no executor — turn loop, provider adapters, and completions logic removed
- `services/ark-query-engine/` exists — own binary, Dockerfile, Go module, 100% unit test coverage
- A2A is the protocol — controller and engine communicate via `protocol.Message` only
- Tool callbacks work — engine signals `input-required`, controller executes tools, returns results
- Default install deploys it — `ExecutionEngine` CR in `ark-system` points to sidecar
- All existing e2e tests pass — zero user-facing change

**Deployment modes** (Helm-configurable from Phase 1):

| Mode | `ExecutionEngine.spec.address` | Deployment | When |
|------|-------------------------------|------------|------|
| Sidecar | `localhost:PORT` | Container in controller pod | Phase 1 default |
| Standalone service | `ark-query-engine.ark-system.svc:8080` | Separate Deployment + Service | Phase 5 |
| Loopback | In-process (no network) | Embedded in controller binary | Dev mode |

### Phase 2: Extension Contracts

Define the full A2A extension schemas for capability negotiation, interruption handling, and history strategies:

1. **`execution-profile/v1`** — Declares engine capabilities in Agent Card (toolMode, memoryMode, structuredOutput, streaming, etc.)
2. **`user-input/v1`** — Client-in-the-loop callback for user approval, clarification, interactive parameters
3. **`auth-callback/v1`** — Auth interruption handling for upstream token expiry
4. **`history/v1`** — Conversation history strategies (inline, reference, stateful)
5. Full extension negotiation/versioning policy, idempotency contracts, protocol state machine documentation

### Phase 3: Capability Matching

Replace binary validation with Agent Card-based compatibility:

1. Add `ExecutionProfile` struct to `v1prealpha1/executionengine_types.go`
2. Implement Agent Card fetching from ExecutionEngine endpoints
3. Replace `validateNoMixedTeam()` with capability intersection validation
4. Validate team members have compatible tool modes, memory modes, etc.
5. Implement capability freshness policy (live fetch vs cache TTL vs fail-closed)

### Phase 4: Conformance and SDK

Enable third-party engine development:

1. Create Chainsaw conformance tests for execution engines
2. Document engine authoring guide
3. Provide SDK scaffolding for engine implementations (Go and Python)
4. Conformance test runner: `ark-engine-conformance <engine-url>`

### Phase 5: Helm and Standalone Service

Promote default engine from sidecar to standalone service and co-deploy:

1. Add default engine Deployment and Service to Helm chart
2. Configure auto-registration of default engine
3. Ensure backward compatibility (existing deployments work unchanged)
4. Implement fallback resolution policy (namespace default -> system fallback)
5. Add default NetworkPolicy for controller -> engine/memory egress

### Phase 6: Dashboard and Observability

UI for engine management:

1. ExecutionEngine list/detail views with capabilities
2. Agent-engine compatibility matrix and team compatibility warnings
3. Engine health monitoring
4. Render `user-input-request/v1` as interactive prompt; submit via `POST /v1/queries/{name}/input`
5. Propagate OpenTelemetry trace context through A2A calls

### Phase 7: Tool Proxy Pilot (Optional)

Scale tool execution when callback bottlenecks are observed:

1. Implement tool proxy service or MCP tool gateway
2. Support delegated tool execution
3. Trigger criteria: callback p99 > 500ms or sustained > 200 callbacks/sec

### Phase 8: Horizontal Query Workers (Optional)

Scale query dispatch:

1. Implement SKIP LOCKED dequeue from PostgreSQL for pending queries
2. Extract A2A client dispatch into standalone worker process
3. Controller retains lifecycle-only responsibilities

## Test Requirements

- Chainsaw E2E tests REQUIRED for each phase
- Conformance test suite for third-party engines
- Test scenarios:
  - Default deployment works identically to current (chainsaw tests pass)
  - New engine onboarding works without operator changes
  - Tool callback works with all tool types (HTTP, MCP, agent, team, builtin)
  - Team compatibility validated by capability matching
  - Streaming works end-to-end with acceptable latency (<100ms additional)
  - Crash recovery via taskId/contextId persistence

## Success Criteria

### Phase 1 (Engine Extraction)

1. Controller has no executor — turn loop, provider adapters, and completions logic removed
2. `services/ark-query-engine/` exists with own binary, Dockerfile, Go module, 100% unit test coverage
3. Controller and engine communicate via `protocol.Message` only (A2A protocol)
4. Tool callbacks work — engine signals `input-required`, controller executes tools (HTTP, MCP, agent, team, builtin)
5. Default install deploys engine as sidecar — `ExecutionEngine` CR in `ark-system` at `localhost:PORT`
6. All existing chainsaw e2e tests pass — zero user-facing change
7. Crash recovery works via `taskId`/`contextId` persistence in `query.status.response.a2a`

### Full Feature (All Phases)

1. Default deployment works identically (existing chainsaw tests pass)
2. New engine onboarding in <30 minutes without operator changes
3. Tool callback works with HTTP, MCP, agent, team, builtin tools
4. Team compatibility validated by capability matching (not binary)
5. Streaming works end-to-end with <100ms additional latency
6. Conformance suite validates third-party engines
7. SDK enables engine authoring in <1 hour
8. Crash recovery works via taskId/contextId persistence

## Third-Party Solutions

**Existing Libraries/Tools**:
- `trpc.group/trpc-go/trpc-a2a-go` - A2A protocol library (already in use)
  - Pros: Already integrated, full A2A spec support
  - Cons: None (established dependency)
  - License: Apache 2.0
- Google Agent2Agent reference implementation - Reference for protocol compliance
  - Pros: Reference implementation, conformance patterns
  - Cons: Not a library to import

**Recommendation**: Continue using `trpc-a2a-go` as the A2A protocol foundation
**Rationale**: Already integrated, proven, and provides full A2A spec support

## Historical Context

- Recent commits (`b0a3873c`, `b14fea2d`, `28f0577c`) have established A2A-native execution patterns
- Execution capability resolution is in place (`executor_capability.go`)
- External engine support exists but uses simple name matching
- Payload contracts already defined (`a2a_payload_contract.go`)
- This feature builds on the existing A2A foundation

## Additional Context

- Agreed next steps: [Issue #1219, comment 3987156542](https://github.com/mckinsey/agents-at-scale-ark/issues/1219#issuecomment-3987156542) — defines Phase 1 scope
- Source implementation plan: `vibe_artifacts/pluggable-execution-plan.md`
- PR #1232 (A2A as internal transport) — prerequisite foundation for Phase 1
- Related GitHub issue: #1219 (contains three proposals, this implements hybrid approach)
- Two-tier integration model: Delegation tier (A2AServer) and Execution tier (ExecutionEngine)
- Default engine preserves "works as-is" experience for existing deployments
- Deployment progression: sidecar (Phase 1) -> standalone service (Phase 5) -> loopback (dev mode)
