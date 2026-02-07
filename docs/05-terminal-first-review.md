# Terminal-First Implementation: Code Review Issues

Post-implementation review of the terminal-first sessions rewrite. Each issue has a severity, location, description, and space for resolution notes.

---

## 1. Unsanitized `model` Field in Shell Command

**Severity**: Minor
**File**: `backend/internal/api/sessions.go` ~line 174-176
**Status**: FIXED

The `model` field from the API request is interpolated directly into a shell command string via `fmt.Sprintf`. A model name with spaces or special characters could produce a malformed command, causing confusing session failures.

```go
cmd = fmt.Sprintf(`CODEBURG_TOKEN=%s claude --model %s`, token, req.Model)
```

Not a security concern — Codeburg is single-user and the caller already has full terminal access via tmux. JWT bearer auth prevents CSRF. This is purely a robustness issue.

**Fix**: Validate `model` to alphanumeric + hyphens only, so invalid values fail early with a clear error.

**Resolution notes**:
Fixed. Added `isValidModelName()` validation in `handleStartSession` before any session/tmux resources are created. Model must start with a letter and contain only letters, digits, hyphens, dots, and colons (covers names like `claude-sonnet-4-5-20250929`, `gpt-5.2-codex`, `o3`). Returns 400 with a clear error message on invalid input.

---

## 2. `handleStopSession` Lost Tmux Fallback

**Severity**: Bug
**File**: `backend/internal/api/sessions.go` (handleStopSession)
**Status**: FIXED

The old implementation had a fallback: if the in-memory session map didn't have the session (e.g., after a server restart), it would still attempt cleanup via the DB record's tmux window ID. The rewrite only checks the in-memory `sessions` map and returns 404 if missing.

**Fix**: Fall back to DB lookup for `tmux_window`/`tmux_pane` when the session isn't in the in-memory map.

**Resolution notes**:
Fixed in session lifecycle & observability PR. `handleStopSession` now uses `getOrRestore()` which checks in-memory map then falls back to DB + tmux check. If even that returns nil (window already gone), it still attempts best-effort `DestroyWindow` using the DB's `TmuxWindow` field. Additionally, startup reconciliation (`Reconcile()`) restores all active sessions with live tmux windows on server restart, and a background cleanup loop detects zombie sessions every 30s.

---

## 3. Race Condition on `executor.Session.Status`

**Severity**: Bug
**File**: `backend/internal/api/sessions.go` (setSessionRunning, trackActivity)
**Status**: FIXED

The `mu` mutex on `SessionManager` only guards `LastActivityAt` updates. But `setSessionRunning()` reads `session.Status` without holding the lock, while other goroutines (hook handler, stop handler) can write to it concurrently.

**Fix**: Either protect `Status` reads/writes with the same mutex, or use `atomic` operations for status.

**Resolution notes**:
Fixed with `CompareAndSetStatus`/`SetStatus`/`GetStatus` methods on `executor.Session`, all guarded by the existing `Session.mu`. `setSessionRunning` uses `CompareAndSetStatus(WaitingInput, Running)` to atomically check-and-swap with no TOCTOU gap. The hook handler uses `SetStatus()`. Construction-time writes (in `getOrRestore`/`Reconcile`) remain direct field access since the session isn't shared yet.

---

## 4. `writeClaudeHooks` Clobbers User Hooks

**Severity**: Bug
**File**: `backend/internal/api/sessions.go` (writeClaudeHooks)
**Status**: FIXED

The function reads existing `settings.local.json` and merges at the top level, but replaces the entire `hooks` key. If the user had custom hooks configured for other events (or additional hooks on the same events), they'd be overwritten.

**Fix**: Merge at the event level — append Codeburg hooks to existing arrays per event rather than replacing the whole `hooks` object.

**Resolution notes**:
Fixed. `writeClaudeHooks` now preserves the existing `hooks` object and all its events. For the three events Codeburg needs (`Notification`, `Stop`, `SessionEnd`), it strips any previous Codeburg matcher entries (identified by `isCodeburgHookEntry` — looks for `/api/sessions/` + `/hook` in command strings) then appends the fresh entry. User hooks on other events and user matcher entries on the same events are untouched.

---

## 5. Notify Script Contains Plaintext JWT

**Severity**: Security
**File**: `backend/internal/api/sessions.go` (writeCodexNotifyScript, writeClaudeHooks)
**Status**: FIXED

Both `.codeburg-notify.sh` and `.claude/settings.local.json` contain the full JWT token in plaintext. These files sit in the worktree directory which is a git repo. If accidentally committed, the token leaks.

Additionally, `.codeburg-notify.sh` is not automatically added to `.gitignore`.

**Fix options**:
- Add `.codeburg-notify.sh` and `.claude/settings.local.json` to `.gitignore` automatically when creating them
- Use a file-based token reference instead of inline (e.g., read from `~/.codeburg/.session_token`)
- Use short-lived, session-scoped tokens (see issue #6)

**Resolution notes**:
Fixed together with issue #6. Tokens are no longer written into the worktree. Instead, `writeHookToken()` writes the scoped JWT to `~/.codeburg/tokens/{sessionID}` (dir mode 0700, file mode 0600). Hook scripts reference the file at runtime: `writeClaudeHooks` uses `$(cat '<tokenPath>')` in the curl command, and `writeCodexNotifyScript` reads `TOKEN=$(cat '<tokenPath>')` at the top of the script. An accidental `git add .` in the worktree no longer captures any token. Token files are cleaned up on session stop, session end (via hook), and zombie session cleanup.

---

## 6. Hook Tokens Are Full User-Equivalent JWTs

**Severity**: Security
**File**: `backend/internal/api/sessions.go` (generateSessionToken)
**Status**: FIXED

The tokens baked into hook scripts are full 7-day JWTs identical to user login tokens. A leaked hook token grants full API access (create/delete projects, tasks, etc.), not just the ability to update one session's status.

**Fix**: Generate scoped tokens with claims like `{"scope": "session_hook", "session_id": "..."}` and validate scope in the hook endpoint. Or use a separate HMAC-based token mechanism for hooks.

**Resolution notes**:
Fixed. `AuthService.GenerateHookToken(sessionID)` creates a JWT with claims `{sub: "hook", scope: "session_hook", sid: "<sessionID>", exp: +7d}`. `ValidateHookToken(token, sessionID)` checks that `scope == "session_hook"` and `sid` matches the target session. `ValidateToken()` now rejects tokens with a `scope` claim, so a scoped hook token cannot be used against protected API endpoints. The hook route (`POST /api/sessions/{id}/hook`) was moved out of the `authMiddleware` group and validates tokens inline: it tries the scoped path first, then falls back to a full user JWT for backward compatibility with sessions started before the upgrade. Tests cover scoped token success, wrong-session rejection, and missing-token rejection.

---

## 7. `sessionType` Field Is Vestigial

**Severity**: Smell
**File**: `backend/internal/db/sessions.go`, migration v4
**Status**: KEPT (intentional)

The DB column `session_type` still exists and is always set to `"terminal"`. Migration v4 updates old `claude` values to `terminal`, but the column itself serves no purpose anymore — `provider` carries the meaningful distinction.

**Fix**: Either drop the column in a future migration, or repurpose it. For now it's harmless but confusing.

**Resolution notes**:
Kept intentionally. `provider` and `session_type` are orthogonal axes: provider is *what* is running (claude, codex, terminal), session_type is *how* the session is delivered. Currently always `"terminal"` (tmux + xterm.js), but reserved for future modes: `"chat"` (rich UI with markdown/diff rendering), `"headless"` (background tasks with no live UI), `"api"` (direct API calls without CLI). A doc comment was added to `AgentSession` explaining the distinction. The stale default in `CreateSession` (was `"claude"`, never hit) was corrected to `"terminal"`.

---

## 8. Duplicate Status Type Definitions

**Severity**: Smell
**File**: `backend/internal/db/sessions.go`, `backend/internal/executor/executor.go`
**Status**: FIXED

`SessionStatus` is defined as a type in both `db` and `executor` packages with the same string constants (`running`, `waiting_input`, `completed`, `error`). This creates confusion about which to use and risks them drifting apart.

**Fix**: Define status constants in one place (likely `executor` or a shared `model` package) and import everywhere.

**Resolution notes**:
Fixed together with #13. The `executor` package was deleted entirely. `SessionStatus` now lives solely in `db/sessions.go`. The in-memory `Session` struct (previously `executor.Session`) was moved into `api/exec_session.go` and uses `db.SessionStatus` directly for its `Status` field. All casts like `executor.SessionStatus(dbSession.Status)` are eliminated — the types match natively. The `Provider` field was also simplified from a dedicated `executor.Provider` type to a plain `string`, since the type-safe constants were never used (provider validation already used raw string comparisons).

---

## 9. Dead Line in `writeCodexNotifyScript`

**Severity**: Minor
**File**: `backend/internal/api/sessions.go` ~line 433
**Status**: FIXED

There appears to be a dead/unreachable line or unnecessary statement in the notify script writer. Verify and remove if confirmed.

**Resolution notes**:
The dead line was `strings.ReplaceAll(script, "'"+token+"'", token)` — a no-op "safety" escape for single quotes in raw tokens. Removed as part of the #5/#6 fix which rewrote `writeCodexNotifyScript` to read the token from a file instead of inlining it.

---

## 10. Codex CLI `--notify` Flag Unverified

**Severity**: Unverified Assumption
**File**: `backend/internal/api/sessions.go` (codex command construction)
**Status**: FIXED

The implementation assumes Codex CLI accepts `--config notify='[...]'` or a similar flag for the notify callback. This was based on research but hasn't been tested against an actual Codex CLI installation.

**Fix**: Test with actual Codex CLI. If the flag doesn't exist, fall back to writing `~/.codex/config.toml` or use terminal activity detection only.

**Resolution notes**:
Confirmed: the `--notify` CLI flag does not exist in Codex CLI. Notifications are configured via the `notify` key in `~/.codex/config.toml`. However, the `-c key=value` flag allows inline config overrides with TOML-parsed values. Tested with Codex CLI v0.98.0 — `codex -c 'notify=["/path/to/script.sh"]' "prompt"` is accepted without config errors (only failed on API auth, not config parsing).

Fixed: command construction now uses `-c 'notify=["/path/to/.codeburg-notify.sh"]'` instead of `--notify`. Additionally, the notify script was fixed to forward `$1` (the JSON event payload) as the curl request body, since Codex passes event data as the last positional argument, not via stdin. The hook handler (`hooks.go`) was updated to accept both Claude Code's `hook_event_name` and Codex's `type` field via a `HookPayload.EventName()` method.

---

## 11. Claude Code Hook Stdin Field Name Unverified

**Severity**: Unverified Assumption
**File**: `backend/internal/api/hooks.go` (hook event parsing)
**Status**: VERIFIED

The hook handler parses `hook_event_name` from the JSON payload piped to curl via stdin. The actual field name in Claude Code's hook JSON may differ (e.g., `event`, `type`, `hookEventName`).

**Fix**: Verify against actual Claude Code hook output. Run a test hook that dumps stdin to a file and inspect the JSON structure.

**Resolution notes**:
Verified correct per official Claude Code hooks documentation. All hook commands receive a JSON payload on stdin with common fields: `hook_event_name`, `session_id`, `transcript_path`, `cwd`, `permission_mode`. The `hook_event_name` field is exactly what the handler parses. Event-specific fields are also present (e.g., `Notification` adds `message`, `title`, `notification_type`; `Stop` adds `stop_hook_active`; `SessionEnd` adds `reason`). No code changes needed.

---

## 12. `trackActivity()` Double Lock Round-Trip

**Severity**: Minor / Performance
**File**: `backend/internal/api/terminal.go` (trackActivity)
**Status**: PARTIAL

`trackActivity()` is called on every PTY read (which can be very frequent during heavy output). It acquires a lock, checks time, and potentially does a DB write. Two lock acquisitions per call (one for the time check, one for the DB update) adds unnecessary overhead.

**Fix**: Use a single lock acquisition, or move to an atomic timestamp comparison before taking the lock. Consider a longer debounce interval (current is 5s, could be 10-15s for `lastActivityAt`).

**Resolution notes**:
Partially improved in session lifecycle PR. `trackActivity()` now uses `getOrRestore()` for the session lookup (one `SessionManager.mu` acquisition instead of a manual lock/unlock pair). The `Session.mu` lock for `LastActivityAt` read/write remains as a separate acquisition. The 5s debounce interval is unchanged. Further optimization (atomic timestamp) still possible but low priority.

---

## 13. `executor` Package Is Just Types Now

**Severity**: Smell
**File**: `backend/internal/executor/executor.go`
**Status**: FIXED

After the rewrite, the `executor` package contains only type definitions (`Session`, `Provider`, `SessionStatus` constants). It no longer "executes" anything. The name is misleading.

**Fix options**:
- Rename to `model` or `session` package
- Move types into `db` or `api` package and delete `executor/`
- Leave as-is if a future executor implementation is planned

**Resolution notes**:
Fixed together with #8. The `executor` package was deleted. Its sole remaining type, the `Session` struct (with thread-safe `GetStatus`/`SetStatus`/`CompareAndSetStatus`/`SetLastActivity`/`GetLastActivity` methods), was moved to `api/exec_session.go`. This is the only consumer package, so no new shared package was needed. `SessionStatus` constants are sourced from `db`, and `Provider` was simplified to a plain `string`.

---

## Summary

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Unsanitized `model` in shell cmd | Minor | FIXED |
| 2 | Stop session lost tmux fallback | Bug | FIXED |
| 3 | Race condition on Session.Status | Bug | FIXED |
| 4 | writeClaudeHooks clobbers user hooks | Bug | FIXED |
| 5 | Plaintext JWT in notify scripts | Security | FIXED |
| 6 | Hook tokens are full user JWTs | Security | FIXED |
| 7 | `sessionType` field vestigial | Smell | KEPT |
| 8 | Duplicate status type definitions | Smell | FIXED |
| 9 | Dead line in writeCodexNotifyScript | Minor | FIXED |
| 10 | Codex `--notify` flag unverified | Assumption | FIXED |
| 11 | Hook stdin field name unverified | Assumption | VERIFIED |
| 12 | trackActivity double lock | Performance | PARTIAL |
| 13 | executor package misnamed | Smell | FIXED |

---
---

# General Code Review (2025-02-06)

Full-project review covering backend, frontend, and infrastructure. Organized into issues, suggested changes, and next steps.

---

## New Issues

### 14. CORS Accepts Any HTTPS Origin

**Severity**: Security
**File**: `backend/internal/api/server.go:59`
**Status**: FIXED

```go
AllowedOrigins: []string{"http://localhost:*", "https://*"},
```

The `https://*` wildcard means any HTTPS site can make authenticated cross-origin requests to the Codeburg API. A malicious page could call Codeburg endpoints using the user's JWT from cookies/localStorage. Since Codeburg is single-user with JWT bearer auth (not cookies), the practical risk is lower — an attacker would need the token. But if the token leaks (XSS, browser extension, shared machine), CORS is the last line of defense and it's wide open.

**Fix**: Restrict to known origins. Use an env var or config field.

**Resolution notes**:
Fixed. Extracted `allowedOrigins` list (`http://localhost:*`, `https://codeburg.miscellanics.com`) as a package-level var in `server.go`. CORS middleware now references this list instead of `https://*`. An `isAllowedOrigin()` helper handles the `localhost:*` wildcard pattern by parsing the origin URL and comparing scheme+hostname without port.

---

### 15. WebSocket Origin Check Disabled

**Severity**: Security
**File**: `backend/internal/api/websocket.go:17-20`
**Status**: FIXED

```go
CheckOrigin: func(r *http.Request) bool {
    // Allow all origins in development
    // TODO: Restrict in production
    return true
},
```

Any website can open a WebSocket to Codeburg's `/ws` and `/ws/terminal` endpoints. Combined with a leaked or XSS-stolen token, this gives full terminal access. Even without a token, if auth isn't enforced on the WS upgrade (verify this), any page could subscribe to real-time events.

**Fix**: Validate the `Origin` header against the same allowlist used for CORS.

**Resolution notes**:
Fixed together with #14. The `websocket.Upgrader.CheckOrigin` now calls `isAllowedOrigin(r.Header.Get("Origin"))`, using the same `allowedOrigins` list and matching logic as the CORS middleware. Both `/ws` and `/ws/terminal` use this upgrader.

---

### 16. Double `close(client.send)` Panic Risk in WSHub

**Severity**: Bug
**File**: `backend/internal/api/websocket.go:75-85`
**Status**: FIXED

In the broadcast branch, when a client's send buffer is full:
```go
default:
    close(client.send)
    delete(h.clients, client)
```

This runs under `RLock`, but `delete` requires a write lock. Additionally, if the client disconnects concurrently and triggers `unregister`, that path also calls `close(client.send)`. Closing an already-closed channel panics.

**Fix**: In the broadcast `default` case, don't close/delete — just skip the message. Let the client's own goroutine handle cleanup via `unregister`. Or use `sync.Once` on the channel close.

**Resolution notes**:
Fixed. The broadcast `default` case now just skips the message (comment: "Skip slow client — its own goroutine will handle cleanup via unregister"). No `close(client.send)` or `delete` under `RLock`. The client's `writePump` goroutine will detect the issue when the channel closes via `unregister`.

---

### 17. `TerminalSession.close()` Holds Mutex During Blocking I/O

**Severity**: Bug
**File**: `backend/internal/api/terminal.go:215-234`
**Status**: FIXED

```go
func (ts *TerminalSession) close() {
    ts.mu.Lock()
    defer ts.mu.Unlock()
    // ...
    ts.cmd.Process.Kill()
    ts.cmd.Wait()  // Can block indefinitely
    ts.conn.Close()
}
```

`cmd.Wait()` blocks until the process exits. If the process ignores SIGKILL (zombie, D-state), this holds the lock forever. Any other goroutine that touches `ts.mu` (e.g., the PTY read loop checking `ts.closed`) deadlocks.

**Fix**: Capture references under the lock, then do I/O outside:
```go
ts.mu.Lock()
if ts.closed { ts.mu.Unlock(); return }
ts.closed = true
ptmx, cmd, conn := ts.ptmx, ts.cmd, ts.conn
ts.mu.Unlock()
// cleanup ptmx, cmd, conn without lock
```

**Resolution notes**:
Fixed exactly as described. `close()` now captures `ptmx`, `cmd`, and `conn` under the lock, sets `closed = true`, releases the lock, then performs all blocking I/O (ptmx.Close, cmd.Process.Kill, cmd.Wait, conn.Close) without holding the mutex.

---

### 18. Unchecked `hex.DecodeString` in Auth Init

**Severity**: Bug
**File**: `backend/internal/api/auth.go:51`
**Status**: FIXED

```go
secret, _ = hex.DecodeString(string(secret))
```

If `~/.codeburg/.jwt_secret` is corrupted (non-hex characters), this silently returns an empty byte slice. The auth service initializes with an empty secret, making all JWTs trivially forgeable (HMAC with empty key). Every existing token also becomes invalid, locking out the user with no error message.

**Fix**: Check the error. If corrupt, log a warning and regenerate:
```go
decoded, err := hex.DecodeString(string(secret))
if err != nil {
    slog.Warn("corrupt jwt secret, regenerating", "error", err)
    decoded = make([]byte, 32)
    rand.Read(decoded)
    os.WriteFile(secretPath, []byte(hex.EncodeToString(decoded)), 0600)
}
```

**Resolution notes**:
Fixed. `hex.DecodeString` error is now checked. On corrupt file, logs a warning and regenerates. Also trims whitespace from the file contents before decoding (handles trailing newline from manual edits).

---

### 19. Cleanup Loop TOCTOU Race

**Severity**: Bug
**File**: `backend/internal/api/sessions.go:498-520`
**Status**: OPEN

The cleanup loop copies session IDs under `RLock`, releases, then re-acquires `RLock` per ID to read the session. Between releasing and re-acquiring, another goroutine can delete or modify the session. The subsequent `WindowExists` check and `delete` operate on potentially stale data.

Practically low risk at current scale (30s tick, single user), but wrong in principle and will bite under concurrency.

**Fix**: Check existence and extract what you need in a single lock acquisition. Or hold a read lock for the entire iteration and only upgrade to write for deletions.

---

### 20. `runScript` Has No Timeout or Resource Limits

**Severity**: Bug
**File**: `backend/internal/worktree/worktree.go:258-266`
**Status**: FIXED

```go
func (m *Manager) runScript(workDir, script string) error {
    cmd := exec.Command("sh", "-c", script)
    cmd.Dir = workDir
    return cmd.Run()
}
```

Setup/teardown scripts run with no timeout. A script with `sleep infinity` or an infinite loop hangs the HTTP request forever. The user-configured script is trusted input, but a typo or accidental infinite loop shouldn't bring down the server.

**Fix**: Use `exec.CommandContext` with a 2-5 minute timeout.

**Resolution notes**:
Fixed. `runScript` now uses `exec.CommandContext` with a 5-minute timeout via `context.WithTimeout`.

---

### 21. No Rate Limiting on `/api/auth/login`

**Severity**: Security
**File**: `backend/internal/api/auth.go`
**Status**: OPEN

The login endpoint has no rate limiting. Even though Codeburg is single-user/local, if exposed via tunnel (cloudflared support is built in), the password can be brute-forced. bcrypt's cost factor helps, but doesn't replace rate limiting.

**Fix**: Add a simple in-memory rate limiter — e.g., max 5 failed attempts per minute per IP, with exponential backoff.

---

### 22. `hookURL` Interpolated Into Shell Script

**Severity**: Minor
**File**: `backend/internal/api/sessions.go:664-674`
**Status**: FIXED

```go
hookURL := fmt.Sprintf("%s/api/sessions/%s/hook", apiURL, sessionID)
script := fmt.Sprintf(`...
  %s
`, tokenPath, hookURL)
```

`apiURL` comes from the HTTP request's `Host` header (or a config value). `sessionID` is a ULID (safe). If `apiURL` contained shell metacharacters, they'd be interpreted. Currently safe because the URL construction is internal, but fragile — a future refactor could introduce an attacker-controlled component.

**Fix**: Shell-quote the URL in the template: `'%s'` instead of `%s`.

**Resolution notes**:
Fixed. Both `writeClaudeHooks` (curl command) and `writeCodexNotifyScript` (script body) now single-quote the hookURL: `'%s'` instead of `%s`.

---

### 23. TerminalModal and TerminalView Are Near-Identical

**Severity**: Smell
**File**: `frontend/src/components/terminal/TerminalModal.tsx`, `frontend/src/components/session/TerminalView.tsx`
**Status**: FIXED

These two files duplicate ~100 lines of terminal setup: Terminal instantiation, theme config, WebSocket connection, resize handling, input piping, and cleanup. The only differences are the surrounding chrome (modal wrapper vs inline div) and that TerminalModal adds Escape-to-close.

**Fix**: Extract a `useTerminal(containerRef, target, sessionId?)` hook that returns cleanup functions. Both components call the hook and only differ in their JSX wrapper.

**Resolution notes**:
Extracted `useTerminal(containerRef, target, options?)` hook to `frontend/src/hooks/useTerminal.ts`. The hook owns Terminal creation (with shared `TERMINAL_THEME` constant), FitAddon, WebSocket lifecycle, input/resize piping, ResizeObserver, and cleanup. `TerminalView` is now 19 lines (ref + hook + bare div). `TerminalModal` is 50 lines (ref + hook + Ctrl+Esc handler + modal chrome). Also resolves #29 (terminal theme hardcoded twice) since the theme now lives in one place.

---

### 24. Status Color/Text Mapping Duplicated in 3+ Places

**Severity**: Smell
**File**: `frontend/src/components/session/SessionView.tsx:50-62`, `SessionList.tsx:64-77`, and Dashboard task cards
**Status**: OPEN

Session status → color/text mapping is implemented as independent `switch` statements in `StatusIndicator`, `SessionStatusBadge`, and task status rendering. They use different class names for the same semantic meaning (e.g., `bg-accent animate-pulse` vs `status-in-progress` for running).

**Fix**: Create a shared `SESSION_STATUS_CONFIG` map:
```ts
export const SESSION_STATUS: Record<SessionStatus, { color: string; label: string }> = { ... };
```

---

### 25. `getTasksByStatus` Recomputed Every Render

**Severity**: Performance
**File**: `frontend/src/pages/Dashboard.tsx:58-60`
**Status**: FIXED

```tsx
const getTasksByStatus = (status: TaskStatus): Task[] => {
  return tasks?.filter((t) => t.status === status) ?? [];
};
```

Called 4+ times per render (once per kanban column, plus column headers). Each call filters the full task array. With 100+ tasks, that's 400+ comparisons per render.

**Fix**: Memoize with `useMemo`:
```tsx
const tasksByStatus = useMemo(() => {
  const map = new Map<TaskStatus, Task[]>();
  for (const t of tasks ?? []) {
    const list = map.get(t.status) ?? [];
    list.push(t);
    map.set(t.status, list);
  }
  return map;
}, [tasks]);
```

**Resolution notes**:
Fixed. Added `useMemo` that groups tasks by status into a `Map<TaskStatus, Task[]>` (pre-initialized with empty arrays for all columns). `getTasksByStatus` now does a simple map lookup instead of filtering.

---

### 26. Session Polling Doesn't Pause in Background Tabs

**Severity**: Performance
**File**: `frontend/src/pages/TaskDetail.tsx:37`
**Status**: FIXED

```tsx
refetchInterval: 5000,
```

React Query's `refetchInterval` fires continuously even when the tab is hidden. On mobile this drains battery; on desktop it's wasted network.

**Fix**: Add `refetchIntervalInBackground: false` to the query options.

**Resolution notes**:
Fixed. Added `refetchIntervalInBackground: false` to the sessions query options.

---

### 27. `SessionStatusBadge` Uses `status: string` Instead of `SessionStatus`

**Severity**: Smell
**File**: `frontend/src/components/session/SessionList.tsx:59-61`
**Status**: FIXED

```tsx
interface SessionStatusBadgeProps {
  status: string;  // should be SessionStatus
}
```

The component accepts any string but only handles known status values in its switch. A typo in a caller wouldn't be caught at compile time.

**Fix**: Use `SessionStatus` type from the API types.

**Resolution notes**:
Fixed. `SessionStatusBadgeProps.status` now uses `SessionStatus` type imported from `../../api/sessions`.

---

### 28. No Error Boundary in the React App

**Severity**: UX
**File**: `frontend/src/` (missing)
**Status**: OPEN

If any component throws during render, the entire app white-screens with no recovery path. Terminal views, WebSocket handlers, and JSON parsing are all potential throw sites.

**Fix**: Add an error boundary component wrapping the main content area. Show a "something went wrong" message with a reload button.

---

### 29. Terminal Theme Hardcoded Inline in Two Places

**Severity**: Minor
**File**: `frontend/src/components/terminal/TerminalModal.tsx:25-47`, `frontend/src/components/session/TerminalView.tsx:24-46`
**Status**: FIXED

The 16-color terminal theme is defined as an inline object literal in both files. If you change a color in one, you must remember to change the other.

**Fix**: Extract to a shared constant (resolves automatically if #23 is fixed via a shared hook).

**Resolution notes**:
Resolved by #23. `TERMINAL_THEME` is now a single constant in `frontend/src/hooks/useTerminal.ts`.

---

## Suggested Changes (Non-Issue Improvements)

These aren't bugs or security issues — they're structural improvements for maintainability and correctness.

### C1. Add Graceful Shutdown to Background Goroutines

**File**: `backend/internal/api/server.go`, `sessions.go`, `websocket.go`

The WSHub `Run()` loop, `StartCleanupLoop`, and `Reconcile` have no shutdown mechanism. When the process receives SIGINT/SIGTERM, these goroutines just die mid-iteration. This can leave tmux state inconsistent (e.g., a cleanup half-completed) and WebSocket clients get hard-disconnected without a close frame.

**Change**: Wire a `context.Context` from `signal.NotifyContext` in `main.go` through to all background goroutines. Add a `Shutdown()` method to WSHub that closes a `done` channel. Use `http.Server.Shutdown()` for graceful HTTP drain.

---

### C2. Consolidate Duplicate Scan Functions

**File**: `backend/internal/db/sessions.go`, `projects.go`, `tasks.go`

Each entity has near-identical `scanX(*sql.Row)` and `scanXRows(*sql.Rows)` pairs. The only difference is `*sql.Row` vs `*sql.Rows`, but both implement `Scan(...any) error`.

**Change**: Use a shared scanner that takes a `func(dest ...any) error`:
```go
func scanSession(scan func(dest ...any) error) (*AgentSession, error) {
    var s AgentSession
    err := scan(&s.ID, &s.TaskID, ...)
    return &s, err
}
```
Then `scanSessionRow(row)` calls `scanSession(row.Scan)` and `scanSessionRows(rows)` calls `scanSession(rows.Scan)`.

---

### C3. Inject Dependencies Instead of Package Globals

**File**: `backend/internal/api/justfile.go:15`

```go
var justMgr = justfile.NewManager()
```

Package-level mutable state makes testing harder (state leaks between tests) and hides dependencies. Same pattern appears with the `upgrader` var in websocket.go.

**Change**: Add `justfile *justfile.Manager` as a field on `Server`. Initialize in `NewServer()`. Handlers access via `s.justfile.ListRecipes(...)`.

---

### C4. Introduce `db.ErrNotFound` for Cleaner HTTP Error Mapping

**File**: `backend/internal/db/` (all Get functions), `backend/internal/api/` (handlers)

Currently, `db.GetProject`, `db.GetTask`, `db.GetSession` return `sql.ErrNoRows` on not-found, and handlers either return 500 (wrong) or manually check for `sql.ErrNoRows`. This is error-prone — some handlers forget the check.

**Change**: Define `var ErrNotFound = errors.New("not found")` in the db package. Wrap `sql.ErrNoRows` in all `Get*` functions. Add a helper in `api`:
```go
func writeDBError(w http.ResponseWriter, err error) {
    if errors.Is(err, db.ErrNotFound) {
        writeError(w, 404, "not found")
    } else {
        writeError(w, 500, "internal error")
    }
}
```

---

### C5. Always Return Non-Nil Slices from DB List Functions

**File**: `backend/internal/db/sessions.go`, `projects.go`, `tasks.go`

Some `List*` functions return `nil` when there are no results, others return `[]T{}`. The API handlers paper over this with `if x == nil { x = []T{} }` before JSON serialization, but it's inconsistent and easy to forget.

**Change**: Initialize with `make([]*T, 0)` instead of `var results []*T` in all list functions. Guarantees `[]` in JSON, never `null`.

---

## Updated Summary

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Unsanitized `model` in shell cmd | Minor | FIXED |
| 2 | Stop session lost tmux fallback | Bug | FIXED |
| 3 | Race condition on Session.Status | Bug | FIXED |
| 4 | writeClaudeHooks clobbers user hooks | Bug | FIXED |
| 5 | Plaintext JWT in notify scripts | Security | FIXED |
| 6 | Hook tokens are full user JWTs | Security | FIXED |
| 7 | `sessionType` field vestigial | Smell | KEPT |
| 8 | Duplicate status type definitions | Smell | FIXED |
| 9 | Dead line in writeCodexNotifyScript | Minor | FIXED |
| 10 | Codex `--notify` flag unverified | Assumption | FIXED |
| 11 | Hook stdin field name unverified | Assumption | VERIFIED |
| 12 | trackActivity double lock | Performance | PARTIAL |
| 13 | executor package misnamed | Smell | FIXED |
| 14 | CORS accepts any HTTPS origin | Security | FIXED |
| 15 | WebSocket origin check disabled | Security | FIXED |
| 16 | WSHub double close(client.send) | Bug | FIXED |
| 17 | TerminalSession.close() blocks under lock | Bug | FIXED |
| 18 | Unchecked hex.DecodeString in auth | Bug | FIXED |
| 19 | Cleanup loop TOCTOU race | Bug | OPEN |
| 20 | runScript has no timeout | Bug | FIXED |
| 21 | No rate limiting on login | Security | OPEN |
| 22 | hookURL interpolated into shell | Minor | FIXED |
| 23 | TerminalModal/TerminalView duplication | Smell | FIXED |
| 24 | Status color mapping duplicated | Smell | OPEN |
| 25 | getTasksByStatus recomputed every render | Performance | FIXED |
| 26 | Session polling in background tabs | Performance | FIXED |
| 27 | SessionStatusBadge uses string type | Smell | FIXED |
| 28 | No error boundary in React app | UX | OPEN |
| 29 | Terminal theme hardcoded twice | Minor | FIXED |
