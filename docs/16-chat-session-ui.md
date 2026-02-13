# Chat Session UI: Structured Output Rendering

## Overview

Replace the raw TUI (xterm.js PTY stream) with a rich chat-style UI for Claude Code and Codex sessions. Instead of streaming terminal escape codes to the browser, spawn the agents in structured-output mode, parse their JSON messages, and render them as markdown, tool calls, diffs, and permission prompts in a React UI.

This document references patterns from the [Happy Coder](https://github.com/nicely-gg/happy) project, which already implements this approach for both Claude and Codex.

The Happy Coder code is available to be read locally at /Users/miguel/Developer/oss/happy

---

## Motivation

The current PTY-based rendering works well on desktop browsers but is painful on mobile devices. A structured chat UI would:

- Be responsive and mobile-friendly by default
- Show markdown-rendered agent text instead of raw ANSI
- Display tool calls (file edits, bash commands) as collapsible cards
- Enable a permission approval flow (approve/deny tool use from a phone)
- Allow message persistence and replay without a terminal ring buffer

---

## Current Codeburg Architecture (What We Have)

### Backend session startup
- **`backend/internal/api/sessions.go`** — `startSessionInternal()` (line ~245) builds the command and starts the PTY
  - Claude: `claude --dangerously-skip-permissions [--model M] [--resume ID] [PROMPT]`
  - Codex: `codex --full-auto [--model M] [PROMPT]`
- **`backend/internal/api/exec_session.go`** — In-memory `Session` struct with thread-safe status management
- **`backend/internal/api/hooks.go`** — `handleSessionHook()` receives Claude/Codex hook callbacks and maps them to session status transitions

### Backend PTY runtime
- **`backend/internal/ptyruntime/manager.go`** — `Manager` spawns processes via `creack/pty`, maintains a 2MB ring buffer per session, and pub/sub broadcasts output to WebSocket subscribers via `Attach()`

### Backend WebSocket
- **`backend/internal/api/terminal.go`** — `handleTerminalWS()` upgrades HTTP to WebSocket, attaches to PTY runtime, streams binary frames to the browser, and receives user keystrokes
- **`backend/internal/api/websocket.go`** — `WSHub` handles general pub/sub for session status changes, task updates, etc.

### Frontend terminal
- **`frontend/src/hooks/useTerminal.ts`** — Creates xterm.js `Terminal`, connects WebSocket to `/ws/terminal?session={id}`, writes binary ArrayBuffer chunks to `term.write()`
- **`frontend/src/components/session/TerminalView.tsx`** — Mounts xterm.js in a DOM container
- **`frontend/src/components/session/SessionView.tsx`** — Wraps TerminalView with status bar
- **`frontend/src/components/session/SessionTabs.tsx`** — Tab bar for switching between sessions

### Database
- **`backend/internal/db/migrations.go`** — `agent_sessions` table with `session_type TEXT DEFAULT 'terminal'` (migration 14)
- **`backend/internal/db/sessions.go`** — `AgentSession` struct, status enum (`idle`, `running`, `waiting_input`, `completed`, `error`)
- The `session_type` field already has `"chat"` reserved as a future value (see comment at `sessions.go:22-25`)

### Frontend API types
- **`frontend/src/api/sessions.ts`** — `AgentSession` interface, `SessionStatus` and `SessionProvider` types, API client functions

---

## Happy Coder Architecture (What We're Borrowing From)

### Claude integration (stream-json)
- **`happy/packages/happy-cli/src/claude/sdk/query.ts`** — Spawns `claude --output-format stream-json --verbose`, reads stdout line-by-line via `readline`, parses each line as JSON into `SDKMessage` types. Implements `AsyncIterableIterator<SDKMessage>`.
- **`happy/packages/happy-cli/src/claude/sdk/types.ts`** — Defines `SDKUserMessage`, `SDKAssistantMessage`, `SDKSystemMessage`, `SDKResultMessage`, `CanUseToolControlRequest`, `CanUseToolControlResponse`, `PermissionResult`.

### Codex integration (MCP)
- **`happy/packages/happy-cli/src/codex/codexMcpClient.ts`** — `CodexMcpClient` class. Connects to Codex via `StdioClientTransport({ command: 'codex', args: ['mcp-server'] })`. Receives events on `codex/event` notification channel. Handles permissions via `codex/elicitation` requests.
- **`happy/packages/happy-cli/src/codex/runCodex.ts`** — Event handler (line ~408) maps Codex events (`agent_message`, `exec_command_begin`, `exec_command_end`, `patch_apply_begin`, `patch_apply_end`, `agent_reasoning`, `turn_diff`, `task_complete`) to normalized tool-call messages (`CodexBash`, `CodexPatch`, `CodexReasoning`, `CodexDiff`).

### Message normalization
- **`happy/packages/happy-app/sources/sync/typesMessage.ts`** — Flattened message types: `UserTextMessage` (`kind: 'user-text'`), `AgentTextMessage` (`kind: 'agent-text'`), `ToolCallMessage` (`kind: 'tool-call'`), `ModeSwitchMessage` (`kind: 'agent-event'`). The `ToolCall` type tracks name, state (`running`/`completed`/`error`), input, result, and permission info.
- **`happy/packages/happy-app/sources/sync/typesRaw.ts`** — Raw-to-normalized transforms. Handles Codex hyphenated formats (`tool-call` → `tool_use`, `callId` → `id`). Zod schemas with `.passthrough()` for forward compatibility.
- **`happy/packages/happy-app/sources/sync/reducer/reducer.ts`** — Reducer that deduplicates messages, matches tool calls to results, tracks permission state, and manages sidechain (nested conversation) processing.

### UI components
- **`happy/packages/happy-app/sources/components/MessageView.tsx`** — Dispatches rendering by `message.kind`: `user-text` → `UserTextBlock`, `agent-text` → `AgentTextBlock`, `tool-call` → `ToolCallBlock`, `agent-event` → `AgentEventBlock`.
- **`happy/packages/happy-app/sources/components/markdown/MarkdownView.tsx`** — Parses markdown into blocks (text, headers, lists, code-block, table, mermaid) and renders with syntax highlighting.
- **`happy/packages/happy-app/sources/components/tools/ToolView.tsx`** — Displays tool calls with icon, title, status indicator, expandable input/output, and permission footer. Handles MCP tool naming (`mcp__` prefix).
- **`happy/packages/happy-app/sources/components/tools/knownTools.tsx`** — Registry of tool display configs (title, icon, Zod input schema, description extractor). Entries for `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Task`, `CodexBash`, `CodexPatch`, `CodexDiff`, `CodexReasoning`, etc.
- **`happy/packages/happy-app/sources/components/tools/ToolDiffView.tsx`** — Before/after diff rendering with line numbers.
- **`happy/packages/happy-app/sources/components/ChatList.tsx`** — Inverted FlatList rendering messages newest-first with keyboard handling.
- **`happy/packages/happy-app/sources/components/tools/PermissionFooter.tsx`** — Renders approve/deny buttons for tool permission requests. Different button sets for Claude vs Codex.

### Permission handling
- **`happy/packages/happy-cli/src/claude/utils/permissionHandler.ts`** — `PermissionHandler` class. Receives `control_request` messages from Claude's stream-json output, stores pending requests, sends push notifications, updates agent state. Resolves when the app sends a `permission` RPC response.
- **`happy/packages/happy-cli/src/codex/utils/permissionHandler.ts`** — `CodexPermissionHandler`, extends shared base. Handles `codex/elicitation` MCP requests.

---

## Implementation Plan: Claude Chat Sessions

### Phase 1: Backend — JSON Line Runtime

Create a new runtime alongside the existing PTY runtime that manages a process with piped stdio instead of a PTY.

#### 1.1 New runtime: `backend/internal/jsonruntime/`

```
jsonruntime/
  manager.go      — Process lifecycle, stdout parsing, message storage
  types.go        — Go structs for Claude SDK message types
```

**`manager.go`** core design:
- Spawn `claude --output-format stream-json --verbose --dangerously-skip-permissions [--model M] [--resume ID] [PROMPT]` via `exec.Command` with `cmd.StdoutPipe()` and `cmd.StdinPipe()` (no PTY)
- Read stdout with `bufio.Scanner`, parse each line as JSON into typed message structs
- Store messages in an ordered slice (replaces the ring buffer concept) — these are small JSON objects, not raw terminal output, so memory is bounded
- Pub/sub broadcast: subscribers receive parsed messages, not raw bytes
- `Attach()` returns `([]Message, <-chan Message, cancel, error)` — same pattern as `ptyruntime` but with structured data
- Write to stdin for sending user messages or interrupt signals

**`types.go`** — Claude SDK message types (derived from Happy's `types.ts`):

```go
type SDKMessage struct {
    Type    string          `json:"type"`    // "user", "assistant", "system", "result", "control_request", "control_response"
    Subtype string          `json:"subtype,omitempty"`
    Message *MessageContent `json:"message,omitempty"`
    // ... fields per type
}

type MessageContent struct {
    Role    string        `json:"role"`
    Content []ContentBlock `json:"content"`
}

type ContentBlock struct {
    Type      string `json:"type"`      // "text", "tool_use", "tool_result", "thinking"
    Text      string `json:"text,omitempty"`
    ID        string `json:"id,omitempty"`
    Name      string `json:"name,omitempty"`
    Input     any    `json:"input,omitempty"`
    ToolUseID string `json:"tool_use_id,omitempty"`
    Content   any    `json:"content,omitempty"`
    IsError   bool   `json:"is_error,omitempty"`
    Thinking  string `json:"thinking,omitempty"`
}
```

#### 1.2 Session startup changes: `backend/internal/api/sessions.go`

In `startSessionInternal()`, branch on `session_type`:

```go
if sessionType == "chat" {
    // Use jsonruntime — spawn with --output-format stream-json
    s.jsonRuntime.Start(sessionID, cmd, opts)
} else {
    // Existing path — use ptyruntime
    s.runtime.Start(sessionID, cmd, opts)
}
```

The command builder adds `--output-format stream-json --verbose` and removes interactive flags.

#### 1.3 New WebSocket handler or message type

Option A: New endpoint `/ws/chat?session={id}` that sends JSON messages instead of binary PTY frames.

Option B: Reuse `/ws/terminal` but switch protocol based on session type — if `session_type == "chat"`, send JSON text frames instead of binary.

**Recommendation:** Option A (new endpoint) is cleaner — no protocol switching, clear separation.

**Downstream messages** (server → browser):
```json
{"type": "message", "data": { "type": "assistant", "message": { "role": "assistant", "content": [...] } }}
{"type": "message", "data": { "type": "system", "subtype": "init", "session_id": "..." }}
{"type": "message", "data": { "type": "result", "subtype": "success", ... }}
```

**Upstream messages** (browser → server):
```json
{"type": "user_message", "content": "please fix the tests"}
{"type": "interrupt"}
```

#### 1.4 Message persistence: `backend/internal/db/`

Add an `agent_messages` table:

```sql
CREATE TABLE agent_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,          -- "user", "assistant", "system", "result"
    content_type TEXT NOT NULL,  -- "text", "tool_use", "tool_result", "thinking", "control"
    content_json TEXT NOT NULL,  -- Full JSON of the content block
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_messages_session_seq ON agent_messages(session_id, seq);
```

This enables:
- Session replay on reconnect (no ring buffer needed)
- History browsing after session completes
- Resume with full context visible

### Phase 2: Frontend — Chat Session View

#### 2.1 Message types: `frontend/src/api/chatMessages.ts`

Define TypeScript types mirroring the Go structs. Borrow the shape from Happy's `typesMessage.ts`:

```typescript
type ChatMessage =
  | { kind: 'user-text'; id: string; text: string; createdAt: string }
  | { kind: 'agent-text'; id: string; text: string; isThinking?: boolean; createdAt: string }
  | { kind: 'tool-call'; id: string; tool: ToolCall; createdAt: string }
  | { kind: 'system'; id: string; subtype: string; data: any; createdAt: string }
  | { kind: 'result'; id: string; subtype: string; data: any; createdAt: string };

type ToolCall = {
  name: string;
  toolUseId: string;
  state: 'running' | 'completed' | 'error';
  input: any;
  result?: any;
};
```

#### 2.2 WebSocket hook: `frontend/src/hooks/useChatSession.ts`

New hook (parallel to `useTerminal`) that:
- Connects to `/ws/chat?session={id}`
- Receives JSON messages and appends to a local message array (React state or Zustand store)
- Sends user messages and interrupts
- Handles reconnect with message replay (server sends full history on attach)

#### 2.3 Chat view components: `frontend/src/components/chat/`

```
chat/
  ChatSessionView.tsx    — Main container: message list + input box
  ChatMessageList.tsx    — Scrollable message list (auto-scroll to bottom)
  ChatMessage.tsx        — Dispatch by message kind → specialized renderers
  UserMessage.tsx        — User text bubble
  AgentMessage.tsx       — Markdown-rendered agent response
  ToolCallCard.tsx       — Collapsible card for tool calls (Bash, Read, Write, Edit, etc.)
  ToolResultView.tsx     — Tool output display (plain text, error highlighting)
  DiffView.tsx           — Before/after diff rendering for file edits
  MarkdownRenderer.tsx   — Markdown → React (use react-markdown + react-syntax-highlighter)
  SystemMessage.tsx      — System/status messages (model info, session init)
  ResultMessage.tsx      — Final result (success, token usage, cost)
  ChatInput.tsx          — Text input with send button, interrupt button
```

**Borrow heavily from Happy's patterns:**
- `MessageView.tsx` → dispatch logic for `ChatMessage.tsx`
- `MarkdownView.tsx` → rendering approach for `MarkdownRenderer.tsx`
- `ToolView.tsx` + `knownTools.tsx` → tool card design for `ToolCallCard.tsx`
- `ToolDiffView.tsx` → diff rendering for `DiffView.tsx`

Note: Happy uses React Native (Unistyles), Codeburg uses React DOM (Tailwind). The component structure and data flow transfer directly, but the styling needs to be rewritten in Tailwind.

#### 2.4 Session view branching: `frontend/src/components/session/SessionView.tsx`

```tsx
if (session.sessionType === 'chat') {
  return <ChatSessionView session={session} />;
} else {
  return <TerminalView session={session} />;
}
```

#### 2.5 New session creation UI

Update `NewSessionComposer` to allow choosing session type:
- **Terminal** (current) — raw PTY with xterm.js
- **Chat** (new) — structured output with rich UI

---

## Implementation Plan: Codex Chat Sessions

Codex is harder because it uses MCP rather than a simple JSON-lines output format.

### Option A: MCP Client in Go (Full Integration)

Implement an MCP stdio client in Go that communicates with `codex mcp-server`.

**Approach:**
- Use a Go MCP library (e.g. `mark3labs/mcp-go` or `github.com/modelcontextprotocol/go-sdk`)
- Port the notification handler logic from Happy's `codexMcpClient.ts`
- Map Codex events to the same `ChatMessage` types used for Claude

**Pros:** Full structured output, permission handling, session control.
**Cons:** Significant Go-side work. MCP protocol is still evolving. The Go MCP ecosystem is less mature than Node.js.

### Option B: Node.js Sidecar (Reuse Happy's Code)

Run a small Node.js process that wraps Codex via MCP (reusing Happy's TypeScript code) and exposes a JSON-lines interface that Go can consume.

**Approach:**
- Create a thin Node.js script that imports Happy's `CodexMcpClient`, connects to Codex, and writes normalized JSON lines to stdout
- Go backend spawns this sidecar the same way it would spawn Claude with `--output-format stream-json`
- Same `jsonruntime` handles both providers

**Pros:** Reuses battle-tested MCP integration code. Consistent interface to Go.
**Cons:** Adds a Node.js dependency. Extra process layer.

### Option C: Codex Stays Terminal-Only (Defer)

Keep Codex sessions as PTY/xterm.js and only implement chat mode for Claude initially.

**Pros:** Ship faster. Claude is the primary use case.
**Cons:** Inconsistent experience across providers.

### Recommendation

Start with **Option C** (Claude-only chat), then move to **Option A** or **Option B** based on how the Go MCP ecosystem matures. Codex's MCP interface is also still evolving (version detection in Happy's code between `mcp` and `mcp-server` subcommands suggests API instability).

---

## Codex Event-to-Message Mapping Reference

When Codex chat sessions are implemented, use this mapping (from Happy's `runCodex.ts`):

| Codex MCP Event | Chat Message Kind | Tool Name | Notes |
|---|---|---|---|
| `agent_message` | `agent-text` | — | Plain text response |
| `agent_reasoning` / `agent_reasoning_delta` | `tool-call` | `CodexReasoning` | Collapsible thinking block |
| `exec_command_begin` | `tool-call` (state: `running`) | `CodexBash` | Input: `{command, cwd}` |
| `exec_command_end` | `tool-call` (state: `completed`) | `CodexBash` | Result: `{output, exit_code}` |
| `exec_approval_request` | `tool-call` with permission | `CodexBash` | Needs approval UI |
| `patch_apply_begin` | `tool-call` (state: `running`) | `CodexPatch` | Input: `{changes: {file: diff}}` |
| `patch_apply_end` | `tool-call` (state: `completed`) | `CodexPatch` | Result: `{success, stderr}` |
| `turn_diff` | `tool-call` | `CodexDiff` | Input: `{unified_diff}` |
| `task_complete` | `system` | — | Session lifecycle event |

---

## Permission Handling (Future Phase)

Currently Codeburg runs `--dangerously-skip-permissions`. A future phase could add interactive permissions:

### How it works in Happy
1. Claude sends a `control_request` message (type `can_use_tool`) in the stream-json output
2. Happy's `PermissionHandler` stores the pending request, sends a push notification, updates agent state
3. The mobile app renders approve/deny buttons via `PermissionFooter.tsx`
4. User taps approve → RPC response flows back → Happy writes a `control_response` to Claude's stdin
5. Claude proceeds with the tool call

### What Codeburg would need
1. **Backend:** Parse `control_request` messages in `jsonruntime`, hold the request, expose via WebSocket
2. **Frontend:** Render permission UI in `ToolCallCard` (approve/deny buttons)
3. **Backend:** Receive approval via WebSocket upstream message, write `control_response` JSON to Claude's stdin

### Reference files
- Happy permission handler: `happy/packages/happy-cli/src/claude/utils/permissionHandler.ts`
- Happy permission UI: `happy/packages/happy-app/sources/components/tools/PermissionFooter.tsx`
- Claude control request type: `happy/packages/happy-cli/src/claude/sdk/types.ts` — `CanUseToolControlRequest`
- Claude control response type: same file — `CanUseToolControlResponse`

This is medium complexity but unlocks running without `--dangerously-skip-permissions`, which is a meaningful safety improvement for remote sessions.

---

## Risk Points and Limitations

### 1. No streaming text deltas

Claude's `--output-format stream-json` emits **complete messages**, not character-by-character deltas. Agent text appears in full chunks when a message is complete, not as a live typing effect.

**Mitigation:** Happy works around this by watching Claude's session JSONL files on disk (`~/.claude/projects/**/*.jsonl`) via a file watcher (`happy/packages/happy-cli/src/claude/utils/sessionScanner.ts`). This gives partial message updates as Claude writes to the file. Codeburg could implement the same pattern in Go using `fsnotify`.

**Impact:** Without this, users see nothing while Claude is thinking/writing, then the full response appears at once. With the JSONL file watcher, you get incremental updates.

### 2. `--output-format stream-json` is an SDK interface

This flag is documented but is effectively a CLI SDK interface. Anthropic could change the message format between Claude Code versions. Happy has to maintain compatibility across versions.

**Mitigation:** Use Zod-style validation with `.passthrough()` (or Go equivalent: decode only known fields, ignore extras). Version-pin Claude Code in deployment. Monitor changelogs.

### 3. Session resume requires message persistence

In terminal mode, `--resume` works because xterm.js + ring buffer shows the previous conversation. In chat mode, there is no terminal scrollback — you must replay messages from your own storage.

**Mitigation:** The `agent_messages` table handles this. On reconnect or resume, the server sends full message history. This is actually better than the terminal approach (no 2MB ring buffer limit, permanent history).

### 4. Maintaining two session modes

The codebase will have parallel paths: `ptyruntime` + `useTerminal` + `TerminalView` for terminal sessions, and `jsonruntime` + `useChatSession` + `ChatSessionView` for chat sessions. Both need testing, both can have bugs.

**Mitigation:** Keep the terminal path as-is (it works). The chat path is additive. Share session management code (status tracking, hooks, database) between both. The `SessionView` component is the only branching point in the frontend.

### 5. Claude-only initially

Codex chat sessions require MCP integration, which is substantially more work. Starting Claude-only means Codex users still get the terminal experience.

**Mitigation:** This is acceptable as a phased approach. Codex terminal mode works fine. The chat UI infrastructure built for Claude will be reusable when Codex support is added.

### 6. UI effort for parity with Happy

Happy has ~5K+ lines of message rendering components built up over time. A minimal chat UI (markdown + collapsible tool cards) is achievable quickly, but matching Happy's polish (diff views, mermaid diagrams, syntax highlighting, permission flow) takes sustained effort.

**Mitigation:** Start minimal:
1. **V1:** Markdown text + collapsible tool call cards with raw JSON input/output
2. **V2:** Syntax-highlighted code blocks, formatted tool descriptions
3. **V3:** Diff views, permission handling, streaming via JSONL file watcher

### 7. Mobile input limitations

A chat UI is better than a TUI on mobile, but composing complex prompts on a phone keyboard is still awkward.

**Mitigation:** This is inherent to the use case. The chat UI at least makes _reading_ output comfortable on mobile, and simple follow-up prompts ("yes", "fix the tests", "try a different approach") work fine with a phone keyboard.

### 8. Interrupt / cancel behavior

In terminal mode, Ctrl+C sends SIGINT directly through the PTY. In chat mode with piped stdio, you need to explicitly handle interrupts — either write to stdin or send a signal to the process.

**Mitigation:** `cmd.Process.Signal(os.Interrupt)` in Go, or write the interrupt character to stdin. Add an "Interrupt" button in the chat UI alongside the send button.

---

## Summary: Implementation Phases

| Phase | Scope | Effort |
|---|---|---|
| **Phase 1** | `jsonruntime` backend + `/ws/chat` endpoint + `agent_messages` table | Medium |
| **Phase 2** | `ChatSessionView` frontend + markdown rendering + tool cards | Medium |
| **Phase 3** | Session resume with message replay | Small |
| **Phase 4** | JSONL file watcher for streaming text deltas | Small-Medium |
| **Phase 5** | Permission handling (remove `--dangerously-skip-permissions`) | Medium |
| **Phase 6** | Codex MCP integration (Go or Node.js sidecar) | Large |
| **Phase 7** | Polish: diff views, syntax highlighting, mermaid, etc. | Ongoing |

Phases 1-3 deliver a usable Claude chat session. Phase 4 makes it feel responsive. Phases 5+ are progressive enhancements.
