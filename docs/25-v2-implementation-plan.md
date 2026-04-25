# Codeburg V2 First Implementation Plan

This document turns the V2 product direction into a first build plan.

It is intentionally biased toward getting a testable slice working quickly, while keeping the architecture aligned with the V2 model.

## What Is Locked In

The following decisions are considered settled for the first implementation pass:

- project setup and discovery are database-native
- every project has an explicit canonical workspace for its configured default branch
- conversations are pi-native/chat-style only for now
- provider-native history is the canonical conversation history when available
- pi should be integrated via SDK/RPC
- persistent PTY-backed terminal sessions are first-class and workspace-attached
- a workspace may have many terminal sessions
- actions are inline DB commands
- tasks are deferred
- shared project/skill resources should remain portable where possible
- Codeburg-private runtime state stays under `~/.codeburg/`

## First Testable Vertical Slice

The first slice should include:

1. Project creation and setup
2. Canonical default-branch workspace creation
3. Persistent terminal sessions attached to workspaces
4. Basic contextual code tools in the right pane
5. Pi conversation list/detail stub

This is the smallest slice that still feels like the product.

## Phase 1 Scope

### Backend

Build first:

- `projects`
- `workspaces`
- `terminal_sessions`

Defer initially:

- full conversation search
- tasks
- advanced pi package management

### Frontend

Build first:

- new app shell
- project list/create
- project detail/setup
- workspace detail
- terminal session view
- right helper pane skeleton

## Backend Plan

### Step 1: New V2 Schema

Add initial tables:

- `projects`
- `workspaces`
- `terminal_sessions`

Include:

- project `repo_path`
- project `default_branch`
- project `open_command`
- project `cleanup_command`
- workspace `kind`, `status`, `branch_name`, `worktree_path`
- terminal `status`, `cwd`, `shell`, `last_activity_at`

Important behavior:

- on project creation, automatically create the canonical default-branch workspace

### Step 2: Project API

Implement:

```http
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id
```

For day one, project create should:

- validate repo path exists
- validate it is a git repo
- record configured default branch
- create canonical workspace object

### Step 3: Workspace API

Implement:

```http
GET    /api/projects/:id/workspaces
GET    /api/workspaces/:id
PATCH  /api/workspaces/:id
POST   /api/workspaces/:id/promote
POST   /api/workspaces/:id/fork
```

Initial UI only needs:

- listing workspaces
- viewing canonical workspace

Promotion/fork can begin as stubs or narrow implementations if needed.

### Step 4: Terminal Session API

Implement:

```http
GET    /api/workspaces/:id/terminals
POST   /api/workspaces/:id/terminals
GET    /api/terminals/:id
POST   /api/terminals/:id/input
POST   /api/terminals/:id/resize
DELETE /api/terminals/:id
```

Behavior:

- PTY remains alive when frontend disconnects
- reconnect attaches to the same session
- a workspace can spawn many terminal sessions
- user manually launches Claude Code, Codex CLI, or plain shell commands inside the terminal

This should reuse as much of the V1 PTY/session machinery as possible.

### Step 5: Workspace File/Git/ Diff APIs

Reuse and adapt V1 primitives under workspace-scoped routes:

```http
GET    /api/workspaces/:id/files
GET    /api/workspaces/:id/file
PUT    /api/workspaces/:id/file
GET    /api/workspaces/:id/git/status
GET    /api/workspaces/:id/git/diff
GET    /api/workspaces/:id/git/diff-content
POST   /api/workspaces/:id/git/stage
POST   /api/workspaces/:id/git/unstage
```

Day one can start read-only if that speeds up validation.

### Step 6: Pi Conversation Stub

Implement minimal conversation records and routes, but keep the initial integration narrow.

Suggested first routes:

```http
GET    /api/projects/:id/conversations
POST   /api/projects/:id/conversations
GET    /api/conversations/:id
```

The goal of phase 1 is not full pi integration yet.

The goal is:

- create the domain slot
- wire the UI shell around the expectation that pi conversations are central

Then follow quickly with SDK/RPC integration in the next pass.

## Frontend Plan

### Step 1: New App Shell

Build a new route-based shell with:

- left sidebar
- center main area
- right helper pane

Do not try to evolve the V1 expanding side-panel architecture into this.

Recommended approach:

- create a new V2 shell and routes in parallel
- reuse smaller UI primitives if useful
- do not reuse V1 navigation assumptions

### Step 2: Project Screens

Build:

- `ProjectsList`
- `ProjectCreate`
- `ProjectOverview`
- `ProjectSetup`

This is the first product entry point.

### Step 3: Workspace Screen

Build:

- `WorkspaceDetail`

Center:

- active terminal session or workspace landing state

Right pane:

- file tree
- diff
- git
- actions placeholder

### Step 4: Terminal Session View

Build:

- terminal session tabs/list within a workspace
- attach/reconnect behavior
- spawn terminal button
- close terminal button

This is the most important live behavior for the first slice.

### Step 5: Conversation Stub UI

Build:

- `ProjectConversations`
- `ConversationDetail`

Initial version may be mostly metadata placeholders plus shell layout.

That is acceptable if it allows the app structure to be validated before pi integration deepens.

## Reuse Strategy From V1

Strong reuse candidates:

- auth
- DB foundation/migrations framework
- PTY runtime
- terminal websocket plumbing
- git/diff/file APIs
- worktree operations

Weak reuse candidates:

- panel navigation shell
- task-detail-driven UI
- task-owned session abstractions
- justfile auto-action model

## Suggested Repo Strategy

Build V2 in the same repo, but clearly separated.

Suggested shape:

- keep current V1 code intact while V2 takes shape
- add V2 routes, handlers, stores, and screens under explicit `v2`-oriented areas if helpful
- migrate reusable backend primitives rather than rewriting everything first

This keeps shipping risk down while allowing a clean UI/product reset.

## Reference Repos

Create a gitignored directory for external references once implementation begins.

Suggested path:

```text
reference-repos/
```

Useful candidates:

- `reference-repos/pi-mono`
- `reference-repos/openai-skills`

Purpose:

- inspect real pi package/resource structures
- inspect Agent Skills layouts
- validate assumptions while implementing integrations

This directory should remain ignored by git.

## Remaining Questions Before Coding

The remaining questions are now implementation-level rather than product-level.

They can be answered during build:

- exact table/field names
- exact route naming
- exact frontend component boundaries
- how much V1 PTY code can be reused directly
- whether the initial pi integration lands in the first backend slice or immediately after

## Recommended Immediate Next Move

Start implementation with:

1. schema migration for `projects`, `workspaces`, `terminal_sessions`
2. project creation flow that auto-creates the canonical default-branch workspace
3. persistent terminal session backend on top of V1 PTY machinery
4. new three-pane V2 shell
5. project/workspace screens

Once that works, the product becomes real enough to test and iterate against.
