---
name: codeburg-task
description: Create Codeburg tasks from natural-language feature requests. Use this skill only when the user explicitly asks to create or update tasks in Codeburg.
---

# Codeburg Task Skill (Codex)

Use this skill only when explicitly asked to create or update tasks in Codeburg.

## Preconditions

- `codeburg-task` must be available in `PATH`.
- Auth must be configured with one of:
  - `CODEBURG_TOKEN`
  - `CODEBURG_PASSWORD`
- Optional: `CODEBURG_URL` (defaults to `http://127.0.0.1:8080`).

## Workflow

1. Resolve project:
   - Run `codeburg-task projects`.
   - If project is unclear, ask the user before creating tasks.
2. Generate concise, actionable task titles and descriptions.
3. Create tasks with dedupe enabled:
   - `codeburg-task create --project "<project>" --title "<title>" --description "<description>" --dedupe`
4. Report results:
   - Include created task IDs or deduped task IDs.

## Guardrails

- Do not create tasks unless user intent is explicit.
- Prefer several small tasks over one broad task.
- Keep titles concrete and implementation-oriented.
