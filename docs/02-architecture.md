# Codeburg Architecture

This document describes the technical architecture of Codeburg, a personal system for managing code projects with AI agents.

## Overview

Codeburg is a self-hosted platform that combines:
- **Project management** (kanban-style task tracking)
- **AI agent orchestration** (Claude Code, Codex, Gemini, etc.)
- **Development environment management** (git worktrees per task)
- **Remote access** (web UI accessible from phone)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Home Server                               │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Codeburg Backend (Go)                    │ │
│  │                                                             │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌───────────────────────┐ │ │
│  │  │  HTTP API   │ │  WebSocket  │ │     MCP Server        │ │ │
│  │  │  (Chi)      │ │  (gorilla)  │ │  (agent callbacks)    │ │ │
│  │  └─────────────┘ └─────────────┘ └───────────────────────┘ │ │
│  │                                                             │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌───────────────────────┐ │ │
│  │  │  Executor   │ │    Git      │ │   Tunnel Manager      │ │ │
│  │  │  (tmux)     │ │  (worktrees)│ │   (cloudflared)       │ │ │
│  │  └─────────────┘ └─────────────┘ └───────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐             │
│         ▼                    ▼                    ▼             │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐    │
│  │   SQLite    │    │ Config Files │    │   Worktrees     │    │
│  │   Database  │    │ (YAML/JSON)  │    │ (per task)      │    │
│  └─────────────┘    └──────────────┘    └─────────────────┘    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                 tmux session: codeburg                      │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │ │
│  │  │ task-123     │ │ task-456     │ │ task-789     │        │ │
│  │  │ (claude)     │ │ (codex)      │ │ (waiting)    │        │ │
│  │  └──────────────┘ └──────────────┘ └──────────────┘        │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Cloudflare Tunnel
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Internet Access                             │
│  codeburg.yourdomain.com        (platform UI)                    │
│  task-123-app.yourdomain.com    (dev server tunnels)             │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

### Backend (Go)

| Component | Technology | Purpose |
|-----------|------------|---------|
| HTTP Router | Chi | REST API endpoints |
| WebSocket | gorilla/websocket | Real-time agent output streaming |
| Database | modernc.org/sqlite | Pure Go SQLite driver |
| Git | go-git | Worktree and branch management |
| Process Mgmt | os/exec + tmux | Agent CLI spawning and control |
| JSON Parsing | encoding/json | Stream parsing of agent output |

### Frontend (React)

| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | React 18 | UI components |
| Build Tool | Vite | Fast dev server and bundling |
| Language | TypeScript | Type safety |
| Styling | Tailwind CSS | Utility-first CSS |
| Data Fetching | TanStack Query | Caching, refetching, optimistic updates |
| State | Zustand (if needed) | Lightweight global state |
| Kanban | @dnd-kit/core | Drag-and-drop |
| Terminal | xterm.js | Embedded terminal emulator |
| Markdown | react-markdown | Agent message rendering |
| Code View | Monaco Editor | Diff viewing, syntax highlighting |

## Data Storage

### SQLite Database

Location: `~/.codeburg/codeburg.db`

```sql
-- Projects imported from GitHub or local filesystem
CREATE TABLE projects (
    id TEXT PRIMARY KEY,              -- ulid
    name TEXT NOT NULL,
    path TEXT NOT NULL,               -- /home/user/projects/myapp
    git_origin TEXT,                  -- git@github.com:user/myapp.git
    default_branch TEXT DEFAULT 'main',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tasks in the kanban board
-- Schema designed for future extensibility (epics, dependencies, timelines)
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,              -- ulid
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'backlog',    -- backlog, in_progress, blocked, done
    branch TEXT,                      -- task-{id} or custom
    worktree_path TEXT,               -- ~/.codeburg/worktrees/{project}/task-{id}
    pinned BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,

    -- Future extensibility fields (nullable, unused in MVP)
    parent_id TEXT REFERENCES tasks(id),  -- For epics/milestones containing tasks
    task_type TEXT DEFAULT 'task',        -- task, epic, milestone, bug, feature, etc.
    due_date DATETIME,                    -- For timeline views
    position INTEGER,                     -- For manual ordering within column
    metadata JSON                         -- Flexible storage for future needs
);

-- Task dependencies (for future use)
-- Allows "task A blocks task B" relationships
CREATE TABLE task_dependencies (
    id TEXT PRIMARY KEY,
    blocker_id TEXT NOT NULL REFERENCES tasks(id),   -- This task blocks...
    blocked_id TEXT NOT NULL REFERENCES tasks(id),   -- ...this task
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(blocker_id, blocked_id)
);

-- Task labels/tags (for future use)
CREATE TABLE task_labels (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    color TEXT,                       -- Hex color for UI
    UNIQUE(project_id, name)
);

CREATE TABLE task_label_assignments (
    task_id TEXT NOT NULL REFERENCES tasks(id),
    label_id TEXT NOT NULL REFERENCES task_labels(id),
    PRIMARY KEY (task_id, label_id)
);

-- Agent sessions within a task (one task can have multiple sessions)
CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,              -- ulid
    task_id TEXT NOT NULL REFERENCES tasks(id),
    provider TEXT NOT NULL,           -- claude, codex, gemini, etc.
    provider_session_id TEXT,         -- for --resume flag
    status TEXT DEFAULT 'idle',       -- idle, running, waiting_input, completed, error
    tmux_window TEXT,                 -- tmux window name
    tmux_pane TEXT,                   -- tmux pane id
    log_file TEXT,                    -- Path to log file (not stored in DB)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_parent ON tasks(parent_id);
CREATE INDEX idx_sessions_task ON agent_sessions(task_id);
CREATE INDEX idx_dependencies_blocker ON task_dependencies(blocker_id);
CREATE INDEX idx_dependencies_blocked ON task_dependencies(blocked_id);
```

### Session Logs (File-Based)

Agent conversation logs are stored as files, NOT in SQLite. This avoids database bloat
since conversations can grow very large, and the underlying agent CLIs already maintain
their own session history for replay/resume.

**Log file location:** `~/.codeburg/logs/sessions/{session-id}.jsonl`

**Format:** JSON Lines (one JSON object per line)
```jsonl
{"ts":"2024-01-15T10:30:00Z","type":"system","content":"Session started"}
{"ts":"2024-01-15T10:30:01Z","type":"user","content":"Implement JWT auth"}
{"ts":"2024-01-15T10:30:05Z","type":"assistant","content":"I'll help you..."}
{"ts":"2024-01-15T10:30:10Z","type":"tool_use","tool":"Read","input":{"file":"auth.go"}}
```

**Purpose:** Observation and debugging, NOT action. The agent CLIs handle their own
session resumption. Codeburg logs are for:
- Viewing conversation history in UI
- Debugging issues
- Auditing what happened

**Rotation:** Old log files can be compressed or deleted after task completion.

### File Storage

Location: `~/.codeburg/`

```
~/.codeburg/
├── codeburg.db                    # SQLite database
├── config.yaml                    # Global Codeburg config
├── projects/
│   └── {project-name}/
│       ├── config.yaml            # Project-specific config
│       ├── context.md             # Cached codebase knowledge (agent-written)
│       └── secrets.env            # Gitignored secrets to symlink
├── logs/
│   └── sessions/
│       └── {session-id}.jsonl     # Agent conversation logs (file-based)
└── worktrees/
    └── {project-name}/
        └── task-{id}/             # Git worktrees (created on task start)
```

#### Global Config (`~/.codeburg/config.yaml`)

```yaml
# Server settings
server:
  host: "0.0.0.0"
  port: 8080

# Authentication (MVP: simple password)
auth:
  password_hash: "$2a$..."         # bcrypt hash

# Tunnel settings
tunnel:
  provider: cloudflare             # cloudflare, tailscale, none
  domain: yourdomain.com           # for named tunnels

# Default agent settings
agents:
  default: claude
  claude:
    dangerous_mode: true           # --dangerously-skip-permissions
  codex:
    dangerous_mode: true

# Worktree settings
worktrees:
  base_path: ~/.codeburg/worktrees
  auto_create: true                # create worktree when task moves to in_progress
  auto_cleanup: true               # delete worktree when task completed
  cleanup_delay_hours: 24          # wait before cleanup
```

#### Project Config (`~/.codeburg/projects/{name}/config.yaml`)

```yaml
name: myproject
path: /home/user/projects/myproject
git_origin: git@github.com:user/myproject.git

# Justfile integration (auto-detected if exists)
justfile:
  path: justfile                   # relative to project root

# Files to symlink into worktrees
symlinks:
  - .env
  - config/secrets.json

# Worktree setup script (runs after worktree creation)
setup: |
  npm install

# Worktree teardown script (runs before worktree deletion)
teardown: |
  # cleanup if needed

# Project-specific agent settings (override global)
agents:
  claude:
    model: opus                    # or sonnet, haiku
```

## Component Details

### Executor (Agent Management)

The executor manages AI agent CLI processes. Inspired by TaskYou's design.

```go
// Executor interface - each provider implements this
type Executor interface {
    Name() string
    IsAvailable() bool
    Execute(ctx context.Context, task *Task, workDir, prompt string) error
    Resume(ctx context.Context, task *Task, workDir, sessionID, message string) error
    SupportsResume() bool
    SupportsFork() bool
    ParseOutput(line []byte) (*AgentEvent, error)
}

// Supported providers
// - ClaudeExecutor: claude CLI with --output-format stream-json
// - CodexExecutor: codex CLI
// - GeminiExecutor: gemini CLI (if available)
// - GenericExecutor: fallback for unknown CLIs
```

**Process Management:**

1. Each agent session runs in a dedicated tmux window
2. Output is captured via tmux's capture-pane or direct pipe
3. JSON stream is parsed line-by-line into AgentEvent structs
4. Events are broadcast to WebSocket subscribers and logged to DB

**Session Lifecycle:**

```
┌─────────┐    Execute()    ┌─────────┐    agent calls    ┌─────────────┐
│  idle   │ ───────────────▶│ running │ ──────────────────▶│waiting_input│
└─────────┘                 └─────────┘   needs_input      └─────────────┘
                                 │                               │
                                 │ agent exits                   │ user sends
                                 ▼                               │ message
                            ┌─────────┐                          │
                            │completed│◀─────────────────────────┘
                            └─────────┘        Resume()
```

### MCP Server (Agent Callbacks)

Codeburg exposes an MCP server that agents can call to signal state changes.

**How it works:**

1. When starting an agent, Codeburg injects MCP config into `~/.claude.json`:
   ```json
   {
     "projects": {
       "/path/to/worktree": {
         "mcpServers": {
           "codeburg": {
             "type": "stdio",
             "command": "codeburg",
             "args": ["mcp-server", "--task-id", "123"],
             "autoApprove": ["codeburg_*"]
           }
         }
       }
     }
   }
   ```

2. Claude Code spawns `codeburg mcp-server --task-id 123` as a subprocess

3. The MCP server provides these tools:
   - `codeburg_needs_input(question)` - Signal waiting for user input
   - `codeburg_complete(result)` - Mark task as done
   - `codeburg_create_task(title, description)` - Create subtask
   - `codeburg_get_context()` - Get cached project context
   - `codeburg_set_context(context)` - Save project context

4. User input goes through tmux (not MCP) to preserve slash command support

### User Input Flow

**Critical design decision:** User input is sent via tmux, NOT MCP.

This preserves full CLI functionality (slash commands like `/fork`, `/compact`).

```
User types message in Codeburg UI
         │
         ▼
Backend receives via WebSocket
         │
         ▼
tmux send-keys -t {pane} "{message}" Enter
         │
         ▼
Agent CLI receives as stdin
         │
         ▼
Agent processes (including slash commands)
```

### Git/Worktree Management

Each task gets an isolated git worktree:

```
Main repo: /home/user/projects/myproject
           └── .git/

Worktree:  ~/.codeburg/worktrees/myproject/task-123/
           ├── .git (file pointing to main repo's .git)
           ├── .env -> ~/.codeburg/projects/myproject/secrets.env
           └── (all project files on task-123 branch)
```

**Configuration:**

Worktree creation can be automatic or manual:
- `worktrees.auto_create: true` (default) - creates worktree when task moves to in_progress
- `worktrees.auto_create: false` - requires explicit API call to create worktree

The MVP UI always creates worktrees (doesn't expose the manual option), but the backend
supports both modes for future flexibility or API users.

**Lifecycle:**

1. **Task started** → Create branch `task-{id}`, create worktree, run setup script, symlink secrets
2. **Task in progress** → Agent works in worktree, commits to branch
3. **Task completed** → Optionally create PR, schedule worktree cleanup
4. **Cleanup** → Delete worktree (keeps branch for history)

### Tunnel Management

For exposing dev servers to the internet:

```go
type TunnelManager interface {
    Start(port int, subdomain string) (*Tunnel, error)
    Stop(tunnelID string) error
    List() ([]*Tunnel, error)
}

// CloudflareTunnel spawns cloudflared process
// Returns public URL like https://task-123-app.yourdomain.com
```

**Usage:**
- User starts dev server on port 3000 in worktree
- User clicks "Expose" in Codeburg UI
- Codeburg spawns `cloudflared tunnel --url http://localhost:3000`
- Public URL stored in task metadata, displayed in UI

## API Design

### REST Endpoints

```
# Projects
GET    /api/projects                    List all projects
POST   /api/projects                    Import/create project
GET    /api/projects/:id                Get project details
PUT    /api/projects/:id                Update project
DELETE /api/projects/:id                Delete project

# Tasks
GET    /api/projects/:id/tasks          List tasks for project
POST   /api/projects/:id/tasks          Create task
GET    /api/tasks/:id                   Get task details
PUT    /api/tasks/:id                   Update task (status, title, etc.)
DELETE /api/tasks/:id                   Delete task

# Agent Sessions
GET    /api/tasks/:id/sessions          List sessions for task
POST   /api/tasks/:id/sessions          Start new agent session
GET    /api/sessions/:id                Get session details
POST   /api/sessions/:id/message        Send message to agent
POST   /api/sessions/:id/fork           Fork session (if supported)
DELETE /api/sessions/:id                Stop/kill session

# Utilities
GET    /api/projects/:id/justfile       Get justfile commands
POST   /api/projects/:id/justfile/:cmd  Run justfile command
GET    /api/tasks/:id/tunnels           List active tunnels
POST   /api/tasks/:id/tunnels           Create tunnel
DELETE /api/tunnels/:id                 Stop tunnel
```

### WebSocket Protocol

Connect to `/ws` for real-time updates.

**Client → Server:**
```json
{"type": "subscribe", "channel": "task", "id": "task-123"}
{"type": "subscribe", "channel": "session", "id": "session-456"}
{"type": "unsubscribe", "channel": "task", "id": "task-123"}
{"type": "message", "sessionId": "session-456", "content": "yes, proceed"}
```

**Server → Client:**
```json
{"type": "task_updated", "task": {...}}
{"type": "session_event", "sessionId": "...", "event": {
  "type": "assistant",
  "content": "I'll help you with that...",
  "metadata": {}
}}
{"type": "session_status", "sessionId": "...", "status": "waiting_input"}
{"type": "tunnel_created", "taskId": "...", "url": "https://..."}
```

## Frontend Architecture

### Component Hierarchy

```
App
├── AuthGate                         # Login if not authenticated
├── Layout
│   ├── Sidebar                      # Project list, navigation
│   └── Main
│       ├── KanbanView               # Board with all tasks
│       │   ├── Column (backlog)
│       │   │   └── TaskCard[]
│       │   ├── Column (in_progress)
│       │   ├── Column (blocked)
│       │   └── Column (done)
│       │
│       ├── TaskDetailView           # Single task focused view
│       │   ├── TaskHeader           # Title, status, actions
│       │   ├── TaskDescription      # Markdown description
│       │   ├── AgentSessionList     # List of sessions
│       │   │   └── AgentSession[]   # Independent module!
│       │   ├── JustfilePanel        # Commands from justfile
│       │   └── TunnelPanel          # Active tunnels
│       │
│       └── ProjectSettingsView      # Project config
│
└── Modals
    ├── CreateTaskModal
    ├── CreateProjectModal
    └── TerminalModal               # Full-screen terminal escape hatch
```

### AgentSession Component (Independent Module)

This is designed to be replaceable/iterable without affecting the rest of the app.

```typescript
// Props - everything needed to render a session
interface AgentSessionProps {
  sessionId: string
  taskId: string
  provider: AgentProvider
  onStatusChange?: (status: SessionStatus) => void
}

// Internal state managed by the component
// - WebSocket subscription for this session
// - Message history (from API + real-time)
// - Input state
// - Terminal toggle state

// Layers within AgentSession:
// 1. Unified message display (works for all providers)
// 2. Provider-specific controls (model selector for Claude, etc.)
// 3. Terminal escape hatch (xterm.js connected to tmux pane)
```

## Security Considerations

### Authentication (MVP)

Simple password-based auth:
- Password hash stored in config
- Session token (JWT) returned on login
- Token required for all API calls
- Token stored in localStorage (acceptable for personal use)

### Network Security

- Codeburg only accessible via Cloudflare Tunnel (not exposed directly)
- Tunnel provides HTTPS termination
- For additional security: Cloudflare Access can add SSO

### Agent Security

- Agents run with user's permissions (no sandboxing in MVP)
- `--dangerously-skip-permissions` is opt-in per project
- MCP tools are auto-approved to avoid prompt spam

## Deployment

### Single Binary

```bash
# Build
cd backend && go build -o codeburg ./cmd/codeburg

# Run
./codeburg serve
```

### Systemd Service

```ini
[Unit]
Description=Codeburg
After=network.target

[Service]
Type=simple
User=miguel
ExecStart=/usr/local/bin/codeburg serve
Restart=always
Environment=HOME=/home/miguel

[Install]
WantedBy=multi-user.target
```

### Frontend

```bash
# Build
cd frontend && npm run build

# Output in frontend/dist/
# Served by Go backend at /
```

## Future Considerations

These are explicitly NOT in MVP but the architecture should not preclude them:

- **Container per project**: Executor could spawn in container instead of directly
- **Multiple users**: Add user_id to tables, proper auth
- **Collaborative features**: Real-time sync, shared projects
- **More agent providers**: Generic executor interface supports this
- **Plugin system**: MCP tools could be extended
- **GitHub integration**: Import projects directly from GitHub, create repos
- **Advanced task management**: The schema includes fields for:
  - Epics/milestones (parent_id, task_type)
  - Dependencies (task_dependencies table)
  - Labels/tags (task_labels tables)
  - Timelines (due_date)
  - Manual ordering (position)
  These are unused in MVP but ready for future Jira/Taiga-like features
