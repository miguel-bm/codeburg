# Frontend Audit Report (2026-02-12)

## Scope
- Audited the React/TypeScript frontend at `frontend/src/`.
- Ran quality gates: `pnpm lint`, `pnpm test`, `pnpm build`.
- Reviewed architecture, hotspot files, and representative hooks/components.

## Scoring
- Confidence (1-5): likelihood this is a real issue.
- Impact (1-5): potential product/engineering impact if left unresolved.
- Ease (1-5): implementation ease (5 = easiest).

## Verification Snapshot
- `pnpm lint`: failed with 79 errors (83 total problems).
- `pnpm test`: passed (6 files, 39 tests).
- `pnpm build`: passed, but main JS chunk is very large (`dist/assets/index-LAdHZm97.js` = 3,240.45 kB, gzip 1,017.38 kB).

## Findings

### F01 - Lint gate is broken across core flows
- Category: Bugs / reliability
- Confidence: 5
- Impact: 5
- Ease: 2
- Evidence:
`src/components/dashboard/FilterMenu.tsx:74`
`src/pages/task/TaskCreate.tsx:146`
`src/pages/TaskDetail.tsx:59`
`src/components/layout/Layout.tsx:107`
`src/components/layout/Panel.tsx:133`
- Notes:
Primary rule failures are `react-hooks/refs` (32), `react-hooks/set-state-in-effect` (30), and `react-refresh/only-export-components` (7). This blocks CI-quality enforcement and indicates several React-compiler-incompatible patterns.
- Completion (next agent): [ ] Not started  [ ] In progress  [ ] Done
- Solution notes (next agent):

- Owner/PR (next agent):

### F02 - Dropdown menu pattern reads hook-ref-backed values directly in render paths
- Category: Code smell with correctness risk
- Confidence: 4
- Impact: 4
- Ease: 3
- Evidence:
`src/components/dashboard/FilterMenu.tsx:74`
`src/components/dashboard/FilterMenu.tsx:90`
`src/hooks/useDropdownMenu.ts:51`
- Notes:
This pattern is the single biggest lint hotspot (17 errors in one file) and likely to stay fragile with newer React lint/compiler rules.
- Completion (next agent): [ ] Not started  [ ] In progress  [ ] Done
- Solution notes (next agent):

- Owner/PR (next agent):

### F03 - Repeated synchronous `setState` inside effects creates render churn
- Category: Bugs / performance / maintainability
- Confidence: 5
- Impact: 4
- Ease: 2
- Evidence:
`src/pages/task/TaskCreate.tsx:146`
`src/pages/task/TaskHeader.tsx:78`
`src/pages/task/TaskDetailBacklog.tsx:71`
`src/pages/TaskDetail.tsx:59`
- Notes:
These are widespread and represent anti-patterns React now explicitly warns against. Some state should be derived during render or collapsed into reducers.
- Completion (next agent): [ ] Not started  [ ] In progress  [ ] Done
- Solution notes (next agent):

- Owner/PR (next agent):

### F04 - Tab bar touch long-press tracking mutates a non-ref local object
- Category: Bug risk
- Confidence: 4
- Impact: 3
- Ease: 4
- Evidence:
`src/components/workspace/TabBar.tsx:214`
`src/components/workspace/TabBar.tsx:220`
- Notes:
`lastTouchPos` is created as a plain object each render and then mutated in event handlers. This is fragile and flagged by `react-hooks/immutability`; a `useRef` should hold mutable gesture coordinates.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
Changed `const lastTouchPos = { current: { x: 0, y: 0 } }` to `const lastTouchPos = useRef({ x: 0, y: 0 })`. Committed in feat/redesign-soft session-tab-sync work.
- Owner/PR (next agent):

### F05 - Session cleanup swallows errors and may delete after failed stop
- Category: Bug / operational risk
- Confidence: 4
- Impact: 4
- Ease: 3
- Evidence:
`src/hooks/useTabActions.ts:35`
`src/hooks/useTabActions.ts:37`
- Notes:
Cleanup currently does `stop().finally(delete().catch(() => {}))`. This can mask backend failures and make session lifecycle debugging difficult.
- Completion (next agent): [ ] Not started  [ ] In progress  [ ] Done
- Solution notes (next agent):

- Owner/PR (next agent):

### F06 - Impure time calculation in render path
- Category: Code smell / correctness edge
- Confidence: 4
- Impact: 2
- Ease: 5
- Evidence:
`src/components/session/SessionView.tsx:76`
- Notes:
`Date.now()` in render triggers React lint purity warnings and can cause subtle hydration/render consistency issues.
- Completion (next agent): [ ] Not started  [ ] In progress  [ ] Done
- Solution notes (next agent):

- Owner/PR (next agent):

### F07 - Type safety gaps via `any` in sensitive UI paths
- Category: Code smell
- Confidence: 5
- Impact: 2
- Ease: 4
- Evidence:
`src/stores/auth.ts:89`
`src/components/workspace/FileExplorer.tsx:50`
`src/components/workspace/FileExplorer.tsx:362`
- Notes:
`any` appears around passkey response handling and tree control handlers, which weakens refactoring safety and increases runtime type risk.
- Completion (next agent): [ ] Not started  [ ] In progress  [ ] Done
- Solution notes (next agent):

- Owner/PR (next agent):

### F08 - Very large production bundle and no route-level code splitting
- Category: Performance / organization
- Confidence: 5
- Impact: 4
- Ease: 3
- Evidence:
`src/App.tsx:5`
`src/App.tsx:15`
- Notes:
All main pages are eagerly imported in `App.tsx`, and build output reports a 3.24 MB main chunk. Route/component lazy loading should reduce initial load and parse/execute time.
- Completion (next agent): [ ] Not started  [ ] In progress  [ ] Done
- Solution notes (next agent):

- Owner/PR (next agent):

### F09 - Monolithic files combine many responsibilities
- Category: Code organization
- Confidence: 5
- Impact: 4
- Ease: 2
- Evidence:
`src/pages/Settings.tsx:1`
`src/pages/Dashboard.tsx:1`
`src/components/layout/Sidebar.tsx:1`
`src/pages/task/TaskCreate.tsx:1`
- Notes:
Hotspot sizes are high (`Settings.tsx` 1265 lines, `Dashboard.tsx` 1231, `Sidebar.tsx` 940, `TaskCreate.tsx` 909), making ownership and testability harder.
- Completion (next agent): [ ] Not started  [ ] In progress  [ ] Done
- Solution notes (next agent):

- Owner/PR (next agent):

### F10 - Duplicate task-editing logic across multiple task detail components
- Category: Code smell / organization
- Confidence: 4
- Impact: 3
- Ease: 3
- Evidence:
`src/pages/task/TaskHeader.tsx:62`
`src/pages/task/TaskDetailBacklog.tsx:62`
- Notes:
Title/description editing, sync logic, and mutation handling are repeated. This increases drift risk and doubles bug-fix effort.
- Completion (next agent): [ ] Not started  [ ] In progress  [ ] Done
- Solution notes (next agent):

- Owner/PR (next agent):

### F11 - Test surface is thin relative to app size
- Category: Quality / risk
- Confidence: 4
- Impact: 4
- Ease: 3
- Evidence:
`src/` contains 148 source files and only 6 test files (`*.test.ts`/`*.test.tsx`).
- Notes:
Core complex flows (Dashboard, Sidebar, TaskCreate, session lifecycle, panel navigation) have limited direct test coverage.
- Completion (next agent): [ ] Not started  [ ] In progress  [ ] Done
- Solution notes (next agent):

- Owner/PR (next agent):

### F12 - Root README is stale and mismatched with this product
- Category: Documentation / onboarding
- Confidence: 5
- Impact: 3
- Ease: 5
- Evidence:
`README.md:1`
- Notes:
README is still the default Vite template and does not document this actual Codeburg frontend. This increases onboarding friction and setup errors.
- Completion (next agent): [ ] Not started  [ ] In progress  [ ] Done
- Solution notes (next agent):

- Owner/PR (next agent):

### F13 - Multiple independent app-wide WebSocket hooks
- Category: Architecture / efficiency
- Confidence: 3
- Impact: 2
- Ease: 3
- Evidence:
`src/hooks/useSidebarData.ts:19`
`src/hooks/useWorkspaceSessionSync.ts:93`
- Notes:
The app currently opens separate `/ws` connections for sidebar updates and workspace session sync. A shared socket layer may reduce connection overhead and duplicate subscription logic.
- Completion (next agent): [ ] Not started  [ ] In progress  [ ] Done
- Solution notes (next agent):

- Owner/PR (next agent):

### F14 - TaskDetail duplicates stop→delete session cleanup pattern
- Category: Code duplication / consistency risk
- Confidence: 5
- Impact: 3
- Ease: 3
- Evidence:
`src/pages/TaskDetail.tsx:145-174`
- Notes:
`TaskDetail` has its own `stopSessionMutation` and `deleteSessionMutation` chained via `onSuccess` (stop success triggers delete). This duplicates the cleanup logic now centralized in `useTabActions.cleanupSession`. The chained mutation pattern means if stop succeeds but delete fails, state is inconsistent. Should extract a shared `useSessionCleanup` utility or have TaskDetail use the same `cleanupSession` function.

### F15 - SessionPopout polls in background indefinitely
- Category: Performance / resource waste
- Confidence: 4
- Impact: 3
- Ease: 4
- Evidence:
`src/pages/SessionPopout.tsx:30-36`
- Notes:
Uses `refetchIntervalInBackground: true` with 5s polling. Every popout window keeps polling even when the tab is hidden and the session is completed/error (terminal states that never change). Should either stop polling when status is terminal or disable background polling.

### F16 - useNotifications manually diffs previous state via useRef
- Category: Fragility / maintainability
- Confidence: 4
- Impact: 2
- Ease: 3
- Evidence:
`src/hooks/useNotifications.ts:67-121`
- Notes:
Tracks previous waiting session IDs in a `useRef` and diffs against current to detect "newly waiting" sessions. This is the same class of ref-tracks-previous-state pattern that caused the session sync bugs. A simpler approach: have the WebSocket `sidebar_update` message carry the session ID + new status, and fire the notification directly from the WebSocket handler instead of diffing snapshots from polling.

## Agent Handoff Summary (fill after implementation)
- Completed findings IDs: F04
- Deferred findings IDs and rationale:
- High-level solution summary:
- Validation run after fixes (`lint`/`test`/`build`):
