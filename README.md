# Codeburg

Codeburg is a personal task/worktree manager for software projects with terminal-first AI agent sessions.

## Stack

- Backend: Go, Chi, SQLite, JWT auth
- Frontend: React 19, TypeScript, Vite, Tailwind v4, TanStack Query, Zustand
- Terminal runtime: in-process PTY + xterm.js

## Prerequisites

- Go 1.24+
- Node.js 18+
- pnpm
- just
- Git 2.5+

Optional for some features:

- `claude` CLI
- `gh`
- `cloudflared`

## Quick Start

```bash
# install frontend deps
cd frontend && pnpm install && cd ..

# migrate and start backend (:8080)
just migrate
just dev-be

# start frontend in another terminal (:3000)
just dev-fe
```

Open `http://localhost:3000`.

## Common Commands

```bash
# full test suite
just test

# frontend only
just test-fe

# build frontend + backend
just build
```

## Project Layout

- `backend/`: API, DB, worktree and PTY runtime
- `frontend/`: React app
- `desktop/macos/`: Electron shell for macOS
- `docs/`: architecture, specs, and audits
