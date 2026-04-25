# Codeburg V2 UI, Screens, And Deployment

This document defines the V2 application shell, primary screens, and deployment/versioning approach.

## UI Principles

V2 should move away from V1's dense panel-heavy shell.

Guiding principles:

- lighter visual treatment
- less boxing
- less nested panel chrome
- more reliance on layout and spacing
- fewer expanding side panels
- stronger page-level navigation
- terminal as a supported surface, not the shell-defining abstraction
- one central focused work surface with contextual helper tools

## Primary Shell Layout

The default V2 shell should follow a three-pane layout inspired by OpenAI Codex:

- left sidebar
- center focused work area
- right contextual helper tools pane

### Left Sidebar

Purpose:

- navigation
- switching between projects/conversations/workspaces
- quick access to search
- recents and pinned items

Suggested content:

- top-level nav
- project switcher
- recent conversations
- active workspaces
- global search entry point

### Center Focus Area

Purpose:

- hold the currently focused conversation or terminal session
- remain visually dominant

This is the primary surface for:

- pi chat UX
- persistent terminal sessions
- resume/fork flows

### Right Helper Pane

Purpose:

- provide contextual tools without competing with the main work surface

Suggested tabs or sections:

- file explorer
- file viewer/editor
- diff explorer
- git actions/status
- actions
- workspace info

Important rule:

the right pane should support the current conversation/workspace, not replace the center as the main focus.

## Navigation Model

Top-level navigation:

- `Projects`
- `Conversations`
- `Workspaces`
- `Skills`
- `Settings`

Optional later:

- `Tasks`

Rationale:

- `Projects` is the home for setup and configuration
- `Conversations` is a first-class cross-project work history view
- `Workspaces` supports parallel execution and active coding contexts
- `Skills` must be first-class in V2

## Project Information Architecture

Within a project, use tabbed or segmented navigation:

- `Overview`
- `Workspaces`
- `Conversations`
- `Actions`
- `Skills`
- `Setup`
- optional `Tasks`

Avoid V1's side-expanding panel model here.

Project pages should feel like stable destinations, not nested overlays.

Within the default app shell:

- the left sidebar remains stable
- the center area updates to the current project/conversation/workspace destination
- the right pane updates contextually based on the active conversation/workspace

## Primary Screens

### Projects List

Purpose:

- entry point into all codebases
- quick search and opening
- create/import project

Suggested content:

- project cards/rows
- active workspaces count
- recent conversations count
- status indicators
- last activity

Primary actions:

- create project
- import repo
- open project

### Project Overview

Purpose:

- give immediate operational context

Suggested content:

- active workspaces
- recent conversations
- favorite or common actions
- setup/config health hints
- recent runtime activity

This should replace V1's tendency to push users directly into kanban/task detail flows.

### Project Setup

Purpose:

- make environment configuration obvious and first-class

Suggested sections:

- repository path
- default branch
- workspace defaults
- open/setup command
- cleanup/delete command
- secrets strategy
- editor/open-in-IDE integration
- preferred provider defaults
- deployment metadata if useful

This screen should be one of the most important V2 improvements over V1.

### Project Workspaces

Purpose:

- manage where code changes happen

Suggested sections:

- `Main`
- `Active Worktrees`
- `Merged`
- `Archived`

Primary actions:

- create workspace
- promote current flow to worktree
- fork workspace
- merge/archive workspace
- open in editor
- open persistent terminal

### Project Conversations

Purpose:

- show durable work threads for a project

Suggested content:

- search bar
- filters:
  - provider
  - status
  - current workspace
  - recent activity
- list with:
  - title
  - provider badge
  - surface badge
  - workspace badge
  - status
  - last activity

Primary actions:

- new pi conversation
- resume
- fork
- archive

### Conversation Detail

Purpose:

- center the durable thread of work

Header:

- title
- provider
- status
- current workspace
- last activity

Primary actions:

- start runtime
- switch/attach workspace
- fork conversation
- archive
- open related files/diff

Body in the center area:

- if `preferred_surface=chat`, render chat-first
- if `preferred_surface=terminal`, render terminal-first

Right helper pane:

- workspace history
- runtime history
- summary
- related tasks
- file tree
- diff
- git
- actions

The key design point:

pi conversations and persistent terminal sessions are both first-class, but they are different abstractions.

For now:

- pi is the primary conversation surface
- terminal is the primary persistent shell/runtime surface

### Global Conversations View

This should be one of the most valuable V2 screens.

Purpose:

- search old work
- resume forgotten work
- fork from previous explorations

Required capabilities:

- global search
- strong filters
- fast resume
- fork into new workspace

This is one of the places where V2 should feel distinctly better than V1.

### Global Workspaces View

Purpose:

- monitor parallel active coding contexts across projects

Suggested content:

- project
- workspace name
- branch
- status
- conversations attached
- active terminals
- dirty/clean git state
- last runtime activity

### Terminal Session View

Purpose:

- reopen and continue a long-lived workspace terminal from any device

Key properties:

- persistent beyond frontend page lifetime
- attached to a workspace
- can host any terminal workflow the user chooses manually
- does not require Codeburg-specific shortcuts to launch Claude Code or Codex CLI

### Actions Screen

Purpose:

- replace implicit autodiscovery with explicit configuration

Required capabilities:

- create action
- edit action
- delete action
- reorder actions
- test action

Suggested fields:

- display name
- command
- scope
- execution target

In the project chrome, expose actions as a button menu with:

- configured action buttons
- divider
- `Manage Actions`

### Skills Screen

Purpose:

- make agent skills/plugins visible and manageable

Sections:

- global skills/plugins
- project-enabled skills/plugins
- install/add
- enable/disable
- configuration

This should be treated as a core feature, not a settings afterthought.

### Tasks Screen

Purpose:

- optional planning lens

This is where kanban can still live.

Important rule:

kanban is an optional view over tasks, not the app's primary navigation or ownership model.

## Conversation UX Rules

### Search

Search should span:

- title
- summary
- message text
- provider
- project
- workspace
- branch

### Resume

Resume should be possible even when:

- the original workspace is merged
- the original runtime is gone
- the original task is archived or absent

### Fork

User should be able to:

- fork conversation only
- fork workspace only
- fork both together

The UI should offer clear options rather than assuming one fork model.

## Runtime UX Rules

### Chat Surface

Used primarily for:

- pi
- future providers with rich message-native UX

### Terminal Surface

Used for:

- Codex CLI
- Claude Code CLI
- raw shell-driven workflows

### Disposable Shell

Should be reachable from workspace UI as:

- `Open Shell`

This shell should not automatically create a durable conversation.

### Durable Terminal Conversation

Should be reachable as:

- `Start Terminal Conversation`

This should create a conversation-backed runtime with history, resume, and fork semantics.

## Frontend Architecture Direction

V2 frontend should bias toward:

- route-based pages
- lightweight local state
- clear object-specific hooks
- fewer mega-components

Avoid:

- dashboard-as-shell logic
- nested panels driving navigation
- task-centric rendering assumptions
- V1-style expanding side panel navigation

Likely top route structure:

```text
/projects
/projects/:id
/projects/:id/workspaces
/projects/:id/conversations
/projects/:id/actions
/projects/:id/skills
/projects/:id/setup
/conversations
/conversations/:id
/workspaces
/workspaces/:id
/skills
/settings
```

## Deployment And Versioning

V1 couples frontend and backend tightly:

- one Go service
- frontend served from backend dist
- frontend-only changes often imply backend deploy/restart

V2 should split these concerns.

## Recommended Deployment Model

### Backend

Deploy backend as its own versioned artifact.

Responsibilities:

- API
- auth
- project/workspace/conversation persistence
- runtime/session management
- file/git/diff operations
- action execution
- search index

### Frontend

Deploy frontend as its own versioned static artifact.

Responsibilities:

- UI rendering
- routing
- search UX
- chat/terminal/file/diff surfaces

### Preferred Hosting Shape

Short-term recommended shape:

- Debian VM
- `systemd` for backend service
- static frontend served independently
- Cloudflare tunnel remains acceptable

Suggested shape:

- `codeburg-backend.service`
- `caddy` or `nginx` serving frontend assets
- Cloudflare tunnel routing to frontend entrypoint and backend origin

Alternative:

- backend can still serve static assets temporarily
- but frontend must remain independently buildable and deployable

## Compatibility Contract

Frontend and backend should version independently.

Track:

- backend semver
- frontend semver
- API version

Example:

- backend `2.1.0`
- frontend `2.3.0`
- API version `2`

Backend should expose:

- current backend version
- API version
- minimum supported frontend version
- recommended frontend version

Frontend should:

- display its own version
- validate backend compatibility on load
- show explicit mismatch UI if needed

## Upgrade Strategy

Desired outcomes:

- frontend-only changes should deploy without backend restart
- backend upgrades should be independently rollable
- rollbacks should be simpler
- semver should be meaningful

Recommended release process:

### Frontend Release

1. build static bundle
2. publish artifact
3. switch symlink or replace served assets
4. no backend restart required

### Backend Release

1. build backend artifact
2. migrate database if needed
3. restart backend service
4. frontend remains untouched unless compatibility requires change

## Service Privilege Model

Default recommendation:

- backend service runs unprivileged
- privileged host operations use narrow helper mechanisms

Reason:

- most Codeburg operations do not need root
- clearer blast-radius boundaries
- easier auditing of machine-level actions

Candidate helper operations:

- system service restart/update
- package install
- writes under `/etc`

This can be validated pragmatically before V2 locks it in.

## Filesystem-Centric Asset Management

V2 should explicitly treat some domains as filesystem-native and expose management on top of them.

Most importantly:

- skills should follow the Agent Skills open standard
- pi-native packages/extensions should follow pi's own package/environment model
- project setup should remain human-readable on disk

This has UI implications:

- the app should present these resources as manageable objects
- but the storage model should remain compatible with direct filesystem inspection/editing

For standard skills specifically, the UI should support:

- discovery
- enable/disable
- install/link
- project association
- validation

without forcing skill definitions into the database as the source of truth

For pi-native package management, the UI should support:

- install/remove/update package
- inspect contained extensions/skills/prompts/themes
- project-local vs global scope
- validation and warnings about trust/full-system-access implications

## Shared Filesystem vs Codeburg State

The V2 filesystem should support future coexistence with other tools where possible.

### Shared / Future-Portable

These should be readable by another future agent-management tool:

- project config files
- Agent Skills standard skills
- pi package directories and manifests
- repository/workspace directories

### Codeburg-Private

These do not need to be understood by other tools:

- Codeburg conversation metadata and indexes
- Codeburg runtime/session records
- Codeburg terminal session records
- Codeburg task metadata
- Codeburg action execution history
- Codeburg-specific search/cache state

UI implication:

- the app should clearly distinguish between shared project resources and Codeburg runtime history
- users should be able to trust that installing/managing shared resources does not lock them into Codeburg

## macOS App Direction

V2 should prioritize the web app first and keep the macOS wrapper thin.

Recommended near-term approach:

- desktop app is a shell around the web UI/backend target
- desktop release cadence is separate from frontend/backend release cadence

This keeps:

- desktop wrapper simple
- frontend iteration fast
- backend deployment decoupled

Longer-term native integration can come later if it becomes clearly valuable.

## Recommended Implementation Order

### Phase 1

- backend schema for projects/workspaces/conversations/actions/skills
- route skeleton for new shell
- project setup screen

### Phase 2

- workspace flows
- conversation flows
- pi integration as primary rich conversation path
- terminal-backed durable conversation path

### Phase 3

- search/resume/fork
- action management
- skills management

### Phase 4

- optional tasks/kanban lens
- desktop shell polish
- version compatibility UX

## Summary

V2 should feel like:

- a project workspace and conversation system
- with first-class search, setup, and agent capability management
- not a task board that happens to launch sessions

The UI, deployment model, and versioning strategy should all reinforce that change.
