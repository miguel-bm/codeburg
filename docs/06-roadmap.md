# Codeburg Roadmap

What to add next, organized by priority. Each item includes rationale and rough scope.

---

## High Priority

### R1. CI Pipeline (GitHub Actions)

There is zero CI. A broken commit goes unnoticed until the next manual test.

**Scope**: One workflow file. Run on push/PR to main:
- `go vet ./...` + `go test ./...`
- `pnpm install && pnpm lint && pnpm test`
- `pnpm build` (catches TypeScript errors)

~30 min to set up. Catches most regressions immediately.

---

### R2. React Error Boundary

One throw in a terminal component or JSON parse takes down the entire app with a white screen and no recovery. This is the lowest-effort, highest-impact UX fix.

**Scope**: One component (~30 lines), wrap around `<Routes>` in App.tsx. Show "something went wrong" with a reload button. Optionally log the error to the console or a future error endpoint.

---

### R3. Docker Support

The only deployment path is "clone repo, install Go 1.24, install Node, build from source." A Dockerfile makes deployment to any machine a single command.

**Scope**:
- Multi-stage `Dockerfile`: Node build stage → Go build stage → minimal runtime image
- `docker-compose.yml` with volume mount for `~/.codeburg/`
- Document in CLAUDE.md

---

### R4. Test Coverage for Worktree and Tmux

These are core to Codeburg's value proposition and have zero tests. Worktree bugs silently corrupt git state. Tmux bugs leave orphaned processes.

**Scope**:
- **Worktree tests**: Use `exec.Command("git", "init", ...)` to create temp repos. Test create/delete/symlink/branch operations. Test setup/teardown script execution.
- **Tmux tests**: Define a `TmuxClient` interface, test session manager with a mock. Or use real tmux in CI (it's available in GitHub Actions runners).

---

## Medium Priority

### R5. WebSocket Integration Tests

The WS hub and terminal proxy handle real-time communication but are completely untested. Bugs here cause silent disconnections, stale UI, or panics under concurrency.

**Scope**: Use `httptest.NewServer` + `gorilla/websocket.Dial` to test:
- Client connect/disconnect lifecycle
- Broadcast message delivery
- Subscription filtering (task-scoped, session-scoped)
- Concurrent client stress test

---

### R6. Frontend Component Tests

Dashboard (Kanban), TaskDetail, SessionView, and Login have no tests. These are the pages users interact with most.

**Scope**: Add happy-path rendering tests with mocked API (MSW or manual fetch mocks):
- Dashboard: renders columns, tasks appear in correct column, create project/task
- TaskDetail: renders session list, start session, status badges
- Login: submit form, error handling, redirect on success

---

### R7. Go Linter Configuration

Several bugs found in this review (unchecked errors, lock misuse) would be caught by static analysis.

**Scope**: Add `.golangci.yml` enabling:
- `errcheck` — catches ignored errors like the `hex.DecodeString` issue (#18)
- `govet` — catches lock misuse, printf format errors
- `staticcheck` — catches dead code, deprecated API usage
- `gosec` — catches basic security issues

Add `golangci-lint run` to CI pipeline (R1).

---

### R8. API Documentation (OpenAPI)

CLAUDE.md has good endpoint docs but nothing machine-readable. An OpenAPI spec enables client generation, automated testing, and serves as a contract.

**Scope**: Options from lightest to heaviest:
1. Hand-written `openapi.yaml` (~2h) — most control, must maintain manually
2. Comment annotations with `swaggo/swag` — generates from Go comments
3. Code-first with `ogen` or `oapi-codegen` — generates Go handlers from spec

Recommendation: Start with hand-written spec. It's a single-developer project; code generation adds complexity.

---

### R9. Pre-commit Hooks

Prevent broken code from landing. Catches lint failures and formatting issues before they reach CI.

**Scope**: `pnpm add -D husky lint-staged`, configure:
- Go files: `gofmt -l` (fail on unformatted)
- TS/TSX files: `eslint --fix`
- Optionally: `go vet ./...` on any `.go` change

---

## Nice to Have

### R10. Token Refresh Mechanism

7-day JWTs with no refresh means users either stay logged in forever or get hard-logged-out mid-work. A refresh endpoint extends sessions smoothly without re-entering the password.

**Scope**: Add `POST /api/auth/refresh` that accepts a valid (non-expired) JWT and returns a new one with a fresh expiry. Optionally reduce token lifetime to 24h once refresh is in place.

---

### R11. Session Log Viewer

Session logs go to `~/.codeburg/logs/sessions/{id}.jsonl` but there's no UI to view them. When an agent session fails, the user has to SSH in and `cat` the log file.

**Scope**:
- Backend: `GET /api/sessions/:id/logs?tail=100` endpoint that reads the JSONL file
- Frontend: A collapsible log panel in SessionView, showing structured log entries
- Stretch: Live tail via WebSocket

---

### R12. Keyboard Shortcuts

Codeburg's terminal-centric aesthetic calls for keyboard-driven navigation. Currently everything requires mouse clicks.

**Scope**:
- `j`/`k` to navigate tasks in a column
- `h`/`l` to switch columns
- `n` to create new task
- `Enter` to open task detail
- `Esc` to go back
- Use a lightweight hotkey library or a custom `useHotkeys` hook
- Show a `?` help overlay listing shortcuts

---

### R13. Bundle Size Analysis

xterm.js and its addons are significant dependencies. Without measurement, you can't tell if the bundle is reasonable or bloated.

**Scope**: Add `rollup-plugin-visualizer` to Vite config:
```ts
import { visualizer } from 'rollup-plugin-visualizer';
// In plugins array:
visualizer({ open: true, gzipSize: true })
```
Run `pnpm build` and inspect the treemap. Look for accidental full-library imports.

---

### R14. Clean Up Empty Packages

`backend/internal/git/`, `backend/internal/mcp/`, `backend/internal/ws/` are empty directories. They create false expectations that functionality exists there.

**Scope**: Either:
- Delete them if they were speculative placeholders
- Add a `doc.go` with a comment explaining the planned purpose and linking to a tracking issue
