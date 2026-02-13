# Backend Audit Report (2026-02-13)

## Scope
- Audited the Go backend at `backend/cmd/` and `backend/internal/`.
- Ran quality gates: `go test`, `go vet`, `go build` (with `GOTOOLCHAIN=auto` because local Go is 1.23.4).
- Reviewed auth, WebSocket/terminal session flows, filesystem boundaries, and operational reliability paths.

## Scoring
- Confidence (1-5): likelihood this is a real issue.
- Impact (1-5): potential product/engineering impact if left unresolved.
- Ease (1-5): implementation ease (5 = easiest).

## Verification Snapshot
- `go test ./...`: failed locally (`go.mod` requires Go 1.24+, local is 1.23.4).
- `GOTOOLCHAIN=auto go test ./...`: passed.
- `GOTOOLCHAIN=auto go vet ./...`: passed.
- `GOTOOLCHAIN=auto go build ./cmd/codeburg`: passed.
- `GOTOOLCHAIN=auto go test -race ./internal/api`: failed in this environment (`runtime/race: package testmain: cannot find package`).

### Verification Snapshot Update (2026-02-13)
- `GOTOOLCHAIN=auto go test ./internal/api`: passed.
- `GOTOOLCHAIN=auto go test ./...`: passed.
- `GOTOOLCHAIN=auto go vet ./...`: passed.
- `cd frontend && pnpm build`: passed.

## Findings

### B01 - WebSocket and terminal channels are effectively unauthenticated
- Category: Security / authz
- Confidence: 5
- Impact: 5
- Ease: 2
- Evidence:
`backend/internal/api/server.go:168`
`backend/internal/api/websocket.go:177`
`backend/internal/api/websocket.go:283`
`backend/internal/api/websocket.go:310`
`backend/internal/api/terminal.go:34`
`backend/internal/api/terminal.go:42`
`backend/internal/api/sessions.go:377`
- Notes:
`/ws` and `/ws/terminal` are public routes, and the websocket message handler has no auth gate before subscribe/message actions. This allows unauthenticated clients (that pass Origin checks) to receive global session/task updates and send input to runtime sessions.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- Implemented WS auth gating and close semantics in `backend/internal/api/websocket.go`:
connections must authenticate (handshake token or `auth` message) before `subscribe`/`unsubscribe`/`message`, otherwise close `4001`.
- Implemented terminal WS JWT guard in `backend/internal/api/terminal.go` before session lookup/attach.
- Added regression tests in `backend/internal/api/websocket_auth_test.go`.
- Owner/PR (next agent):

### B02 - Frontend sends WebSocket auth message, backend ignores it
- Category: Security / protocol drift
- Confidence: 5
- Impact: 4
- Ease: 3
- Evidence:
`frontend/src/hooks/useWebSocket.ts:75`
`backend/internal/api/websocket.go:283`
- Notes:
Frontend sends `{ type: "auth", token }` after socket open, but backend has no `auth` message branch and no handshake token validation. This is a concrete contract mismatch in a security-sensitive path.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- Aligned frontend and backend WS auth contract:
`frontend/src/hooks/useWebSocket.ts` now sends token in query (`/ws?token=...`) and still emits `auth` message; backend now handles `auth`.
- `frontend/src/hooks/useTerminal.ts` now includes JWT query token for `/ws/terminal`.
- Owner/PR (next agent):

### B03 - Auth rate limiting trusts spoofable proxy headers and has fragile IP parsing
- Category: Security / abuse resistance
- Confidence: 5
- Impact: 4
- Ease: 3
- Evidence:
`backend/internal/api/auth.go:264`
`backend/internal/api/auth.go:267`
`backend/internal/api/auth.go:270`
`backend/internal/api/auth.go:279`
- Notes:
Rate limiting keys off `CF-Connecting-IP` and `X-Forwarded-For` without trusted-proxy validation. Attackers can rotate spoofed headers to bypass limits and grow the in-memory attempts map. `RemoteAddr` parsing via `LastIndex(":")` is also brittle for IPv6 forms.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- Reworked `clientIP` in `backend/internal/api/auth.go`:
forwarded headers are now trusted only when `RemoteAddr` is a trusted proxy (loopback/private/link-local), with robust IPv4/IPv6 parsing via `netip`.
- Added tests in `backend/internal/api/auth_clientip_test.go`.
- Owner/PR (next agent):

### B04 - JSON decoding has no body-size guard and silently accepts unknown fields
- Category: Reliability / API contract safety
- Confidence: 5
- Impact: 3
- Ease: 3
- Evidence:
`backend/internal/api/server.go:443`
`backend/internal/api/projects.go:52`
`backend/internal/api/sessions.go:136`
`backend/internal/api/project_workspace.go:271`
- Notes:
`decodeJSON` wraps `json.NewDecoder(r.Body).Decode(v)` with no `http.MaxBytesReader` and no `DisallowUnknownFields`. This increases DoS surface and allows typoed client payloads to silently pass.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- Hardened `decodeJSON` in `backend/internal/api/server.go`:
1 MiB body cap, `DisallowUnknownFields`, and rejection of trailing JSON payloads.
- Added tests in `backend/internal/api/json_decode_test.go`.
- Owner/PR (next agent):

### B05 - Project file sandboxing is vulnerable to symlink escape patterns
- Category: Security / filesystem boundary
- Confidence: 4
- Impact: 4
- Ease: 2
- Evidence:
`backend/internal/api/project_workspace.go:951`
`backend/internal/api/project_workspace.go:958`
`backend/internal/api/project_workspace.go:313`
`backend/internal/api/project_workspace.go:368`
- Notes:
`safeJoin` prevents `..` traversal lexically but does not resolve symlinks before write/delete operations. A symlink inside project root can still target files outside root when handlers call `os.WriteFile`, `os.Remove`, etc.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- Hardened path resolution with symlink-aware sandboxing:
`safeJoin` now resolves base/target symlinks and validates nearest existing parent via `resolvePathWithResolvedParent`.
- Added path-escape tests (symlink file + symlink dir) in `backend/internal/api/project_workspace_test.go`.
- Owner/PR (next agent):

### B06 - HTTP server runs without explicit timeouts or graceful shutdown
- Category: Reliability / operational hardening
- Confidence: 5
- Impact: 4
- Ease: 3
- Evidence:
`backend/internal/api/server.go:374`
`backend/cmd/codeburg/main.go:59`
`backend/cmd/codeburg/main.go:62`
- Notes:
Using `http.ListenAndServe` directly leaves `ReadHeaderTimeout`/`ReadTimeout`/`WriteTimeout`/`IdleTimeout` unset and no signal-driven graceful shutdown path. This is avoidable risk for slowloris-style behavior and restart safety.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- Replaced plain `http.ListenAndServe` with configured `http.Server` timeouts in `backend/internal/api/server.go`.
- Added `Server.Shutdown(ctx)` and signal-based graceful shutdown (`SIGINT`/`SIGTERM`) in `backend/cmd/codeburg/main.go`.
- Owner/PR (next agent):

### B07 - Session/task cleanup paths swallow important errors
- Category: Reliability / data consistency
- Confidence: 4
- Impact: 4
- Ease: 3
- Evidence:
`backend/internal/api/tasks.go:563`
`backend/internal/api/tasks.go:568`
`backend/internal/api/sessions.go:88`
`backend/internal/api/sessions.go:547`
`backend/internal/api/hooks.go:135`
- Notes:
Multiple lifecycle paths ignore DB/runtime errors during reconciliation, stop/delete, and hook-driven status updates. Failures can leave runtime, DB status, and sidecar files out of sync with little operator visibility.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- Removed silent error drops in session/task lifecycle code:
added explicit error handling/logging for reconciliation, start/stop/delete cleanup, and hook status updates.
- Updated files: `backend/internal/api/tasks.go`, `backend/internal/api/sessions.go`, `backend/internal/api/hooks.go`.
- Owner/PR (next agent):

### B08 - CORS/WebSocket origin policy is mutable global state
- Category: Architecture / correctness risk
- Confidence: 4
- Impact: 3
- Ease: 4
- Evidence:
`backend/internal/api/server.go:33`
`backend/internal/api/server.go:104`
`backend/internal/api/server.go:148`
`backend/internal/api/websocket.go:16`
- Notes:
`allowedOrigins` is a package-global slice mutated in `NewServer`. Multiple server instances/tests can accumulate origins over time, producing surprising policy broadening and order-dependent behavior.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- Moved origin policy from mutable package global to server instance state (`Server.allowedOrigins`).
- WebSocket upgrader is now per-server (`wsUpgrader()`), using instance-specific origin policy.
- Updated test env initialization (`backend/internal/api/api_test.go`) accordingly.
- Owner/PR (next agent):

### B09 - SPA fallback returns `index.html` for unknown API routes
- Category: API correctness / observability
- Confidence: 4
- Impact: 3
- Ease: 4
- Evidence:
`backend/internal/api/server.go:319`
`backend/internal/api/server.go:344`
`backend/internal/api/server.go:364`
- Notes:
The `NotFound` handler always falls back to frontend `index.html`, including `/api/*` misses. API clients can receive `200` HTML instead of structured `404` JSON, which obscures integration errors.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- Added API-aware NotFound handling independent of frontend dist presence:
unknown `/api/*` now returns structured JSON 404; `/ws*` remains HTTP 404 behavior.
- Added regression test `backend/internal/api/server_routing_test.go`.
- Owner/PR (next agent):

### B10 - Backend hotspots are highly monolithic
- Category: Code organization / maintainability
- Confidence: 5
- Impact: 3
- Ease: 2
- Evidence:
`backend/internal/api/project_workspace.go:1`
`backend/internal/api/git.go:1`
`backend/internal/api/sessions.go:1`
`backend/internal/api/api_test.go:1`
- Notes:
Current hotspot sizes are high (`project_workspace.go` 1627 lines, `git.go` 1200, `sessions.go` 965, `api_test.go` 1796). This raises review burden and regression risk for multi-concern edits.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- Reduced hotspot concentration by extracting helper modules:
`backend/internal/api/workspace_paths.go` (path/sandbox/file-walk helpers) and
`backend/internal/api/sessions_command.go` (command builder/shell fallback/model validation).
- Hotspots reduced: `project_workspace.go` 1627 -> 1514 lines, `sessions.go` 965 -> 900 lines.
- Owner/PR (next agent):

### B11 - Test coverage gaps remain in security-critical runtime/auth surfaces
- Category: Quality / risk
- Confidence: 4
- Impact: 4
- Ease: 3
- Evidence:
`backend/internal/api/websocket.go:1`
`backend/internal/api/terminal.go:1`
`backend/internal/api/auth.go:1`
`backend/internal/api/passkey.go:1`
`backend/internal/ptyruntime/manager.go:1`
- Notes:
There are 56 Go source files and 12 `*_test.go` files. Core paths above have no dedicated tests, so regressions in handshake/authz/session transport behavior are less likely to be caught early.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- Expanded targeted test coverage on auth/runtime/security-critical surfaces:
added `auth_clientip_test.go`, `json_decode_test.go`, `passkey_challenge_test.go`,
`server_routing_test.go`, `sessions_command_test.go`, `internal/ptyruntime/manager_test.go`,
and WS auth tests in `websocket_auth_test.go`.
- Backend test file count increased from 12 to 19.
- Owner/PR (next agent):

### B12 - Agent sessions default to maximum-privilege execution modes
- Category: Security / safety defaults
- Confidence: 4
- Impact: 3
- Ease: 3
- Evidence:
`backend/internal/api/sessions.go:663`
`backend/internal/api/sessions.go:680`
- Notes:
Claude sessions are started with `--dangerously-skip-permissions` and Codex sessions with `--full-auto` by default. This may be intentional for power users, but defaulting to maximum automation raises blast radius for prompt/tool misuse.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- Changed agent execution defaults to safer mode:
removed implicit `--dangerously-skip-permissions` / `--full-auto`.
- Added explicit opt-in env switch `CODEBURG_UNSAFE_AGENT_DEFAULTS=true|1|yes|on` for prior behavior.
- Added tests in `backend/internal/api/sessions_command_test.go`.
- Owner/PR (next agent):

## Agent Handoff Summary
- Completed findings IDs: B01, B02, B03, B04, B05, B06, B07, B08, B09, B10, B11, B12.
- Deferred findings IDs and rationale: none.
- High-level solution summary:
- Secured WS/terminal access with enforced JWT auth and client/server protocol alignment.
- Hardened request parsing and filesystem boundary handling against malformed JSON and symlink escapes.
- Improved operational resilience (timeouts + graceful shutdown) and cleanup error visibility.
- Reduced hotspot concentration via helper extraction and materially expanded backend test surface.
- Validation run after fixes (`test`/`vet`/`build`):
- `GOTOOLCHAIN=auto go test ./internal/api` -> pass.
- `GOTOOLCHAIN=auto go test ./...` -> pass.
- `GOTOOLCHAIN=auto go vet ./...` -> pass.
- `cd frontend && pnpm build` -> pass.

## Post-Audit Improvements (2026-02-13)

### I02 - Background goroutines now shut down cleanly with server lifecycle
- Status: [x] Implemented
- What changed:
- Added server-owned background context/cancel + waitgroup tracking for long-running loops.
- Wired `WSHub.Run` and session cleanup ticker loop to lifecycle cancellation.
- Added explicit hub stop semantics to prevent new registrations/broadcasts during shutdown.
- Updated tests to run hub with context and assert cancellation behavior.
- Files:
`backend/internal/api/server.go`
`backend/internal/api/websocket.go`
`backend/internal/api/sessions.go`
`backend/internal/api/api_test.go`
`backend/internal/api/background_lifecycle_test.go`
- Validation:
- `cd backend && GOTOOLCHAIN=auto go test ./internal/api` -> pass.
- `cd backend && GOTOOLCHAIN=auto go test ./...` -> pass.
- `cd backend && GOTOOLCHAIN=auto go vet ./...` -> pass.

- Execution update (2026-02-13, ordered `1 -> 3 -> 2`):
- 1. Centralization completion:
- Added lifecycle execution helpers `applySessionTransitionByID(...)` and `applySessionTransitionWithFallback(...)`.
- Removed remaining direct status writes from `internal/api` business paths by routing reconciliation, terminal-input promotion, zombie cleanup, and runtime-exit handling through centralized transition helpers.
- Refactored manager method signatures to use server-owned lifecycle helpers:
`setSessionRunning(sessionID, server)` and `StartCleanupLoop(ctx, server)`.
- 3. Race/interleaving coverage:
- Added interleaving tests in `backend/internal/api/session_lifecycle_race_test.go`:
`TestSessionInterleaving_HookAndRuntimeExit_CompletedInBothOrders`,
`TestSessionRace_StopThenLateHook_DoesNotReopen`,
`TestSessionInterleaving_CleanupAndStop_NoReopen`,
`TestRuntimeExitAfterSessionDelete_DoesNotRecreateSession`.
- 2. Observability (structured logs):
- Added transition logs in `backend/internal/api/session_lifecycle.go`:
`session_transition_applied`, `session_transition_noop`, `session_transition_persist_failed`,
plus enriched invalid-transition warning fields (including `source`).
- Updated files for this execution pass:
`backend/internal/api/session_lifecycle.go`
`backend/internal/api/sessions.go`
`backend/internal/api/hooks.go`
`backend/internal/api/terminal.go`
`backend/internal/api/server.go`
`backend/internal/api/background_lifecycle_test.go`
`backend/internal/api/session_lifecycle_race_test.go`
- Validation:
- `cd backend && GOTOOLCHAIN=auto go test ./internal/api` -> pass.
- `cd backend && GOTOOLCHAIN=auto go test ./...` -> pass.
- `cd backend && GOTOOLCHAIN=auto go vet ./...` -> pass.

### I01 - Session lifecycle state machine centralization (implemented + options)
- Status: [x] Implemented (Option 2)
- Problem summary:
Session status transitions are currently spread across handlers/hooks/cleanup/reconcile paths, which makes invariants (allowed transitions, terminal states, broadcast consistency) harder to enforce.

- Option 1: Thin transition service in `internal/api` (lowest risk)
- Add a single `transitionSession(...)` helper called by all status-changing paths.
- Keep current DB schema; enforce a small transition map in code and centralize logging/broadcasts.
- Pros: low migration risk, fast rollout.
- Cons: still coupled to API layer; weaker long-term domain boundaries.

- Option 2: Dedicated lifecycle domain module (recommended)
- Create `internal/sessionlifecycle` with typed `State`, `Event`, `Apply(...)` transition rules.
- API/hooks/tasks call the module, then execute returned side effects (persist, runtime stop, websocket broadcast).
- Add table-driven transition tests and forbidden-transition coverage.
- Pros: strongest correctness and maintainability; clear single source of truth.
- Cons: moderate refactor size; requires phased integration.

- Option 3: Event log model (`session_events`) + derived current state (highest rigor, highest effort)
- Persist lifecycle events and project current state from event history.
- Improves auditability and debugging, supports timeline tooling.
- Pros: best observability and forensic traceability.
- Cons: largest schema/runtime complexity; not necessary for immediate risk reduction.

- Recommended rollout (for Option 2):
1. Define states/events + transition matrix and tests without changing behavior.
2. Route all writes in `sessions.go`, `hooks.go`, `tasks.go`, and reconcile/cleanup paths through the module.
3. Centralize websocket status broadcast emission from the transition result.
4. Remove remaining direct status writes and keep one fallback metric/log for invalid transition attempts.

- Implementation status (2026-02-13):
- Added dedicated lifecycle module `backend/internal/sessionlifecycle/lifecycle.go` with typed events, allowed transition rules, and invalid-transition errors.
- Added transition tests in `backend/internal/sessionlifecycle/lifecycle_test.go`.
- Wired transition application into runtime start/send/stop/delete/reconcile/zombie-cleanup/runtime-exit paths in `backend/internal/api/sessions.go`.
- Wired hook-driven transitions through lifecycle events in `backend/internal/api/hooks.go`.
- Added centralized transition helpers + status broadcast helper in `backend/internal/api/session_lifecycle.go`.
- Added integration guard test to prevent reopening completed sessions from late hooks in `backend/internal/api/session_lifecycle_transition_test.go`.
- Validation:
- `cd backend && GOTOOLCHAIN=auto go test ./internal/api` -> pass.
- `cd backend && GOTOOLCHAIN=auto go test ./...` -> pass.
- `cd backend && GOTOOLCHAIN=auto go vet ./...` -> pass.
