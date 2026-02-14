# Codeburg Audit (February 13, 2026)

## Scope and method

- Reviewed backend and frontend source with focus on auth/session lifecycle, process execution, file/workspace APIs, Git/tunnel endpoints, and websocket flows.
- Executed baseline checks:
  - `just test` (all tests passed)
  - `GOTOOLCHAIN=auto go vet ./...` (passed)
  - `pnpm lint` (failed with 2 findings; listed below)

## High-priority findings (bugs + security)

### 1. Path traversal local file read in Git diff-content endpoint

- Severity: High
- Evidence:
  - `backend/internal/api/git.go:1059`
  - `backend/internal/api/git.go:1126`
  - `backend/internal/api/git.go:1140`
- Details:
  - `gitDiffContent` builds `absFile := filepath.Join(workDir, file)` and reads it directly with `os.ReadFile(absFile)` for unstaged/base flows.
  - `file` comes from query params and is not normalized with `safeJoin`/path traversal checks.
  - An authenticated caller can request paths like `../../...` and read arbitrary files accessible to the backend process.
- Recommendation:
  - Validate `file` with the same safe-path logic used in workspace APIs (`normalizeRelativePath` + `safeJoin`).

### 2. Chat sessions default to auto-approve dangerous tool permissions

- Severity: High
- Evidence:
  - `backend/internal/api/sessions_command.go:141`
  - `backend/internal/api/sessions_command.go:143`
  - `backend/internal/api/sessions_command.go:144`
- Details:
  - `chatAutoApproveEnabled()` defaults to `true` when env var is unset.
  - This causes Claude chat turns to run with `--dangerously-skip-permissions` and Codex with `--full-auto`.
  - Compromises least-privilege posture by default.
- Recommendation:
  - Add an option to the session creation UI for adding/not adding the corresponding flag to the session command.

### 3. JWT bearer tokens are sent in websocket query strings

- Severity: High
- Evidence:
  - `frontend/src/hooks/useTerminal.ts:110`
  - `frontend/src/hooks/useChatSession.ts:78`
  - `frontend/src/hooks/useSharedWebSocket.ts:90`
  - `frontend/src/hooks/useWebSocket.ts:69`
  - `backend/internal/api/websocket.go:263`
- Details:
  - Query-string tokens are exposed in logs, browser history snapshots, reverse proxy access logs, and monitoring tools.
  - Backend supports token extraction from query params and Authorization headers for WS requests.
- Recommendation:
  - Prefer post-upgrade auth messages only (or short-lived one-time WS tickets); stop putting bearer tokens in URL query strings.

### 4. Hook endpoint accepts full user JWT in addition to scoped hook token

- Severity: Medium
- Evidence:
  - `backend/internal/api/hooks.go:50`
  - `backend/internal/api/hooks.go:57`
- Details:
  - Hook endpoint allows either scoped hook token or full user JWT.
  - Weakens token scoping: any valid full token can mutate session status via hook endpoint.
- Recommendation:
  - Require scoped hook token only for `/api/sessions/{id}/hook`.

### 5. Project deletion does not clean runtime resources (sessions, tunnels, worktrees)

- Severity: Medium
- Evidence:
  - `backend/internal/api/projects.go:314`
  - `backend/internal/api/projects.go:317`
  - `backend/internal/api/tasks.go:564` (task deletion has proper cleanup logic for comparison)
- Details:
  - Deleting a project only removes DB rows.
  - In-memory runtimes and external processes can be orphaned (PTY sessions, cloudflared tunnels, worktrees/scripts/files).
- Recommendation:
  - Mirror cleanup steps used in `handleDeleteTask` before deleting project records.

### 6. Tunnel creation can block indefinitely and serializes all tunnel manager access

- Severity: Medium
- Evidence:
  - `backend/internal/tunnel/tunnel.go:58`
  - `backend/internal/tunnel/tunnel.go:59`
  - `backend/internal/tunnel/tunnel.go:128`
- Details:
  - Manager lock is held for the entire `Create` call.
  - URL wait has no timeout (context is background + cancel only), so if cloudflared never emits a URL, the request can hang and block tunnel manager operations.
- Recommendation:
  - Release lock before process start/wait path.
  - Add a bounded timeout for URL discovery.

## Additional bugs and reliability risks

### 7. Tunnel/task/project endpoints do not validate referenced entity existence

- Severity: Medium
- Evidence:
  - `backend/internal/api/tunnels.go:27`
  - `backend/internal/api/tunnels.go:77`
- Details:
  - Tunnel create/list routes use path IDs without checking task/project existence.
  - Allows orphan tunnel metadata and resource usage tied to invalid IDs.
- Recommendation:
  - Check `GetTask`/`GetProject` before list/create operations.

### 8. Potential SSE deadlock in streaming Justfile endpoint under heavy output

- Severity: Medium
- Evidence:
  - `backend/internal/api/justfile.go:180`
  - `backend/internal/api/justfile.go:186`
  - `backend/internal/api/justfile.go:194`
  - `backend/internal/api/justfile.go:220`
- Details:
  - Stdout/stderr goroutines send to a bounded channel; if writer blocks (slow client), producers block and may stop draining process pipes.
  - Can stall `cmd.Wait()` and keep request hanging.
- Recommendation:
  - Use non-blocking fan-in with backpressure policy or direct line streaming with controlled worker.

### 9. JWT secret generation ignores `rand.Read` errors

- Severity: Low
- Evidence:
  - `backend/internal/api/auth.go:52`
  - `backend/internal/api/auth.go:60`
- Details:
  - Failures in CSPRNG reads are silently ignored.
- Recommendation:
  - Handle `rand.Read` errors and fail safe.

## Security posture concerns

### 10. Login rate limiter map can grow unbounded with many spoofed/new IPs

- Severity: Low
- Evidence:
  - `backend/internal/api/auth.go:219`
  - `backend/internal/api/auth.go:241`
  - `backend/internal/api/auth.go:247`
- Details:
  - Expired entries are pruned only for the current key; no global cleanup/eviction.
- Recommendation:
  - Periodic cleanup + size cap (LRU/TTL) to avoid memory growth.

## Code smells and maintainability

### 11. Frontend lint is currently failing

- Severity: Medium (quality gate)
- Evidence:
  - `frontend/src/components/layout/Sidebar.tsx:28`
  - `frontend/src/hooks/useChatSession.ts:85`
- Details:
  - `react-refresh/only-export-components` violation in `Sidebar.tsx`.
  - `react-hooks/set-state-in-effect` violation in `useChatSession.ts`.
- Recommendation:
  - Split helper export from component file.
  - Refactor initialization effect to avoid synchronous state resets inside effect body.

### 12. Regex search recompiles regex for every line and silently ignores invalid regex

- Severity: Low
- Evidence:
  - `backend/internal/api/project_workspace.go:1402`
  - `backend/internal/api/project_workspace.go:1404`
- Details:
  - Expensive repeated compile inside hot loop.
  - Invalid regex returns empty results instead of user-facing validation error.
- Recommendation:
  - Compile once before traversal; return `400` for invalid regex.

## Potential improvements

- Standardize path validation across all file-related endpoints, including Git diff-content and any future file viewers.
- Add integration tests for security-critical surfaces:
  - Git diff-content traversal attempts.
  - Hook endpoint scope enforcement.
  - WebSocket auth path without query token.
- Add operational timeouts and circuit breakers for external process integrations (`cloudflared`, `gh`, `git` in large repos).
- Add structured audit logging for destructive operations (`project delete`, `task delete`, `git revert/clean`, `worktree delete`).
- Treat lint as a CI gate (`pnpm lint`) to prevent known regressions from landing.

## Feature ideas

- Session safety mode:
  - Per-session permission mode (`strict`, `ask`, `auto`) exposed in UI and persisted in session metadata.
- Security dashboard:
  - Show active tokens/hooks/scripts with expiration and quick revoke.
- Pre-flight checks before destructive actions:
  - Confirm worktree/session/tunnel cleanup plan in one modal and preview impact.
- Endpoint capability profiles:
  - Optional read-only mode for external demos or shared environments.
- Background health diagnostics:
  - Detect and surface orphaned processes/worktrees/tunnels with one-click remediation.
