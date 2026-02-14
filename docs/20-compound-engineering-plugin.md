# Compound Engineering Plugin Deep Dive

Date: February 14, 2026

## Summary

`compound-engineering-plugin` is a workflow system for AI-assisted software delivery. It is not only a skill library; it bundles commands, specialist agent roles, and practices for creating durable engineering knowledge in-repo.

At a high level it enables:

- guided workflows (`brainstorm`, `plan`, `work`, `review`, `compound`)
- parallel multi-agent reviews with severity triage
- persistent output artifacts (plans, solutions, todos, project memory)
- optional high-autonomy "one command" execution paths

## Mental model

Think of Compound as an opinionated loop:

1. Frame the problem
2. Generate and harden a plan
3. Implement changes
4. Review with specialist agents
5. Triage and resolve
6. Persist lessons back into project memory

The last step ("compound") is core: each cycle is supposed to improve future cycles.

## What it includes

Depending on version, the repository/plugin includes combinations of:

- workflow commands
- utility commands (triage, TODO resolution, PR resolution, etc.)
- specialist agents (security, performance, architecture, domain-specific reviewers)
- skills and references
- setup and conversion tooling

The exact command/agent counts can change by release.

## Core workflows and what they do

## `workflows:brainstorm`

Purpose:

- clarify problem and constraints before coding

Typical outputs:

- assumptions
- alternatives
- risk areas
- explicit success criteria

## `workflows:plan`

Purpose:

- produce implementable stepwise plan with scope boundaries

Typical outputs:

- milestones
- dependency order
- verification plan

## `workflows:work`

Purpose:

- execute implementation against approved plan

Typical behavior:

- make code changes
- run checks/tests
- keep progress tied to plan steps

## `workflows:review`

Purpose:

- run broad/specialist review passes, often parallel

Typical outputs:

- prioritized findings (commonly P1/P2/P3 style)
- bug, security, architecture, and quality observations

## `workflows:compound`

Purpose:

- write long-lived knowledge from the completed work

Typical outputs:

- distilled lessons/patterns
- updates to project instructions or solution docs
- reduced repeated mistakes over time

## Common utility flows

Examples called out by the plugin docs/readme include:

- `/triage`
- `/resolve_todo_parallel`
- `/resolve_pr_parallel`
- `/deepen-plan`
- `/lfg` (high-autonomy chain)

`/lfg` is effectively a composed pipeline that runs planning, implementation, review, resolution, verification, and compounding with less human intervention.

## Artifact strategy (how knowledge compounds)

Compound emphasizes writing reusable artifacts into the repo. Typical structure patterns include:

- `docs/brainstorms/`
- `docs/plans/`
- `docs/solutions/`
- `todos/`
- `CLAUDE.md` (project memory/instructions)

This artifact discipline is what makes the "compound" name meaningful.

## How teams are supposed to use it

## Practical default cadence

1. Brainstorm major feature or uncertain bug
2. Produce plan and tighten it (`/deepen-plan` when needed)
3. Execute work
4. Run review
5. Triage findings and resolve in parallel
6. Compound learnings into durable docs

## Suggested guardrails

- keep merge approval human-controlled
- require tests/checks before merge
- use high-autonomy commands only after repo/process maturity

## Why it can be effective

1. Consistent process language
- same workflow verbs across tasks and contributors

2. Specialized review parallelism
- catches more classes of issues than single-pass review

3. Knowledge retention
- insights survive beyond one chat/session

4. Reduced prompt churn
- reusable commands/skills prevent re-explaining process each time

## Limitations and caveats

1. Claude-first model
- many capabilities rely on Claude plugin primitives

2. Portability gaps
- not all plugin components map to Codex skills semantics

3. Version churn
- command lists and packaging can change between releases

4. Operational risk if over-automated
- one-shot autonomy without strong tests/policies can amplify errors

5. Tooling integration gotchas
- docs mention Context7 MCP caveats requiring manual config in some setups

## How this maps to Codeburg

## What works immediately

- Claude session users can adopt Compound workflow conventions and artifacts.
- Codeburg session lifecycle already supports Claude hooks and Codex notify callbacks.

## What needs platform work

- managing plugin installation/update status in UI
- pinning versions and tracking provenance
- showing active command/skill packs per session
- provider compatibility warnings for Claude-only components

## Expected portability to Codex in Codeburg

Good candidates:

- textual skills/instructions
- templates and docs

Weak candidates:

- Claude-specific command/agent/hook behavior that requires plugin runtime semantics

## Recommended adoption path for Codeburg users

1. Start with process, not automation
- use brainstorm/plan/work/review/compound sequence manually

2. Add artifact discipline
- enforce plan/solution docs and TODO triage output

3. Introduce selective automation
- adopt utility commands where checks are strong

4. Gate high-autonomy mode
- only enable `/lfg` style flows when test coverage, rollback, and review gates are mature

## Example playbook for a feature

1. Run brainstorm for scope and unknowns
2. Create implementation plan and acceptance checks
3. Execute changes
4. Run specialist review
5. Triage findings, resolve parallelizable items
6. Re-run checks/tests
7. Write compounding artifact (solution + lessons + reusable patterns)

## Notes for maintainers

- Treat this plugin as a moving target; pin refs when integrating.
- Capture plugin version in task/session metadata for reproducibility.
- Separate "workflow conventions" from "provider-specific plugin mechanics" in docs and UI.

## Sources

- Repository:
  - https://github.com/EveryInc/compound-engineering-plugin
- Plugin README (raw):
  - https://raw.githubusercontent.com/EveryInc/compound-engineering-plugin/main/plugins/compound-engineering/README.md
- Overview article:
  - https://every.to/guides/compound-engineering
- Releases:
  - https://github.com/EveryInc/compound-engineering-plugin/releases
