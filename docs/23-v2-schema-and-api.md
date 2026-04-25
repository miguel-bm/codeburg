# Codeburg V2 Schema And API

This document turns the V2 domain model into a first-pass persistence and API design.

It is intentionally pragmatic:

- SQLite remains the primary database
- REST remains the primary API style
- WebSocket remains available for live updates and runtime streaming

## Design Goals

- make conversations first-class and durable
- decouple conversations from workspace/task ownership
- preserve runtime history separately from durable conversation identity
- keep tasks optional
- support search, fork, resume, and workspace reassignment cleanly
- use the database for relational state and the filesystem for artifact-native content

## Source Of Truth Rules

V2 should not force every meaningful object into SQLite.

Recommended source-of-truth split:

- database-first:
  - projects
  - workspaces
  - conversations
  - runtimes
  - terminal sessions
  - tasks
  - action metadata
- filesystem-first:
  - Agent Skills standard skills
  - pi package payloads
  - pi extensions
  - pi prompts/themes
  - transcripts/logs
  - secrets material
- hybrid:
  - project setup config
  - actions with optional script payloads
  - conversation event archives if large

## First-Pass Database Schema

### Projects

```sql
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT,
    description TEXT,
    repo_path TEXT NOT NULL,
    default_branch TEXT NOT NULL DEFAULT 'main',
    open_command TEXT,
    cleanup_command TEXT,
    secrets_strategy TEXT NOT NULL DEFAULT 'none',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at DATETIME
);
```

## Project Discovery And Config

Projects should be database-native in V2.

That means:

- project discovery is driven by DB records
- setup/config is stored in DB fields or related DB tables
- Codeburg does not require a filesystem config file to discover a project

Recommended day-one setup fields:

- `repo_path`
- `default_branch`
- `open_command`
- `cleanup_command`

Defer until clearly needed:

- workspace naming policy
- provider defaults
- extra setup-policy metadata beyond concrete use cases

Portability goal still applies at the resource level:

- repositories and shared skills remain portable on disk
- Codeburg-specific project registration remains private app state

### Workspaces

```sql
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('main', 'worktree')),
    status TEXT NOT NULL CHECK (status IN ('active', 'merged', 'abandoned', 'archived')),
    branch_name TEXT,
    base_branch TEXT,
    worktree_path TEXT,
    parent_workspace_id TEXT REFERENCES workspaces(id),
    origin TEXT NOT NULL DEFAULT 'direct' CHECK (origin IN ('direct', 'promoted', 'forked')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME
);

CREATE INDEX idx_workspaces_project ON workspaces(project_id);
CREATE INDEX idx_workspaces_status ON workspaces(status);
CREATE INDEX idx_workspaces_parent ON workspaces(parent_workspace_id);
```

Notes:

- every project should effectively have one canonical `main` workspace
- that workspace represents the project's configured default branch, which may be `main`, `master`, or another branch
- `worktree_path` may be null for `main`

### Conversations

```sql
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    provider TEXT NOT NULL,
    preferred_surface TEXT NOT NULL CHECK (preferred_surface IN ('chat', 'terminal')),
    status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'archived')),
    current_workspace_id TEXT REFERENCES workspaces(id),
    parent_conversation_id TEXT REFERENCES conversations(id),
    summary TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at DATETIME
);

CREATE INDEX idx_conversations_project ON conversations(project_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_workspace ON conversations(current_workspace_id);
CREATE INDEX idx_conversations_parent ON conversations(parent_conversation_id);
CREATE INDEX idx_conversations_last_activity ON conversations(last_activity_at DESC);
```

### Conversation Workspace Links

This preserves workspace history independently of the current workspace pointer.

```sql
CREATE TABLE conversation_workspace_links (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    relationship TEXT NOT NULL DEFAULT 'attached' CHECK (relationship IN ('attached', 'historical')),
    attached_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    detached_at DATETIME,
    UNIQUE(conversation_id, workspace_id, attached_at)
);

CREATE INDEX idx_conv_ws_conv ON conversation_workspace_links(conversation_id);
CREATE INDEX idx_conv_ws_workspace ON conversation_workspace_links(workspace_id);
```

### Conversation Runtimes

```sql
CREATE TABLE conversation_runtimes (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    workspace_id TEXT REFERENCES workspaces(id),
    provider TEXT NOT NULL,
    surface TEXT NOT NULL CHECK (surface IN ('chat', 'terminal')),
    runtime_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'waiting_input', 'stopped', 'failed')),
    provider_session_id TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    ended_at DATETIME
);

CREATE INDEX idx_runtimes_conversation ON conversation_runtimes(conversation_id);
CREATE INDEX idx_runtimes_workspace ON conversation_runtimes(workspace_id);
CREATE INDEX idx_runtimes_status ON conversation_runtimes(status);
```

### Terminal Sessions

This table stores persistent PTY-backed workspace terminals.

```sql
CREATE TABLE terminal_sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    title TEXT,
    status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'waiting_input', 'stopped', 'failed')),
    shell TEXT,
    cwd TEXT,
    provider_hint TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    ended_at DATETIME,
    last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_terminal_sessions_workspace ON terminal_sessions(workspace_id);
CREATE INDEX idx_terminal_sessions_status ON terminal_sessions(status);
CREATE INDEX idx_terminal_sessions_activity ON terminal_sessions(last_activity_at DESC);
```

Notes:

- this is intentionally provider-agnostic
- a session may host plain shell, Claude Code, Codex CLI, or any other terminal workflow
- Codeburg should not need to know which tool is running inside the PTY to keep the session alive and reconnectable
- a workspace may have many terminal sessions over time

### Conversation Events

This table stores the durable conversation history and event stream.

```sql
CREATE TABLE conversation_events (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    runtime_id TEXT REFERENCES conversation_runtimes(id),
    kind TEXT NOT NULL,
    role TEXT,
    provider TEXT,
    content TEXT,
    metadata_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_events_conversation ON conversation_events(conversation_id, created_at);
CREATE INDEX idx_events_runtime ON conversation_events(runtime_id, created_at);
```

`kind` examples:

- `user_message`
- `assistant_message`
- `tool_event`
- `status_event`
- `system_note`
- `terminal_output`

### Conversation Search

Use SQLite FTS for searchability.

```sql
CREATE VIRTUAL TABLE conversation_events_fts USING fts5(
    conversation_id UNINDEXED,
    event_id UNINDEXED,
    content,
    summary,
    project_name,
    workspace_name,
    branch_name,
    tokenize = 'unicode61'
);
```

This can be maintained by application code initially rather than SQL triggers.

## Conversation Storage Strategy

For conversations, prefer a hybrid model with provider-native history as the default bias:

- DB stores:
  - identity
  - title
  - status
  - project/workspace links
  - summaries
  - search metadata
  - lightweight event references if convenient
- filesystem stores:
  - optional cached transcript exports when needed

Preferred rule:

- use provider-native history as the canonical conversation history when available
- Codeburg stores enough metadata to list, search, resume, and relate conversations
- Codeburg should avoid becoming the primary chat-history implementation

Search/indexing rule:

- index project/workspace metadata
- index conversation title/summary
- index cached provider transcript text when accessible
- index terminal titles and limited captured scrollback metadata

Suggested path shape:

```text
~/.codeburg/conversations/<conversation-id>/
  cache/
  exports/
```

The database should remain the query surface, while provider-native systems remain the history surface.

### Actions

```sql
CREATE TABLE actions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('project', 'workspace')),
    run_in TEXT NOT NULL CHECK (run_in IN ('default_workspace', 'current_workspace', 'main_workspace')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_actions_project ON actions(project_id, sort_order, created_at);
```

## Action Storage Strategy

Actions should be DB-first with optional filesystem payloads.

Recommended approach:

- DB stores name, ordering, scope, and execution target
- actions store inline command text in DB

If more complex behavior is needed, actions should invoke repo-local scripts explicitly from their inline command text rather than creating a separate Codeburg script-payload abstraction.

## Secrets Strategy

Day-one secrets behavior should be simple:

- copy selected files into worktrees

Do not support multiple secret strategies until a real need appears.

If more flexibility is needed later, the schema/API can grow from a concrete copy-based model.

### Skills

Skills should be filesystem-first in V2 and should follow the Agent Skills open standard.

The source of truth for skills should be the standard skill files themselves, not database rows.

Suggested locations:

```text
~/.codeburg/skills/
~/.codeburg/projects/<project-id>/skills/
```

Suggested representation:

- each skill lives as an Agent Skills standard directory containing `SKILL.md`
- metadata is inferred from skill files where possible
- project enablement can be represented by:
  - symlinks
  - references in `project.toml`
  - a small project-local manifest file

Recommended first-pass implementation:

- do not create a `skills` table as the canonical source of truth
- scan filesystem skill locations
- expose skills through API as discovered resources
- store only minimal cached/indexed metadata if needed for performance

Interoperability goal:

- if another tool supports Agent Skills, it should be able to use the same skill directories
- Codeburg should not wrap standard skills in a proprietary format

Possible project manifest:

```text
~/.codeburg/projects/<project-id>/skills.toml
```

That manifest could track:

- enabled skills
- ordering/grouping
- project-specific overrides

### Pi Packages And Extensions

Pi-native extensibility should follow pi's own resource model instead of a Codeburg-specific plugin abstraction.

Relevant pi-native resource types:

- packages
- extensions
- skills
- prompts
- themes

Recommended storage model:

- source of truth remains pi package directories/manifests and pi settings files
- Codeburg scans, indexes, installs, enables, and disables them through pi-compatible mechanisms
- Codeburg may cache metadata in DB, but should not redefine the package format

This keeps Codeburg aligned with the real pi ecosystem instead of inventing a parallel plugin model.

### Tasks

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'backlog',
    workspace_id TEXT REFERENCES workspaces(id),
    conversation_id TEXT REFERENCES conversations(id),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
```

## API Shape

The V2 API should reflect the new first-class objects directly.

### Versioning

The backend should expose:

- backend version
- API version
- minimum supported frontend version

Suggested endpoint:

```http
GET /api/meta/version
```

Response:

```json
{
  "backendVersion": "2.0.0",
  "apiVersion": "2",
  "minFrontendVersion": "2.0.0",
  "recommendedFrontendVersion": "2.1.0"
}
```

## Projects API

```http
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id
```

Project setup/config:

```http
GET    /api/projects/:id/setup
PUT    /api/projects/:id/setup
```

Response shape should include:

- default branch
- open command
- cleanup command
- secrets strategy
- workspace defaults
- provider defaults

## Workspaces API

```http
GET    /api/projects/:id/workspaces
POST   /api/projects/:id/workspaces
GET    /api/workspaces/:id
PATCH  /api/workspaces/:id
DELETE /api/workspaces/:id
```

Operations:

```http
POST   /api/workspaces/:id/promote
POST   /api/workspaces/:id/fork
POST   /api/workspaces/:id/merge
POST   /api/workspaces/:id/archive
POST   /api/workspaces/:id/open
POST   /api/workspaces/:id/cleanup
```

Notes:

- `promote` converts a `main`-style workflow into a worktree-backed workspace
- `fork` creates a child workspace

## Conversations API

```http
GET    /api/projects/:id/conversations
POST   /api/projects/:id/conversations
GET    /api/conversations/:id
PATCH  /api/conversations/:id
DELETE /api/conversations/:id
```

Operations:

```http
POST   /api/conversations/:id/resume
POST   /api/conversations/:id/fork
POST   /api/conversations/:id/archive
POST   /api/conversations/:id/attach-workspace
POST   /api/conversations/:id/detach-workspace
GET    /api/conversations/:id/history
GET    /api/conversations/:id/runtimes
```

Search:

```http
GET /api/conversations/search?q=auth+flow&project=:id&provider=pi&status=active
```

This should search:

- title
- summary
- message content
- project/workspace names
- branch names

## Conversation Runtime API

```http
POST   /api/conversations/:id/runtimes
GET    /api/runtimes/:id
POST   /api/runtimes/:id/input
POST   /api/runtimes/:id/interrupt
DELETE /api/runtimes/:id
```

Runtime creation request example:

```json
{
  "provider": "pi",
  "surface": "chat",
  "workspaceId": "01...",
  "runtimeType": "pi_session"
}
```

Terminal-backed conversation example:

```json
{
  "provider": "codex",
  "surface": "terminal",
  "workspaceId": "01...",
  "runtimeType": "pty_agent"
}
```

Disposable shell example:

This should probably live under workspace shell APIs rather than conversation APIs:

```http
POST /api/workspaces/:id/shells
GET  /api/shells/:id
POST /api/shells/:id/input
DELETE /api/shells/:id
```

This keeps utility shells separate from durable conversations.

## Conversation Event API

```http
GET /api/conversations/:id/events?cursor=...
```

Post user message:

```http
POST /api/conversations/:id/messages
```

Example:

```json
{
  "content": "continue with the migration plan"
}
```

The backend should write a user event and route it to the active runtime if one exists.

## Terminal Session API

```http
GET    /api/workspaces/:id/terminals
POST   /api/workspaces/:id/terminals
GET    /api/terminals/:id
POST   /api/terminals/:id/input
POST   /api/terminals/:id/resize
DELETE /api/terminals/:id
```

Important semantics:

- terminal sessions are long-lived
- closing a frontend view does not terminate the terminal session
- reconnecting from another device should reattach to the same PTY-backed session
- Codeburg does not need first-class UI affordances for "start Claude" or "start Codex" initially; users may launch those manually inside the terminal

## Actions API

```http
GET    /api/projects/:id/actions
POST   /api/projects/:id/actions
GET    /api/actions/:id
PATCH  /api/actions/:id
DELETE /api/actions/:id
POST   /api/actions/:id/run
```

Optional:

```http
GET /api/actions/:id/runs
```

## Skills API

```http
GET    /api/projects/:id/skills
POST   /api/projects/:id/skills
PATCH  /api/skills/:id
DELETE /api/skills/:id
```

Global variants:

```http
GET    /api/skills
POST   /api/skills
```

Recommended semantics:

- these APIs operate on filesystem-backed standard skill resources
- create/install may write files or references
- enable/disable may update project-local manifests or links
- list operations should be discovery-based, not solely DB-backed

Recommended future pi-specific additions:

```http
GET    /api/projects/:id/pi/packages
POST   /api/projects/:id/pi/packages/install
POST   /api/projects/:id/pi/packages/remove
POST   /api/projects/:id/pi/packages/update
GET    /api/projects/:id/pi/extensions
GET    /api/projects/:id/pi/prompts
GET    /api/projects/:id/pi/themes
```

These should operate on pi-compatible filesystem/package state rather than a proprietary plugin registry.

## Tasks API

```http
GET    /api/projects/:id/tasks
POST   /api/projects/:id/tasks
GET    /api/tasks/:id
PATCH  /api/tasks/:id
DELETE /api/tasks/:id
```

Tasks remain auxiliary and should not be required for workspace or conversation creation.

## Workspace Code APIs

V1 already has useful primitives here. V2 should keep them but scope them more clearly to workspaces.

Files:

```http
GET    /api/workspaces/:id/files
GET    /api/workspaces/:id/file
PUT    /api/workspaces/:id/file
DELETE /api/workspaces/:id/file
POST   /api/workspaces/:id/file/rename
POST   /api/workspaces/:id/file/duplicate
POST   /api/workspaces/:id/files/search
```

Git:

```http
GET    /api/workspaces/:id/git/status
GET    /api/workspaces/:id/git/diff
GET    /api/workspaces/:id/git/diff-content
POST   /api/workspaces/:id/git/stage
POST   /api/workspaces/:id/git/unstage
POST   /api/workspaces/:id/git/revert
POST   /api/workspaces/:id/git/commit
POST   /api/workspaces/:id/git/push
```

## WebSocket Shape

Keep a single authenticated WebSocket with typed channels:

- `conversation`
- `runtime`
- `workspace`
- `shell`
- `action_run`

Example subscription message:

```json
{
  "type": "subscribe",
  "channel": "conversation",
  "id": "01..."
}
```

Useful events:

- conversation updated
- runtime status changed
- new conversation event appended
- workspace changed
- action run output chunk

## Migration Strategy From V1

Likely mapping:

- `project` stays `project`
- `task.worktree` becomes a `workspace`
- `session/chat` becomes a `conversation` plus runtime records
- `task` may remain a `task`, but becomes optional

Important migration principle:

do not force V1 task identity to remain the core identity in V2.

Instead:

- preserve historical links where useful
- migrate into the new object model even if it changes topology

Important portability principle:

- preserve portable filesystem concepts as portable filesystem concepts
- keep Codeburg-private state isolated so another future tool can coexist on the same disk layout

## Minimal Viable V2 Backend Slice

If building incrementally, the smallest useful backend slice is:

1. Projects
2. Workspaces
3. Conversations
4. Conversation runtimes
5. Search
6. Actions

Tasks and advanced plugin management can come slightly later if needed.
