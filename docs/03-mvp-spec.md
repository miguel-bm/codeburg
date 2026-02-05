# Codeburg MVP Specification

This document defines the Minimum Viable Product for Codeburg. The goal is to build a usable personal tool as quickly as possible, deferring nice-to-have features for later iterations.

## MVP Scope

### In Scope

1. **Project Management**
   - Import projects from local filesystem (specify path)
   - Basic project config (name, path, git origin)
   - Delete/archive projects

2. **Task Management (Kanban)**
   - Create tasks with title and description
   - Four columns: Backlog, In Progress, Blocked, Done
   - Drag-and-drop between columns
   - View all projects' tasks in unified board
   - Filter by project
   - Pin important tasks

3. **Worktree Management**
   - Auto-create git worktree when task moves to In Progress
   - Auto-create branch named `task-{id}`
   - Symlink configured secret files
   - Run setup script if configured
   - Manual cleanup (delete worktree button)

4. **Agent Sessions (Claude Code)**
   - Start Claude Code session for a task
   - Send messages to agent via UI
   - View agent responses in real-time (streaming)
   - See when agent is waiting for input
   - Resume existing sessions
   - Multiple sessions per task
   - Kill/stop session

5. **Terminal Escape Hatch**
   - Open full terminal (xterm.js) connected to task's tmux pane
   - Use any CLI features directly (slash commands, etc.)

6. **Justfile Integration**
   - Auto-detect justfile in project
   - Display available commands
   - Run commands with one click
   - See command output

7. **Basic Tunnel Support**
   - Expose localhost port via cloudflared
   - Display public URL
   - Stop tunnel

8. **Authentication**
   - Simple password login
   - Session persistence

9. **Mobile-Friendly UI**
   - Responsive design that works on phone
   - Essential features accessible on small screens

### Explicitly Out of Scope (v1)

These are documented for future reference but will NOT be in MVP:

| Feature | Reason | Complexity |
|---------|--------|------------|
| GitHub import | Can manually specify path | Low |
| Codex/Gemini support | Start with Claude only | Medium |
| Container per project | Worktrees are sufficient to start | High |
| Container per task | Same as above | High |
| Prebuilds | Optimization, not essential | Medium |
| Cost tracking | Using subscription, not API | Low |
| Multi-agent coordination | User manages this manually | High |
| Collaborators | Personal use only | High |
| OAuth login | Password is fine for personal | Medium |
| Telegram bot | Web UI is sufficient | Medium |
| LLM meta-control | Nice to have later | Medium |
| MCP API for Codeburg | Build API first, MCP later | Medium |
| Public REST API | Internal API only for now | Low |
| Session forking UI | Can use /fork in terminal | Low |
| File editing on mobile | View-only is fine | Medium |
| Diff viewer | Can view in terminal/IDE | Medium |
| Auto-cleanup worktrees | Manual cleanup is fine | Low |
| Project context caching | Nice optimization for later | Low |
| Custom task types | All tasks are equal for now | Low |
| Task dependencies | Simple kanban is enough | Medium |
| Subtasks | Flat task list is fine | Low |

## User Flows

### Flow 1: First-Time Setup

1. User runs `codeburg serve` on home server
2. User sets up Cloudflare Tunnel to expose Codeburg
3. User visits `codeburg.yourdomain.com`
4. User sets password on first visit
5. User is logged in, sees empty dashboard

### Flow 2: Import a Project

1. User clicks "Add Project"
2. User enters:
   - Name: "myapp"
   - Path: "/home/user/projects/myapp"
   - Git origin (optional): "git@github.com:user/myapp.git"
3. User clicks "Import"
4. Codeburg validates path exists and is a git repo
5. Project appears in sidebar
6. Codeburg auto-detects justfile if present

### Flow 3: Create and Work on a Task

1. User selects project in sidebar
2. User clicks "New Task" in Backlog column
3. User enters title: "Add user authentication"
4. User optionally adds description (markdown)
5. Task card appears in Backlog
6. User drags task to "In Progress"
7. Codeburg automatically:
   - Creates branch `task-{id}` from main
   - Creates worktree at `~/.codeburg/worktrees/myapp/task-{id}/`
   - Symlinks `.env` (if configured)
   - Runs setup script (if configured)
8. User clicks on task card to open detail view

### Flow 4: Start Agent Session

1. User is in task detail view
2. User clicks "Start Agent" (defaults to Claude)
3. User types initial prompt: "Implement JWT-based authentication"
4. Codeburg:
   - Creates tmux window `task-{id}-session-{n}`
   - Injects MCP server config for this task
   - Spawns `claude -p "..." --output-format stream-json`
   - Streams output to UI via WebSocket
5. User sees Claude's response appearing in real-time
6. Claude works, calls tools, shows progress
7. Claude finishes turn, UI shows "Waiting for input"
8. User types follow-up: "Use bcrypt for password hashing"
9. Message sent via tmux, conversation continues

### Flow 5: Use Terminal Escape Hatch

1. User is viewing agent session
2. Agent is running but user wants to use `/compact`
3. User clicks "Open Terminal"
4. Modal opens with xterm.js connected to tmux pane
5. User types `/compact` directly
6. User closes modal, returns to pretty UI
7. Conversation continues in UI

### Flow 6: Run Justfile Command

1. User is in task detail view
2. User sees Justfile panel with commands: `dev`, `test`, `build`
3. User clicks "test"
4. Codeburg runs `just test` in worktree
5. Output streams to a panel/modal
6. User sees test results

### Flow 7: Expose Dev Server

1. User runs `just dev` which starts server on port 3000
2. User clicks "Expose Port"
3. User enters port: 3000
4. Codeburg spawns cloudflared tunnel
5. UI shows: "https://task-123-dev.yourdomain.com"
6. User can share URL or access from phone
7. User clicks "Stop" when done

### Flow 8: Complete a Task

1. User is satisfied with the work
2. User drags task to "Done" column
3. Task marked as completed
4. Worktree remains (user can manually delete later)
5. Branch remains for PR creation (manual via git/gh)

### Flow 9: Mobile Quick Check

1. User opens codeburg.yourdomain.com on phone
2. User logs in (session persisted)
3. User sees kanban board (scrollable columns)
4. User sees task-123 is "Blocked" (agent waiting)
5. User taps task to open detail
6. User sees agent's question: "Should I use sessions or JWT?"
7. User types: "Use JWT with refresh tokens"
8. Agent continues working
9. User closes phone, agent keeps running on server

## Technical Specifications

### Database Schema

See `02-architecture.md` for full schema. MVP uses:
- `projects` - full table
- `tasks` - basic fields only (parent_id, task_type, due_date, position, metadata unused)
- `agent_sessions` - full table
- `task_dependencies`, `task_labels`, `task_label_assignments` - tables exist but unused

**Session logs:** Stored as JSONL files in `~/.codeburg/logs/sessions/`, NOT in SQLite.
The `agent_sessions.log_file` field references the log file path.

### API Endpoints (MVP)

```
# Auth
POST   /api/auth/login              { password } → { token }
GET    /api/auth/me                 Validate token

# Projects
GET    /api/projects                List projects
POST   /api/projects                Create project
GET    /api/projects/:id            Get project with tasks
DELETE /api/projects/:id            Delete project

# Tasks
GET    /api/tasks                   List all tasks (cross-project)
GET    /api/tasks?project=:id       List tasks for project
POST   /api/projects/:id/tasks      Create task
GET    /api/tasks/:id               Get task details
PATCH  /api/tasks/:id               Update task (status, title, etc.)
DELETE /api/tasks/:id               Delete task

# Worktrees
POST   /api/tasks/:id/worktree      Create worktree (usually auto)
DELETE /api/tasks/:id/worktree      Delete worktree

# Sessions
GET    /api/tasks/:id/sessions      List sessions
POST   /api/tasks/:id/sessions      Start new session
GET    /api/sessions/:id            Get session with recent logs
DELETE /api/sessions/:id            Kill session

# Justfile
GET    /api/projects/:id/justfile   List commands
POST   /api/projects/:id/just/:cmd  Run command

# Tunnels
GET    /api/tasks/:id/tunnels       List tunnels
POST   /api/tasks/:id/tunnels       Create tunnel { port }
DELETE /api/tunnels/:id             Stop tunnel

# WebSocket
WS     /ws                          Real-time updates
```

### WebSocket Messages (MVP)

**Client sends:**
```json
{"type": "subscribe_task", "taskId": "..."}
{"type": "subscribe_session", "sessionId": "..."}
{"type": "send_message", "sessionId": "...", "content": "..."}
{"type": "unsubscribe", "channel": "...", "id": "..."}
```

**Server sends:**
```json
{"type": "task_updated", "task": {...}}
{"type": "session_output", "sessionId": "...", "content": "...", "outputType": "assistant|tool|system"}
{"type": "session_status", "sessionId": "...", "status": "running|waiting_input|completed|error"}
{"type": "command_output", "requestId": "...", "content": "...", "done": false}
```

### Frontend Pages/Views

1. **Login Page** (`/login`)
   - Password input
   - Submit button
   - Error display

2. **Dashboard/Kanban** (`/`)
   - Project selector/filter
   - Four columns with task cards
   - Drag-and-drop support
   - "New Task" button per column (or just backlog)

3. **Task Detail** (`/tasks/:id`)
   - Task header (title, status, project)
   - Description (markdown rendered)
   - Agent sessions list
   - Active session chat interface
   - Justfile commands panel
   - Tunnels panel
   - "Delete Worktree" button

4. **Project Settings** (`/projects/:id/settings`)
   - Edit name, path
   - Configure symlinks
   - Setup/teardown scripts
   - Delete project

5. **Terminal Modal** (overlay)
   - Full-screen xterm.js
   - Connected to selected tmux pane
   - Close button

### Component Breakdown

```
src/
├── components/
│   ├── common/
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Modal.tsx
│   │   ├── Card.tsx
│   │   └── Spinner.tsx
│   │
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── Layout.tsx
│   │
│   ├── kanban/
│   │   ├── Board.tsx
│   │   ├── Column.tsx
│   │   └── TaskCard.tsx
│   │
│   ├── task/
│   │   ├── TaskDetail.tsx
│   │   ├── TaskHeader.tsx
│   │   ├── TaskDescription.tsx
│   │   └── TaskActions.tsx
│   │
│   ├── agent/                    # INDEPENDENT MODULE
│   │   ├── AgentSession.tsx      # Main container
│   │   ├── MessageList.tsx       # Chat messages
│   │   ├── MessageInput.tsx      # Input field
│   │   ├── ToolCallDisplay.tsx   # Tool use rendering
│   │   └── SessionControls.tsx   # Start/stop/status
│   │
│   ├── terminal/
│   │   └── TerminalModal.tsx     # xterm.js wrapper
│   │
│   ├── justfile/
│   │   └── JustfilePanel.tsx     # Command list + run
│   │
│   └── tunnel/
│       └── TunnelPanel.tsx       # Active tunnels
│
├── hooks/
│   ├── useWebSocket.ts
│   ├── useAuth.ts
│   └── useAgentSession.ts
│
├── api/
│   ├── client.ts                 # Fetch wrapper with auth
│   ├── projects.ts
│   ├── tasks.ts
│   └── sessions.ts
│
├── pages/
│   ├── Login.tsx
│   ├── Dashboard.tsx
│   ├── TaskDetail.tsx
│   └── ProjectSettings.tsx
│
└── App.tsx
```

## Development Milestones

**Process note:** While milestones are ordered sequentially, expect feedback loops. After
completing a milestone, we may discover issues or improvements needed in previous work.
This is normal and expected - each milestone should include time to revisit and refine
earlier milestones based on what we learn.

```
M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9
↑____↑____↑____↑____↑____↑____↑____↑____↑
         (feedback loops back as needed)
```

### Milestone 1: Foundation (Backend) ✓

- [x] Project structure setup (Go modules, directories)
- [x] SQLite database with migrations
- [x] Basic HTTP server with Chi
- [x] CORS and auth middleware
- [x] Project CRUD endpoints
- [x] Task CRUD endpoints

### Milestone 2: Foundation (Frontend) ✓

- [x] Vite + React + TypeScript setup
- [x] Tailwind configuration
- [x] API client with auth
- [x] Login page
- [x] Basic layout (sidebar + main)
- [x] Project list in sidebar

### Milestone 3: Kanban Board

- [x] Kanban board component
- [x] Task cards with drag-and-drop
- [x] Create task modal
- [x] Task status updates via drag
- [x] Filter by project
- [x] Create project modal
- [x] Design system (Matrix-inspired, monospace, sharp corners)

### Milestone 4: Worktree Management ✓

- [x] Git worktree create/delete functions
- [x] Branch creation
- [x] Symlink management
- [x] Setup script execution
- [x] API endpoints for worktree ops
- [x] Auto-create worktree on status change

### Milestone 5: Agent Execution

- [ ] Tmux session management
- [ ] Claude executor (spawn, parse output)
- [ ] Session database operations
- [ ] WebSocket server
- [ ] Real-time output streaming
- [ ] MCP server for callbacks

### Milestone 6: Agent UI

- [ ] Agent session component
- [ ] Message list with streaming
- [ ] Message input
- [ ] Tool call display
- [ ] Session status indicator
- [ ] Send message via WebSocket

### Milestone 7: Terminal Escape Hatch

- [ ] xterm.js integration
- [ ] WebSocket terminal backend (or tmux attach)
- [ ] Terminal modal component
- [ ] Connect to specific tmux pane

### Milestone 8: Justfile & Tunnels

- [ ] Justfile parser
- [ ] Run command endpoint
- [ ] Command output streaming
- [ ] JustfilePanel component
- [ ] Cloudflared tunnel spawn/kill
- [ ] TunnelPanel component

### Milestone 9: Polish & Deploy

- [ ] Mobile responsive CSS
- [ ] Error handling throughout
- [ ] Loading states
- [ ] Empty states
- [ ] Build scripts
- [ ] Systemd service file
- [ ] Basic documentation

## Success Criteria

MVP is complete when:

1. User can manage projects and tasks via kanban board
2. User can start Claude Code session and have a conversation
3. User can see real-time agent output
4. User can send messages to agent and receive responses
5. User can open terminal to access full CLI
6. User can run justfile commands
7. User can expose dev server ports
8. All of the above works on mobile browser

## Post-MVP Priorities

After MVP, likely priorities in order:

1. **Session forking UI** - Expose /fork without terminal
2. **Codex support** - Second agent provider
3. **Project context caching** - Efficiency gain
4. **Auto-cleanup worktrees** - Housekeeping
5. **Diff viewer** - See changes without terminal
6. **GitHub import** - Convenience
7. **More tunnel options** - Tailscale, custom domains

---

## Appendix: Nice-to-Have Tracker

Full list of deferred features for future reference:

| Feature | Description | Priority |
|---------|-------------|----------|
| GitHub project import | Import from GitHub URL (clone), create new repos | Medium |
| Codex agent support | Add OpenAI Codex executor | Medium |
| Gemini agent support | Add Google Gemini executor | Low |
| Container per project | Docker isolation for different stacks | Medium |
| Container per task | Full isolation per task | Low |
| Prebuilds | Pre-built images for faster start | Low |
| Cost/token tracking | Track API usage per task | Low |
| Multi-agent coordination | Conflict detection between agents | Low |
| Collaborators | Share projects with others | Low |
| OAuth login | Google/GitHub authentication | Medium |
| Telegram bot | Control via Telegram | Medium |
| LLM meta-control | AI managing the platform | Low |
| MCP API | Expose Codeburg as MCP server | Medium |
| Public REST API | Documented external API | Low |
| Session forking UI | Fork button instead of /fork | High |
| File editing on mobile | Edit files from phone | Low |
| Diff viewer | Visual diff of changes | High |
| Auto-cleanup worktrees | Delete old worktrees automatically | Medium |
| Project context caching | Remember codebase knowledge | High |
| Custom task types | Bug, feature, chore labels | Low |
| Task dependencies | Block tasks on other tasks | Medium |
| Subtasks | Hierarchical tasks | Low |
| Notifications | Push/email when agent needs input | Medium |
| Keyboard shortcuts | Power user efficiency | Medium |
| Dark/light theme | User preference | Low |
| Activity log | History of all actions | Low |
| Search | Find tasks, projects | Medium |
| Bulk operations | Move multiple tasks | Low |
