---
name: codeburg-task
description: Create Codeburg tasks from natural-language feature requests. Use this skill only when explicitly invoked.
disable-model-invocation: true
---

# Codeburg Task Skill (Claude)

Use this skill only on explicit user invocation.

## Preconditions

- `codeburg-task` must be available in `PATH`.
- Auth must be configured with one of:
  - `CODEBURG_TOKEN`
  - `CODEBURG_PASSWORD`
- Optional: `CODEBURG_URL` (defaults to `http://127.0.0.1:8080`).

## Workflow

1. Resolve project:
   - Run `codeburg-task projects`.
   - If project selection is ambiguous, ask the user.
2. Draft concise task titles and descriptions from the requested scope.
3. Create tasks with dedupe enabled:
   - `codeburg-task create --project "<project>" --title "<title>" --description "<description>" --dedupe`
4. Return created task IDs (or deduped IDs).

## Guardrails

- Never create tasks without explicit user request.
- Keep tasks granular and directly actionable.
