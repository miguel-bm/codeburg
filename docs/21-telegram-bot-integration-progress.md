# Telegram Bot Integration Progress

Date: 2026-02-14  
Branch: `feat-telegram-bot-integration`

## Scope

Goal: extend Telegram support from basic webapp auth/start behavior to a full bot interface for Codeburg:

- authenticated web portal entry via Telegram webapp
- command-based control for essential operations
- non-command chat routed through an LLM that can call Codeburg tools/actions
- proactive Telegram notifications when sessions need user attention

## Telegram Setup Runbook (BotFather + Codeburg)

### 1) Create and configure bot in Telegram

1. Open `@BotFather`
2. Run `/newbot` and complete prompts
3. Copy the bot token (format like `123456:ABC...`)
4. Optional but recommended:
   - `/setdescription` and `/setabouttext`
   - `/setuserpic`
   - `/setcommands` with:
     - `help - show commands`
     - `tasks - list tasks`
     - `task - task details`
     - `newtask - create task`
     - `move - move task status`
     - `session - start session`
     - `reply - reply to session`
     - `yeet - commit and push`
     - `stomp - amend and force push`

### 2) Configure Mini App / Web App URL

In `@BotFather`:

1. Run `/mybots` -> select your bot
2. Open Bot Settings -> Menu Button (or Web App, depending on current BotFather UI)
3. Set the Web App URL to your Codeburg origin, for example:
   - `https://codeburg.example.com`

Notes:

- Use the same origin configured for Codeburg auth/WebAuthn (`config.yaml` auth origin).
- HTTPS is required for Telegram web app flows in real deployments.
- If origin changes, update it in Codeburg and in BotFather menu button config.

### 3) Get your Telegram user ID

1. Open `@userinfobot` (or equivalent trusted bot)
2. Send `/start`
3. Copy your numeric user id

### 4) Optional channel setup (for broadcast-style notifications)

Current implementation sends direct messages to configured user id, not channel broadcasts.

If you still want channel routing later:

1. Create private channel
2. Add your bot as admin with permission to post messages
3. Capture channel id (typically `-100...`)
4. Add future preference key for channel target (not implemented yet)

### 5) Add configuration in Codeburg Settings UI

In Codeburg -> Settings -> Telegram:

- `Bot Token` -> save bot token from BotFather
- `Your Telegram User ID` -> save numeric user id
- `LLM API Key` -> OpenAI/OpenRouter key for non-command chat
- `LLM Base URL` -> e.g.:
  - OpenAI: `https://api.openai.com/v1`
  - OpenRouter: `https://openrouter.ai/api/v1`
- `LLM Model` -> model id (example: `gpt-4.1-mini`)

Save triggers Telegram bot restart through existing backend endpoint.

### 6) Quick verification checklist

1. Open bot chat and run `/start`
2. Confirm “Open Codeburg” button appears and opens the app
3. Confirm Telegram-auth login works for configured user
4. Run `/help` and `/tasks`
5. Send a non-command message and verify LLM response
6. Trigger a session waiting state and confirm Telegram attention message arrives

## What’s Done So Far

### 1) Telegram bot runtime upgraded

Implemented in:

- `backend/internal/telegram/bot.go`

Changes:

- moved from minimal `/start`-only behavior to a message-routing bot runtime
- added support for:
  - command messages
  - regular text messages
  - authorized-user filtering via configured Telegram user ID
- added reusable outbound bot send method (`SendMessage`) for server-triggered notifications
- `/start` now still opens the Codeburg web app with inline webapp button and mentions `/help`

### 2) Server integration for bot lifecycle and handlers

Implemented in:

- `backend/internal/api/server.go`

Changes:

- server now stores a live Telegram bot instance
- bot startup now injects handler callbacks for:
  - commands
  - non-command messages
- bot startup now reads both:
  - `telegram_bot_token`
  - `telegram_user_id`
- restart behavior keeps existing management endpoint flow (`/api/telegram/bot/restart`)

### 3) Telegram command interface

Implemented in:

- `backend/internal/api/telegram_bot.go`

Commands added:

- `/help`
- `/tasks [status]`
- `/task <task-id>`
- `/newtask <project-id-or-name> | <title>`
- `/move <task-id> <backlog|in_progress|in_review|done>`
- `/session <task-id> <claude|codex|terminal> [prompt]`
- `/reply <session-id> <message>`
- `/yeet <task-id> <commit message>`
- `/stomp <task-id>`

Behavior highlights:

- task/session/project refs support lookup by full id and short prefix
- command flows are connected directly to existing DB/session/git logic
- yeet/stomp semantics are aligned to repo behavior:
  - yeet: add/commit/push
  - stomp: add/amend/force-push

### 4) Non-command LLM assistant with tool calls

Implemented in:

- `backend/internal/api/telegram_bot.go`

What exists now:

- non-command Telegram messages are sent to an OpenAI-compatible `/chat/completions` endpoint
- bot supports iterative tool-calling loop (assistant -> tools -> assistant)
- tools currently implemented:
  - `list_tasks`
  - `create_task`
  - `move_task`
  - `start_session`
  - `send_session_message`
  - `yeet_task_branch`
  - `stomp_task_branch`

Config keys used:

- `telegram_llm_api_key`
- `telegram_llm_base_url`
- `telegram_llm_model`

### 5) Telegram notifications for session attention

Implemented in:

- `backend/internal/api/hooks.go`
- `backend/internal/api/sessions.go`
- `backend/internal/api/telegram_bot.go`

What happens:

- when session state transitions to `waiting_input` in key flows, bot pushes a Telegram message to configured user
- notification includes session id, task context (if available), and `/reply` usage hint

### 6) Settings UI for Telegram LLM configuration

Implemented in:

- `frontend/src/pages/settings/sections/TelegramSection.tsx`

Added fields:

- LLM API key
- LLM base URL
- LLM model

Existing save flow already restarts Telegram bot after preference updates.

### 7) Tests added

Implemented in:

- `backend/internal/api/telegram_bot_test.go`

Coverage added:

- command flow for task creation/listing
- tool-call move-task behavior
- assistant content flattening helper

## Current Validation Status

Passing:

- `cd backend && go test ./internal/api`
- `cd backend && go test ./internal/api ./internal/telegram`

Not fully passing:

- full backend suite currently has unrelated existing failure in `internal/ptyruntime` (`TestManagerStartEmitsOutputAndExit`)

Not run (environment gap):

- frontend tests were not run because `frontend/node_modules` is missing in this worktree (`vitest: not found`)

## What’s Left

### High priority

- add safety/confirmation guardrails for risky actions:
  - stomp/force-push
  - direct git mutation actions from assistant tool calls
- harden authorization boundaries:
  - make sure all Telegram action surfaces enforce configured user id
  - add explicit behavior for missing/misconfigured `telegram_user_id`
- improve error UX:
  - user-friendly error text for command failures
  - clearer guidance for ambiguous short ids

### Medium priority

- add deeper integration tests with mocked:
  - Telegram Bot API
  - OpenAI/OpenRouter-compatible LLM endpoint
- expand assistant tool surface (if needed) to include:
  - create worktree
  - task status summaries filtered by project
  - controlled task/session history retrieval
- add rate limiting / cooldown for Telegram command and assistant execution path

### Optional/next

- conversational memory per Telegram chat/thread (currently request-scoped)
- richer notifications:
  - include quick-reply hints tied to active session provider
  - aggregate notifications when multiple sessions become waiting
- optional dual-notification preference controls (web + Telegram)

## Open Questions

- should risky git actions require explicit confirmation phrase in chat?
- should `/yeet` trigger deploy variants, or remain git-only in Telegram path?
- should assistant be allowed to run all tool actions by default, or use allowlisted capabilities per user/project?
- what is the default provider/model target for Telegram LLM:
  - OpenAI
  - OpenRouter
  - model name + fallback policy
- should Telegram notify only on `waiting_input`, or also on session completion/error?

## Ideas

- add `/focus` command: show only currently active/waiting sessions across tasks
- add `/inbox` command: pending items requiring user response (sessions + workflow prompts)
- add optional “safe mode”:
  - read-only tools enabled by default
  - write tools require explicit unlock command with timeout
- add action audit messages:
  - after each tool-call mutation, send concise “what changed” summary
- add per-project Telegram aliases for shorter commands:
  - `/newtask api | title`
  - where `api` maps to a configured project id

## Brainstorm: Fixing Task/Session ID UX Pain

Problem: raw IDs are high-friction on mobile chat and error-prone under pressure.

### Option A: Human-friendly handles (recommended)

- Task handle format: `T-142` (monotonic per project or global)
- Session handle format: `S-88`
- Keep ULIDs internal; expose handles in Telegram and UI
- Add resolver in backend so all Telegram commands accept both handle and ULID

Pros:

- easiest to type/speak
- deterministic and stable
- minimal ambiguity

Tradeoff:

- requires schema + migration for handle columns/indexes

### Option B: Ephemeral aliases in chat context

- When listing tasks/sessions, show indexed aliases like:
  - `1) fix login bug`
  - `2) add bot commands`
- Commands can reference alias in follow-up:
  - `/move 2 in_review`
  - `/reply s1 please continue`

Pros:

- fastest chat UX
- no DB migration needed for first version

Tradeoff:

- alias scope/lifetime complexity
- potential confusion across concurrent conversations

### Option C: Rich picker + callback buttons

- Bot replies include inline buttons:
  - Move to In Review
  - Start Claude
  - Reply
- Telegram callback payload carries real IDs

Pros:

- near-zero typing
- avoids ID exposure entirely in common flows

Tradeoff:

- larger bot API surface and state handling complexity

### Option D: Strong fuzzy references

- Accept natural references:
  - task title contains phrase
  - latest active session in selected task
  - “current task” based on last interaction

Pros:

- natural language friendly

Tradeoff:

- ambiguity risk
- dangerous for write actions unless confirmations are strong

### Suggested phased approach

1. Ship Option B quickly for Telegram (`/tasks` and `/sessions` return short aliases).  
2. Add confirmation prompts for destructive actions when alias/fuzzy match used.  
3. Implement Option A as durable long-term model (human handles in DB).  
4. Layer Option C for top 3 high-frequency actions to minimize typing further.

## Suggested Next Implementation Slice

1. Add guardrail layer for dangerous actions (`stomp`, force-push, future delete/revert flows).  
2. Add integration tests for command and assistant tool-call loops with HTTP mocks.  
3. Finalize provider defaults + settings UX copy for OpenAI/OpenRouter setup.
