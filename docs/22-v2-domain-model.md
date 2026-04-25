# Codeburg V2 Domain Model

This document defines the core product abstractions for Codeburg V2.

The key shift from V1 is:

- V1 centered the product on `task -> worktree -> session`
- V2 centers the product on `project -> workspace + conversation`

Tasks remain useful, but they are optional planning metadata rather than the primary execution model.

## Core Objects

### Project

`Project` is the durable home for a codebase and its operational configuration.

It owns:

- repository metadata
- setup and teardown configuration
- actions
- skills/plugins
- workspaces
- conversations
- terminal sessions
- optional tasks

Every other primary object belongs to exactly one project.

In V2, project identity and setup configuration should be database-native rather than file-native.

### Workspace

`Workspace` is a coding context inside a project.

A workspace answers: "Where are changes happening right now?"

Kinds:

- `main`: direct work in the main checkout
- `worktree`: isolated branch/worktree context

A workspace can:

- start on `main`
- be promoted into a worktree
- be forked into another workspace
- be merged
- be abandoned
- be archived

The same project may have multiple workspaces active at once.

Every project should always have one explicit canonical workspace for its default branch.

Despite the shorthand `main`, this should really mean:

- the project's configured default branch workspace

So the branch may be `main`, `master`, or another configured default branch.

### Conversation

`Conversation` is the durable thread of work.

A conversation answers: "What line of investigation or implementation are we continuing?"

A conversation:

- belongs to one project
- can attach to a workspace
- can move across workspaces over time
- survives merges and deploys
- can be resumed later
- can be forked
- can be searched independently of task/worktree state

The durable object is the conversation, not the currently running process.

In V2, Codeburg should prefer provider-native conversation history where available rather than trying to become the canonical chat-history system itself.

That means:

- Codeburg may index, summarize, and reference provider-native histories
- but the provider should remain the primary owner of raw conversation history when practical

### Conversation Runtime

`ConversationRuntime` is a live execution instance of a conversation.

It answers: "What process is currently active for this conversation?"

A conversation may have many runtimes over time, but usually only one active runtime.

Examples:

- a live pi conversation session
- a running Codex CLI process in a PTY
- a running Claude Code CLI process in a PTY

Runtimes are execution state. Conversations are durable product state.

For pi specifically, the preferred integration should be via SDK or RPC rather than shelling out to a wrapped CLI process when feasible.

### Terminal Session

`TerminalSession` is a long-lived PTY-backed terminal attached to a workspace.

It answers: "What long-running shell environment is available in this workspace?"

A terminal session:

- belongs to a workspace
- survives frontend disconnects
- can be reopened later from another device
- may run plain shell commands, Claude Code, Codex CLI, or any other terminal tool

This is closer to V1's terminal/session model than to a chat abstraction.

Important rule:

Codeburg should not assume that a terminal session is a conversation.

For now:

- conversations are primarily for provider-native chat-like systems such as pi
- terminal sessions are persistent workspace runtimes

This can evolve later if a deeper unified abstraction becomes clearly valuable.

### Action

`Action` is a user-defined named command attached to a project.

This replaces V1's auto-discovered action model from `justfile`, `package.json`, and similar files.

An action includes:

- a display name
- a command
- a target scope
- optional execution preferences

Actions should be intentionally configured by the user and surfaced as buttons/menu items in the UI.

### Skill / Pi Package

V2 should distinguish between:

- `Skill`: an Agent Skills open-standard resource
- `Pi Package / Extension`: a pi-native extensibility resource

These should both be visible and manageable in the UI, but they are not the same abstraction.

#### Skills

Skills may be:

- global
- project-specific

They influence conversation behavior more than workspace state.

V2 should adopt the Agent Skills open standard wherever possible.

That means:

- the source of truth for a skill should be standard `SKILL.md`-based files on disk
- Codeburg should provide discovery, enable/disable, install, linking, and project association on top of that standard filesystem model
- the app should avoid requiring a proprietary database row for every skill definition
- standard skills should remain portable across Codeburg, Codex, pi, and other compatible harnesses

#### Pi Packages / Extensions

Pi-native extensibility should align with pi's real resource model:

- packages
- extensions
- skills
- prompts
- themes

Codeburg should manage those resources using pi-compatible filesystem/package conventions rather than inventing a separate plugin format.

### Task

`Task` is optional planning metadata.

Tasks are useful for:

- parallel work tracking
- backlog/review organization
- kanban or list views

Tasks are not the primary owner of workspaces or conversations.

They may link to:

- a workspace
- a conversation
- both

But they do not define their lifecycles.

## Relationship Model

### Hard Ownership Rules

- A `Workspace` belongs to exactly one `Project`
- A `Conversation` belongs to exactly one `Project`
- A `ConversationRuntime` belongs to exactly one `Conversation`
- A `TerminalSession` belongs to exactly one `Workspace`
- A `Task` belongs to exactly one `Project`
- An `Action` belongs to exactly one `Project`

Skills and pi-native package resources are exceptions to strict database-style ownership:

- a skill may exist globally in the filesystem without belonging to any project
- a project may reference or enable many filesystem-native skills
- pi packages/extensions may exist globally or project-locally without being Codeburg-owned

### Attachment Rules

- A `Conversation` may have one current attached `Workspace`
- A `Conversation` may have zero or many historical workspace links
- A `Workspace` may be referenced by many conversations over time
- A `Workspace` may have many terminal sessions over time
- A `Task` may reference one workspace and/or one conversation

### Important Design Rule

Workspaces and conversations are peers under the project, not parent/child.

This is the central V2 design choice.

That means:

- a conversation can outlive a workspace
- a workspace can host multiple conversations over time
- task state cannot implicitly control conversation lifetime

## Surfaces And Runtime Types

The system should distinguish between:

- durable work thread
- live process/runtime
- UI surface

### Durable Work Thread

This is the `Conversation`.

### Runtime

This is the `ConversationRuntime`.

### Surface

This is how the runtime is presented to the user.

Initial surfaces:

- `chat`
- `terminal`

Potential future surface:

- `hybrid`

This allows symmetric treatment of providers:

- pi can use `chat`
- Codex CLI can use `terminal`
- Claude Code CLI can use `terminal`

The provider does not determine whether the work is durable. The conversation does.

Terminal sessions are different:

- they are durable workspace runtimes
- they are not automatically modeled as conversations
- they may host any tool the user chooses to run manually

## Database vs Filesystem Model

V2 should be deliberate about what is a relational object and what is a file artifact.

### Database-Native

These objects are primarily relational and should live in SQLite:

- `Project`
- `Workspace`
- `Conversation`
- `ConversationRuntime`
- `TerminalSession`
- `Task`
- `Action` metadata

These benefit from:

- indexing
- filtering
- relational joins
- transactional lifecycle changes

### Filesystem-Native

These objects should primarily exist as files/directories on disk:

- Agent Skills standard skill definitions
- pi package payloads
- pi extensions
- pi prompts/themes
- raw provider transcripts
- terminal capture/log files
- secrets material
- workspace-local helper files

These are better as files because:

- users may want to inspect or edit them directly
- they may be large or append-only
- their file representation is part of their usefulness

### Hybrid

These should use both DB and filesystem:

- project setup/config
- actions when they evolve into reusable scripts
- conversations if we retain a DB summary/index plus filesystem transcript archive
- project-local references to enabled skills/packages

The default rule should be:

- DB stores identity, relationships, statuses, and indexed metadata
- filesystem stores large content, editable artifacts, and operational payloads

## Portability Rule

The filesystem layout should be designed so that a future tool could operate on the same project and skill directories without understanding Codeburg-specific runtime state.

That means V2 should separate:

- shared/interoperable filesystem structures
- Codeburg-private application state

### Shared / Interoperable Filesystem

These should be usable by tools other than Codeburg:

- project config files if we define them in a simple documented format
- Agent Skills standard skill directories
- pi package directories and manifests
- repository and workspace directories themselves

### Codeburg-Private State

These can remain Codeburg-specific:

- conversation indexes
- runtime/session metadata
- terminal session metadata
- task state
- action run history
- search indexes

Important constraint:

Codeburg should avoid storing shared concepts like skills and project setup exclusively in private database state when they can live in portable filesystem formats.

## When A Terminal Is Durable

Not every terminal should be a durable conversation runtime.

There are two terminal categories:

### Durable Terminal Conversation

This should create or attach to a `Conversation` when:

- it is explicitly started as an agent interaction
- it has resumable provider state
- it is named/saved by the user
- it is launched from a conversation

Examples:

- "Start Codex conversation"
- "Resume Claude conversation"

### Disposable Utility Shell

This should remain a plain transient runtime when:

- the user just wants a shell
- the use is brief or operational
- no resumable work thread is intended

Examples:

- run a quick command
- inspect logs
- edit something manually

This distinction should be explicit in the UI:

- `Open Shell`
- `Start Conversation In Terminal`

## Workspace Lifecycles

### Workspace Kinds

- `main`
- `worktree`

### Workspace Statuses

- `active`
- `merged`
- `abandoned`
- `archived`

### Allowed Workspace Evolutions

1. Main-only exploration
2. Promotion to worktree
3. Fork into child workspace
4. Merge
5. Archive

### Important Rule

Promoting a workspace from `main` to `worktree` should not require creating a new conversation.

The conversation should remain stable while the attached workspace evolves.

## Conversation Lifecycles

### Conversation Statuses

- `active`
- `paused`
- `completed`
- `archived`

### Allowed Transitions

- `active <-> paused`
- `active -> completed`
- `paused -> completed`
- `completed -> active` by resume
- any non-archived status -> `archived`

### Important Rule

Workspace merge/archive must not implicitly complete or archive a conversation.

Conversations are durable by design and can continue after code has landed.

## Runtime Lifecycles

### Runtime Statuses

- `starting`
- `running`
- `waiting_input`
- `stopped`
- `failed`

### Important Rule

Runtime end does not imply conversation end.

If a process exits:

- the runtime stops
- the conversation remains resumable/searchable unless explicitly archived or completed

## Forking Rules

### Workspace Fork

Forking a workspace creates a new workspace with:

- its own branch/worktree
- a pointer to `parent_workspace_id`

### Conversation Fork

Forking a conversation creates a new conversation with:

- inherited context and metadata
- a pointer to `parent_conversation_id`

### Independence Rule

Forking a workspace does not automatically require forking the conversation.
Forking a conversation does not automatically require forking the workspace.

The UI may offer both together, but the domain model should keep them separate.

## Canonical User Flows

### Flow 1: Explore On Main

1. Open project
2. Start conversation
3. Attach to `main` workspace
4. Launch runtime in chat or terminal

### Flow 2: Promote To Worktree

1. Existing conversation is attached to main workspace
2. User decides the work needs isolation
3. Workspace is promoted to dedicated worktree
4. Conversation remains the same
5. New runtime may start in the new worktree

### Flow 3: Split Work

1. Workspace becomes large or branches into alternatives
2. User forks workspace
3. User may keep one conversation across both over time or fork the conversation too

### Flow 4: Merge And Continue

1. Workspace merges
2. Workspace is marked `merged`
3. Conversation remains active or paused
4. Later, the conversation can attach to `main` or another new workspace

## Summary

Codeburg V2 should treat:

- `Project` as the durable container
- `Workspace` as the coding context
- `Conversation` as the durable thread of work
- `ConversationRuntime` as live execution state

This model supports:

- durable chat history
- durable terminal-backed agent history
- flexible movement between `main` and worktrees
- first-class search, resume, and fork
- tasks/kanban as optional organizational overlays rather than core execution structure
