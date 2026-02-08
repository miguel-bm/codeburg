# Code Review Report

Date: 2026-02-08
Scope: Full codebase review (backend, frontend, tests, configuration)

## Rating Scale (1-5)

- **Confidence**: How sure we are this is a real issue (1=speculative, 5=certain)
- **Severity**: Impact if left unfixed (1=cosmetic, 5=data loss/security breach)
- **Ease of Fix**: How easy to resolve (1=major refactor, 5=quick fix)

---

## Critical Issues

### 1. ~~SQL Error Comparison by String~~ RESOLVED

**File**: `backend/internal/db/preferences.go:24`
**Category**: Bug
**Status**: Fixed (2026-02-08)

Uses `err.Error() == "sql: no rows in result set"` instead of `errors.Is(err, sql.ErrNoRows)`. Fragile, could break across Go versions or driver changes.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 4        | 5           |

---

### 2. ~~Unsafe Type Assertions on Cache Entries~~ RESOLVED

**File**: `backend/internal/api/sidebar.go:64,164`
**Category**: Bug
**Status**: Fixed (2026-02-08)

`cached.(diffStatsCacheEntry)` without comma-ok check. If the cache ever stores a different type (e.g. during a code change or race), the server panics.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 4        | 5           |

---

### 3. ~~No Error Boundaries in React App~~ RESOLVED

**File**: `frontend/src/App.tsx`
**Category**: Reliability
**Status**: Fixed (2026-02-08)

Any uncaught exception in a component tree crashes the entire app with a white screen. No recovery path for users.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 4        | 4           |

---

### 4. ~~No JWT Token Refresh or 401 Interception~~ PARTIALLY RESOLVED

**Files**: `frontend/src/api/client.ts:13-42`, `frontend/src/stores/auth.ts`
**Category**: UX / Auth
**Status**: 401 interception added (2026-02-08). Token refresh not implemented (would need backend endpoint).

Token is stored in localStorage with 7-day expiry but never refreshed. After expiry, API calls silently fail. No middleware intercepts 401 to redirect to login.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 4        | 3           |

---

## Major Issues

### 5. ~~Silent Error Suppression in Critical Paths~~ RESOLVED

**Files**:
- `backend/internal/api/tasks.go:137` - worktree auto-creation failure only `fmt.Printf`'d
- `backend/internal/api/sessions.go:354` - `GetSession` error discarded with `_`
- `frontend/src/api/preferences.ts:10` - `.catch(() => [])` swallows all errors

**Category**: Error Handling
**Status**: Partially fixed (2026-02-08) - backend items fixed, `preferences.ts` left as-is (intentional fallback for non-critical preference)

Errors in important paths are swallowed, making failures invisible. Worktree creation failure on task start is particularly bad since the user sees success but the task has no worktree.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 3        | 4           |

---

### 6. Resource Leak Risk in Terminal WebSocket

**File**: `backend/internal/api/terminal.go:30-68`
**Category**: Resource Management

If `ts.start()` fails after the WebSocket upgrade, the connection is closed but PTY resources (`ptmx`) may not be cleaned up.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 3          | 3        | 4           |

---

### 7. Race Condition in Session State Management

**File**: `backend/internal/api/exec_session.go:23-53`
**Category**: Concurrency

Session struct uses `sync.Mutex` for status but the in-memory session map uses coarser locking. A session can be deleted from the map while methods are still executing on it.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 3          | 3        | 2           |

---

### 8. Inconsistent Logging Strategy

**Files**:
- `backend/internal/worktree/worktree.go:140,147,175,202` - uses `fmt.Fprintf(os.Stderr)`
- ~~`backend/internal/api/tasks.go:137` - uses `fmt.Printf`~~ (fixed 2026-02-08, now uses `slog.Warn`)
- Other handlers use `slog`

**Category**: Observability

Mix of `fmt.Printf`, `fmt.Fprintf(os.Stderr)`, and `slog.*` makes log aggregation and filtering unreliable.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 2        | 4           |

---

### 9. Task Status Constants Not Shared

**Category**: Architecture

Backend defines `TaskStatus*` constants in Go. Frontend uses string literals (`"backlog"`, `"in_progress"`) scattered across components. A typo or rename on one side silently breaks the other.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 3        | 3           |

---

## Files That Need Breaking Up

### 10. Dashboard.tsx (1,089 lines)

**File**: `frontend/src/pages/Dashboard.tsx`
**Category**: Maintainability

Contains 7 components (`Dashboard`, `DropPlaceholder`, `NewTaskPlaceholder`, `TaskCard`, `TaskContextMenu`, `CreateTaskModal`, `WorkflowPromptModal`), plus complex drag-drop state, keyboard navigation with 25+ keybindings, and multiple modals.

**Suggested split**:
- `KanbanBoard.tsx` - layout and columns
- `TaskCard.tsx` - card rendering
- `TaskContextMenu.tsx` - context menu
- `CreateTaskModal.tsx` / `WorkflowPromptModal.tsx` - modals
- `useDashboardKeyboard.ts` - keyboard nav hook

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 2        | 2           |

---

### 11. Sidebar.tsx (759 lines)

**File**: `frontend/src/components/layout/Sidebar.tsx`
**Category**: Maintainability

Contains 6 nested components (`SidebarProjectNode`, `QuickAddTask`, `SidebarTaskNode`, `TaskNodeContextMenu`, `SidebarSessionNode`) plus collapse/expand state and keyboard navigation.

**Suggested split**: Extract each nested component to its own file under `components/layout/sidebar/`.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 2        | 2           |

---

### 12. sessions.go (744 lines)

**File**: `backend/internal/api/sessions.go`
**Category**: Maintainability

Mixes session management, hook token writing, HTTP handlers, in-memory state, and background cleanup.

**Suggested split**:
- `sessions_handlers.go` - HTTP handlers
- `sessions_manager.go` - SessionManager, reconciliation, cleanup
- `sessions_hooks.go` - hook token and notification script writing

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 4          | 2        | 3           |

---

### 13. server.go God Object

**File**: `backend/internal/api/server.go`
**Category**: Architecture

`Server` struct holds 9 dependencies (db, router, auth, worktree, wsHub, sessions, tunnels, gitclone, authLimiter, diffStatsCache). Every handler method hangs off this struct.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 4          | 2        | 1           |

---

## Duplication

### 14. Tunnel UI Logic Duplicated

**Files**:
- `frontend/src/components/tunnel/TunnelPanel.tsx` (157 lines)
- `frontend/src/components/tools/ToolsPanel.tsx` (169 lines, `TunnelsSection`)

~70% overlap: same port validation, copy-to-clipboard, mutation handlers.

**Fix**: Extract shared `TunnelManager` component or `useTunnels()` hook.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 2        | 4           |

---

### 15. Modal Pattern Repeated 6+ Times

**Files**: `CreateProjectModal`, `CreateTaskModal`, `WorkflowPromptModal`, `StartSessionModal`, `HelpOverlay`, etc.

All share: fixed inset-0 backdrop, centered content, z-50, Escape-to-close handler.

**Fix**: Extract `<Modal>` wrapper and `useEscapeKey()` hook.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 1        | 3           |

---

### 16. Task Update Mutation Duplicated in Every Task Detail Page

**Files**: `TaskDetailBacklog.tsx`, `TaskDetailInProgress.tsx`, `TaskDetailInReview.tsx`, `TaskDetailDone.tsx`

Identical `useMutation` + `invalidateQueries` for `['task', task.id]` and `['sidebar']`.

**Fix**: Extract `useUpdateTaskMutation(taskId)` hook.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 2        | 5           |

---

### 17. Worktree Path Resolution Duplicated

**Files**: `backend/internal/api/tasks.go:210-213,265-268`, `backend/internal/api/justfile.go:83-94`

Same pattern: `workDir := project.Path; if task.WorktreePath != nil { workDir = *task.WorktreePath }`.

**Fix**: Extract `resolveWorkDir(project, task)` helper.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 1        | 5           |

---

### 18. Session Status Update Pattern Repeated

**File**: `backend/internal/api/sessions.go:337-340,418-421,456-459,527-529`

Same 4-line block to update session status repeated 4+ times.

**Fix**: Extract `(s *Server) updateSessionStatus(id, status)` method.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 1        | 5           |

---

### 19. DiffStats Cache Logic Duplicated

**Files**: `backend/internal/api/sidebar.go:57-88`, `backend/internal/api/tasks.go:39-52`

Same `getCachedDiffStats` function appears in both files.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 2        | 5           |

---

## Code Smells

### 20. Magic Numbers Without Constants

**Files**:
- `backend/internal/api/server.go:84` - `5, 1*time.Minute` (rate limiter)
- `backend/internal/api/sessions.go:539` - `30 * time.Second` (cleanup interval)
- `backend/internal/api/sidebar.go:155` - `5` (concurrent workers)
- `frontend/src/pages/Dashboard.tsx:46` - `'codeburg:active-project'` localStorage key
- `frontend/src/hooks/useTerminal.ts:36-37` - `MAX_RETRIES = 5`, retry delays

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 1        | 5           |

---

### 21. Prop Drilling in TaskDetail

**Files**: `frontend/src/pages/TaskDetail.tsx:144-182`, `frontend/src/pages/task/TaskDetailInProgress.tsx:18-33`

7 session-related props drilled through multiple levels. Would benefit from a `TaskDetailContext`.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 4          | 2        | 3           |

---

### 22. Unused SessionList Component

**File**: `frontend/src/components/session/SessionList.tsx`
**Category**: Dead Code

Defined but never imported anywhere. `SessionTabs` is used instead.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 4          | 1        | 5           |

---

## Test Coverage

### 23. Backend: 22 of 28 Non-Test Go Files Have No Tests

**Key untested areas**:
- `worktree/worktree.go` - complex branch/worktree creation
- `api/git.go` (411 lines) - all git operations (status, stage, commit, diff, stash)
- `tmux/tmux.go` - session/window management
- `github/github.go` - clone operations
- `api/terminal.go` - PTY management

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 3        | 1           |

---

### 24. Frontend: ~7% Test Coverage (4 Test Files for 57 Source Files)

**No tests for**: Dashboard, Sidebar, TaskDetail (all pages), all hooks (`useTerminal`, `useKeyboardNav`, `useMobile`), all git/session components.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 3        | 1           |

---

### 25. No CI Pipeline

**Category**: Infrastructure

No `.github/workflows/` directory. Tests only run manually via `just test`. No automated lint, no coverage reports, no PR checks.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 3        | 3           |

---

## Configuration

### 26. Missing Go Lint Target in Justfile

**File**: `justfile`

Has `lint-fe` recipe but no `lint-be` for Go (no `golangci-lint` or equivalent). No unified `lint` target.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 5          | 2        | 5           |

---

### 27. No TypeScript Path Aliases

**File**: `frontend/tsconfig.app.json`

All imports use relative paths (`../../api/client`, `../test/wrapper`). Deep nesting makes refactoring painful.

| Confidence | Severity | Ease of Fix |
|------------|----------|-------------|
| 4          | 1        | 4           |

---

## Summary by Priority

### ~~Fix Now~~ All resolved
| # | Issue | Confidence | Severity | Ease | Status |
|---|-------|------------|----------|------|--------|
| 1 | SQL error string comparison | 5 | 4 | 5 | Fixed |
| 2 | Unsafe type assertions in cache | 5 | 4 | 5 | Fixed |
| 5 | Silent error suppression | 5 | 3 | 4 | Fixed (backend) |

### Fix Soon (High impact, moderate effort)
| # | Issue | Confidence | Severity | Ease |
|---|-------|------------|----------|------|
| ~~3~~ | ~~No React error boundaries~~ Fixed | 5 | 4 | 4 |
| ~~4~~ | ~~No 401 handling~~ Fixed (refresh still TODO) | 5 | 4 | 3 |
| 9 | Task status constants not shared | 5 | 3 | 3 |
| 8 | Inconsistent logging | 5 | 2 | 4 |
| 14 | Tunnel UI duplication | 5 | 2 | 4 |

### Plan For (Larger refactors)
| # | Issue | Confidence | Severity | Ease |
|---|-------|------------|----------|------|
| 10 | Dashboard.tsx 1,089 lines | 5 | 2 | 2 |
| 11 | Sidebar.tsx 759 lines | 5 | 2 | 2 |
| 23 | Backend test coverage gaps | 5 | 3 | 1 |
| 24 | Frontend test coverage gaps | 5 | 3 | 1 |
| 25 | No CI pipeline | 5 | 3 | 3 |

### Low Priority (Cleanup)
| # | Issue | Confidence | Severity | Ease |
|---|-------|------------|----------|------|
| 15-19 | Various duplication | 5 | 1-2 | 3-5 |
| 20 | Magic numbers | 5 | 1 | 5 |
| 22 | Dead code (SessionList) | 4 | 1 | 5 |
| 27 | No TS path aliases | 4 | 1 | 4 |

---

## Resolution Log

Record fixes here as they are applied. Mark the corresponding issue heading with `~~strikethrough~~ RESOLVED`.

| Date | Issues | What was done | By |
|------|--------|---------------|----|
| 2026-02-08 | #1 | Replaced `err.Error() == "sql: no rows..."` with `errors.Is(err, sql.ErrNoRows)` in `preferences.go` | Claude Code |
| 2026-02-08 | #2 | Changed bare type assertions to comma-ok form at both cache-read sites in `sidebar.go` | Claude Code |
| 2026-02-08 | #5 | `tasks.go`: replaced `fmt.Printf` with `slog.Warn` for worktree failure. `sessions.go`: handle `GetSession` error with `slog.Warn`, fall back to original session. `preferences.ts` left as-is (intentional fallback). | Claude Code |
| 2026-02-08 | #3 | Added `ErrorBoundary` class component wrapping the entire app in `App.tsx`. Shows error message + reload button on crash instead of white screen. | Claude Code |
| 2026-02-08 | #4 | Added 401 interceptor in `api/client.ts` that calls `logout()` via callback. Auth paths excluded to avoid loops. Wired up in `stores/auth.ts` using `setOnUnauthorized`. Token refresh deferred (needs backend). | Claude Code |
| | | | |
| | | | |
| | | | |
