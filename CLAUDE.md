# Codeburg - AI Agent Task Management

Personal system for managing code projects with AI agents.

## Prerequisites

### Required Software

- **Go 1.24+** - Backend runtime
  ```bash
  go version
  # If using older Go, set GOTOOLCHAIN=auto to auto-download newer version
  ```

- **Node.js 18+** - Frontend build
  ```bash
  node --version
  npm --version
  ```

- **Git 2.5+** - Version control (worktrees require 2.5+)
  ```bash
  git --version
  ```

- **tmux** - Agent session management
  ```bash
  tmux -V
  ```

- **Claude CLI** - AI agent (optional, for agent features)
  ```bash
  claude --version
  ```

- **just** - Task runner (used for build/test/deploy commands)
  ```bash
  just --version
  ```

- **cloudflared** - Tunnel support (optional, for tunnel features)
  ```bash
  cloudflared --version
  ```

### Git Repository Requirements

Before Codeburg can manage a project with worktrees:

1. **Repository must have at least one commit**
   ```bash
   cd /path/to/your/project
   git status  # Should NOT say "No commits yet"
   ```

2. **Default branch must exist** (usually `main` or `master`)
   ```bash
   git branch  # Should show your default branch
   ```

## Quick Start

```bash
# 1. Clone and enter the repository
cd codeburg

# 2. Install frontend dependencies (first time only)
cd frontend && pnpm install && cd ..

# 3. Start Backend (Go 1.24+ required)
just migrate   # Run database migrations
just dev-be    # Start server on :8080

# 4. Start Frontend (in another terminal)
just dev-fe    # Dev server on :3000 (proxies API to :8080)

# 5. Open http://localhost:3000
# First visit: Set your password
# Subsequent visits: Login with your password
```

### Production Build

```bash
just build     # Builds frontend + backend
just migrate   # Run migrations

# Or run production directly:
./backend/codeburg serve  # Serves API + frontend from dist/
```

## Testing

```bash
# Run all tests (from project root)
just test

# Backend only
just test-be

# Frontend only
just test-fe

# Frontend watch mode
just test-fe-watch
```

### Backend Test Structure

- `internal/db/db_test.go` - Database CRUD tests (in-memory SQLite)
- `internal/api/api_test.go` - API integration tests (httptest + temp git repos)
- `internal/justfile/justfile_test.go` - Justfile parser unit tests
- `internal/tunnel/tunnel_test.go` - Tunnel URL regex + struct tests

### Frontend Test Structure

- `src/api/client.test.ts` - API client (fetch mocking, auth headers, error handling)
- `src/stores/auth.test.ts` - Auth store (login/logout, token persistence)
- `src/components/justfile/JustfilePanel.test.tsx` - JustfilePanel component
- `src/components/tunnel/TunnelPanel.test.tsx` - TunnelPanel component

Frontend tests use Vitest + @testing-library/react + jsdom. Test helpers are in `src/test/`.

## Project Structure

```
codeburg/
├── backend/
│   ├── cmd/codeburg/          # CLI entry point (serve, migrate commands)
│   └── internal/
│       ├── api/               # HTTP handlers (Chi router, WebSocket)
│       ├── db/                # SQLite database + migrations
│       ├── worktree/          # Git worktree management
│       ├── tmux/              # Tmux session management
│       ├── executor/          # Session types (terminal-first)
│       ├── justfile/          # Justfile parsing and execution
│       └── tunnel/            # Cloudflared tunnel management
├── frontend/
│   ├── src/
│   │   ├── api/               # API client + types
│   │   ├── components/        # React components
│   │   │   ├── layout/        # Layout components
│   │   │   ├── session/       # Agent session components
│   │   │   ├── terminal/      # xterm.js terminal modal
│   │   │   ├── justfile/      # Justfile panel
│   │   │   └── tunnel/        # Tunnel panel
│   │   ├── hooks/             # Custom hooks
│   │   ├── pages/             # Page components
│   │   └── stores/            # Zustand stores
│   └── dist/                  # Production build output
├── deploy/
│   ├── codeburg.service       # Systemd unit file
│   ├── cloudflared.yml        # Tunnel config template
│   ├── setup.sh               # One-time server provisioning
│   └── deploy.sh              # Upgrade/deploy script
└── docs/
    ├── 01-brainstorm.md       # Initial research
    ├── 02-architecture.md     # System design
    ├── 03-mvp-spec.md         # MVP milestones
    ├── 07-deployment.md       # Deployment architecture
    └── 08-deployment-guide.md # Step-by-step deploy guide
```

## Tech Stack

- **Backend**: Go, Chi router, SQLite (modernc.org/sqlite - pure Go), JWT auth, bcrypt
- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS v4, TanStack Query, Zustand
- **Terminal**: xterm.js with PTY backend
- **IDs**: ULIDs (github.com/oklog/ulid/v2)

## File Locations

| Item | Path |
|------|------|
| Database | `~/.codeburg/codeburg.db` |
| Auth config | `~/.codeburg/config.yaml` (password hash) |
| JWT secret | `~/.codeburg/.jwt_secret` |
| Worktrees | `~/.codeburg/worktrees/{project}/{task-id}/` |
| Session logs | `~/.codeburg/logs/sessions/{id}.jsonl` |

## API Endpoints

### Authentication

```
POST   /api/auth/login     { password } → { token }
POST   /api/auth/setup     { password } → { token }  (first-time setup)
GET    /api/auth/status    → { setup: bool }
GET    /api/auth/me        Validate token
```

### Projects

```
GET    /api/projects
POST   /api/projects       { name, path, symlinkPaths?, setupScript?, teardownScript? }
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id
```

### Tasks

```
GET    /api/tasks          ?project=&status=
POST   /api/projects/:id/tasks  { title, description? }
GET    /api/tasks/:id
PATCH  /api/tasks/:id      { status?, title?, description?, pinned? }
DELETE /api/tasks/:id
```

### Worktrees

```
POST   /api/tasks/:id/worktree   Create worktree for task
DELETE /api/tasks/:id/worktree   Delete worktree
```

### Agent Sessions

```
GET    /api/tasks/:taskId/sessions      List sessions for task
POST   /api/tasks/:taskId/sessions      Start new session { provider?, prompt?, model? }
GET    /api/sessions/:id                Get session details
POST   /api/sessions/:id/message        Send message { content }
POST   /api/sessions/:id/hook           Hook callback (from Claude Code hooks / Codex notify)
DELETE /api/sessions/:id                Stop session
```

Provider can be `claude` (default), `codex`, or `terminal`. All sessions are terminal-based
(rendered via xterm.js). Claude/Codex sessions inject the CLI command into the tmux window.
Claude Code hooks and Codex notify scripts call back to the hook endpoint to update session status.

### Justfile

```
GET    /api/projects/:id/justfile       List recipes for project
POST   /api/projects/:id/just/:recipe   Run recipe in project
GET    /api/tasks/:id/justfile          List recipes for task (uses worktree)
POST   /api/tasks/:id/just/:recipe      Run recipe in task worktree
GET    /api/tasks/:id/just/:recipe/stream   Stream recipe output (SSE)
```

### Tunnels

```
GET    /api/tasks/:id/tunnels           List active tunnels for task
POST   /api/tasks/:id/tunnels           Create tunnel { port }
DELETE /api/tunnels/:id                 Stop tunnel
```

### Preferences

```
GET    /api/preferences/:key             Get preference (raw JSON value)
PUT    /api/preferences/:key             Set preference (body is raw JSON)
DELETE /api/preferences/:key             Delete preference
```

Generic key-value store (`user_preferences` table) scoped by `user_id` (defaults to `'default'`).
Used for: `pinned_projects` (JSON array of project IDs).

### WebSocket

```
WS     /ws                 Real-time updates (sessions, tasks)
WS     /ws/terminal        Terminal PTY access (xterm.js)
```

## Features

### Kanban Board

- Four columns: Backlog, In Progress, Blocked, Done
- Drag-and-drop on desktop
- Long-press context menu on mobile
- Filter by project
- Pin important tasks

### Worktree Management

When a task moves to `in_progress`, Codeburg automatically:

1. Creates branch `task-{taskId}` from default branch
2. Creates worktree at `~/.codeburg/worktrees/{project}/task-{id}/`
3. Symlinks configured files (e.g., `.env`)
4. Runs setup script if configured

### Agent Sessions (Terminal-First)

All sessions are terminal-based, rendered via xterm.js connected to tmux windows:

- **Claude sessions**: Runs `claude` CLI interactively in tmux. Claude Code hooks
  (`.claude/settings.local.json`) call back to `POST /api/sessions/:id/hook` for
  status tracking (Notification→waiting_input, Stop→running, SessionEnd→completed).
- **Codex sessions**: Runs `codex` CLI in tmux. A notify script calls back on
  `agent-turn-complete` for status tracking.
- **Terminal sessions**: Plain shell in the task's worktree directory.
- Activity detection at the WebSocket/PTY level resets status to `running` when user types.
- Multiple sessions per task with live status badges.

### Justfile Integration

- Auto-detect justfile in project/worktree
- List available recipes with descriptions
- One-click execution with output display

### Cloudflare Tunnels

- Expose local ports to the internet
- Quick tunnels (no Cloudflare account needed)
- Copy shareable URL

## Key Patterns

### Backend

- **ULIDs** for all IDs (time-sortable, URL-safe)
- **Nullable fields** use `sql.NullString`/`sql.NullTime` with helper functions
- **Auth**: bcrypt password hash + JWT tokens (7-day expiry)
- **Migrations**: Versioned, stored in code, run via `codeburg migrate`

### Frontend

- **TypeScript strict mode** with `verbatimModuleSyntax` - use `import type` for types
- **API client** with automatic auth header injection
- **Zustand** for auth state, **React Query** for server state
- **Mobile-first**: Responsive design with swipe gestures and long-press menus

### Design System

- Dark mode primary, Matrix-inspired green highlights
- Monospace font everywhere (JetBrains Mono)
- No rounded corners - sharp edges only
- Slim borders in highlight color
- Flat cards (same background, not elevated)

## Current Status

| Milestone | Status |
|-----------|--------|
| 1. Foundation (Backend) | ✅ Complete |
| 2. Foundation (Frontend) | ✅ Complete |
| 3. Kanban Board | ✅ Complete |
| 4. Worktree Management | ✅ Complete |
| 5. Agent Execution | ✅ Complete |
| 6. Agent UI | ✅ Complete |
| 7. Terminal Escape Hatch | ✅ Complete |
| 8. Justfile & Tunnels | ✅ Complete |
| 9. Polish & Deploy | 🔄 In Progress |

## Error Handling

Common errors and solutions:

| Error | Cause | Solution |
|-------|-------|----------|
| "repository has no commits" | Empty git repo | Make an initial commit |
| "base branch 'main' does not exist" | Wrong default branch | Update project's defaultBranch |
| "worktree already exists" | Worktree wasn't cleaned up | Delete manually or via API |
| "tmux not available" | tmux not installed | Install tmux |
| "claude CLI not available" | Claude not installed | Install Claude CLI |
| Password not resetting | Password is in config, not DB | Delete `~/.codeburg/config.yaml` |
