# Skills and Plugin Models (Claude + Codex)

Date: February 14, 2026

## Why this doc exists

Codeburg already runs Claude and Codex sessions in task worktrees. Both ecosystems now have "skills" concepts, but their extension models are different enough that we need a clear architecture before building a skill manager.

This doc summarizes:

- how Claude and Codex extension models differ
- what Codeburg can support quickly vs later
- concrete options for a Codeburg skill manager

## Terminology

- Skill: Reusable instruction package focused on task execution context and workflow.
- Plugin: Broader package model that may include skills plus other components.
- Bundle: Proposed Codeburg abstraction for installable skill/plugin source and resolved files.

## Claude model (plugin-first)

Claude Code supports a richer plugin model where skills are one component among others. Depending on plugin contents, a package can include:

- skills
- commands
- agents
- hooks
- metadata/config for behavior and invocation

Implication for Codeburg:

- "Claude plugin support" is larger than "Claude skills support."
- Some plugin components (especially hooks/commands) are operational features with security and merge-policy impact.

## Codex model (skills-first)

Codex supports a leaner skills model. In practice, skills are directory-based instruction artifacts (centered around `SKILL.md`, with optional support files/scripts). Discovery/loading is path-based and simpler than Claude's plugin composition.

Implication for Codeburg:

- Codex integration can be shipped with lower complexity.
- There is no 1:1 equivalent for every Claude plugin component (notably commands/agents/hooks as first-class plugin primitives).

## Direct comparison

1. Scope
- Claude: plugin surface that can orchestrate commands/agents/hooks/skills.
- Codex: focused skills surface.

2. Runtime coupling
- Claude plugin pieces can affect lifecycle behavior and event handling.
- Codex skills mostly shape task execution behavior through instructions/assets.

3. Portability
- Claude plugin content is only partially portable to Codex.
- Skill text/assets may transfer; command/agent/hook semantics often do not.

## What Codeburg already has

Codeburg has strong extension insertion points today:

1. Provider command assembly:
- `backend/internal/api/sessions_command.go`
- Claude and Codex startup args are centralized.

2. Claude hook wiring:
- `backend/internal/api/sessions.go`
- writes/merges `.claude/settings.local.json` and keeps Codeburg callback hooks attached.

3. Codex notify wiring:
- `backend/internal/api/sessions.go`
- writes per-session notify script and injects it into Codex launch config.

4. Unified hook ingestion:
- `backend/internal/api/hooks.go`
- normalizes provider callback events into Codeburg session lifecycle transitions.

This means skill/plugin installation can be added before provider process launch without redesigning PTY/session core.

## Skill manager options for Codeburg

## Option A: Installer passthrough (fastest)

Approach:

- Store plugin/skill sources at project/task scope.
- Run provider-native install flows before session start.

Examples:

- Claude: plugin add/install commands against provider CLI.
- Codex: materialize skill dirs in expected local paths.

Pros:

- fast to ship
- supports public plugin repos quickly

Cons:

- limited governance
- weaker reproducibility unless refs are pinned
- lower portability abstraction

## Option B: Unified bundle manager (recommended MVP)

Approach:

- Add a provider-agnostic "bundle" model in Codeburg.
- Resolve source at pinned ref into local cache (for example under `~/.codeburg/skills-cache`).
- Materialize provider-specific views into worktree:
  - Claude skills location
  - Codex skills location
- Keep Codeburg-owned hooks lifecycle separate from imported bundles.

Pros:

- good UX
- deterministic installs
- strong base for policy and updates

Cons:

- more backend/frontend work than passthrough

## Option C: Full plugin platform

Approach:

- Parse and manage full Claude plugin component graph (skills, commands, agents, hooks).
- Add policy engine and merge rules for settings/hook composition.
- Offer capability toggles by project/user/team.

Pros:

- maximum power, closest to Claude-native plugin feature depth

Cons:

- largest scope
- highest security/reliability burden

## Option D: Curated packs only

Approach:

- Ship vetted skill/plugin packs controlled by Codeburg.
- Optionally disable arbitrary URL install.

Pros:

- safest operational posture

Cons:

- slower ecosystem adoption
- less flexibility

## Recommended phased rollout

1. Phase 1
- ship Option B core for skills
- support bundle add/list/remove/update
- support pinning refs and checksums

2. Phase 2
- add optional Claude plugin passthrough for advanced users
- clearly mark Claude-only components in UI

3. Phase 3
- evaluate demand for full plugin platform (Option C)
- implement only high-value components first (likely commands + selected agents)

## Security and policy requirements

Any skill manager should enforce:

1. Source control
- pin git ref/commit
- record provenance and installed digest

2. Scope
- user-level enable/disable
- project-level and task-level binding
- provider compatibility filter

3. Execution policy
- explicit trust prompt for scripts/hooks
- optional allowlist domains and signed packs

4. Observability
- install/update audit log
- per-session list of active bundles

## Proposed API sketch

Possible backend endpoints:

- `GET /api/skills/bundles`
- `POST /api/skills/bundles` `{ source, ref?, providerHints? }`
- `POST /api/skills/bundles/:id/sync`
- `DELETE /api/skills/bundles/:id`
- `GET /api/projects/:id/skills`
- `PUT /api/projects/:id/skills` `{ bundleIds: [] }`
- `GET /api/tasks/:id/skills`
- `PUT /api/tasks/:id/skills` `{ bundleIds: [] }`

## Proposed data model sketch

- `skill_bundles`
  - id, source_url, source_type, pinned_ref, resolved_commit, manifest, created_at
- `skill_bundle_versions`
  - id, bundle_id, digest, local_cache_path, installed_at
- `project_skill_bindings`
  - id, project_id, bundle_id, enabled
- `task_skill_bindings`
  - id, task_id, bundle_id, enabled

## UI shape

1. Global settings
- "Skills and Plugins" page for source management and trust settings

2. Project settings
- enable/disable bundles for this project

3. Task detail
- optional task overrides
- show active bundles on session launch card

4. Session view
- show immutable snapshot: provider + active bundles + refs

## Open questions

1. Should task-level overrides be allowed by default or behind admin toggle?
2. Should hook/script-bearing bundles require per-project approval?
3. Should remote sources sync automatically on startup or only manually?
4. How strict should offline behavior be when source fetch fails?

## Sources

- Claude skills/plugins docs:
  - https://code.claude.com/docs/en/plugins-reference#skills
  - https://docs.claude.com/en/docs/claude-code/plugins-reference
  - https://docs.claude.com/en/docs/claude-code/skills
- Codex skills docs:
  - https://developers.openai.com/codex/skills
  - https://github.com/openai/skills
