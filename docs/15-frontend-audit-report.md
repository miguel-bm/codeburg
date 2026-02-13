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

### Verification Snapshot Update (2026-02-13)
- `pnpm lint`: failed with 51 errors (55 total problems), down from 79 errors.
- `pnpm test`: passed (8 files, 44 tests).
- `pnpm build`: passed, bundle still large (`dist/assets/index-CWaFX7ef.js` = 3,241.70 kB, gzip 1,017.89 kB).

### Verification Snapshot Update (2026-02-13, later)
- `pnpm lint`: passed with 0 errors and 0 warnings.
- `pnpm test`: passed (8 files, 44 tests).
- `pnpm build`: passed, bundle still large (`dist/assets/index-Y7r3jiHa.js` = 3,242.04 kB, gzip 1,017.93 kB).

### Verification Snapshot Update (2026-02-13, latest)
- `pnpm lint`: passed with 0 errors and 0 warnings.
- `pnpm test`: passed (11 files, 56 tests).
- `pnpm build`: passed, bundle still large (`dist/assets/index-4ufludfM.js` = 3,245.51 kB, gzip 1,019.02 kB).

### Verification Snapshot Update (2026-02-13, latest+1)
- `pnpm lint`: passed with 0 errors and 0 warnings.
- `pnpm test`: passed (11 files, 56 tests).
- `pnpm build`: passed, bundle still large (`dist/assets/index-Ct5TRguF.js` = 3,245.58 kB, gzip 1,019.05 kB).

### Verification Snapshot Update (2026-02-13, latest+2)
- `pnpm lint`: passed with 0 errors and 0 warnings.
- `pnpm test`: passed (11 files, 56 tests).
- `pnpm build`: passed, bundle still large (`dist/assets/index-j2oxGeAz.js` = 3,247.38 kB, gzip 1,019.53 kB).

### Verification Snapshot Update (2026-02-13, latest+3)
- `pnpm lint`: passed with 0 errors and 0 warnings.
- `pnpm test`: passed (11 files, 56 tests).
- `pnpm build`: passed, bundle still large (`dist/assets/index-CmehkVhe.js` = 3,248.44 kB, gzip 1,019.88 kB).

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
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- 2026-02-13 completion:
- Refactored dropdown infrastructure (`useDropdownMenu` + `FilterMenu`) to avoid ref-backed object reads in render.
- Replaced render-time drag ref reads with explicit drag state in layout/panel transitions.
- Refactored `TaskCreate` to derive project/type/provider/branch/label state in render rather than synchronizing with setState-heavy effects.
- Refactored high-churn session/editor/workspace paths (`TaskDetail`, `TaskHeader`, `TaskDetailBacklog`, `TaskDetailInReview`, `useTerminal`, `useWebSocket`, etc.) to remove remaining `react-hooks/refs` and `react-hooks/set-state-in-effect` errors.
- Result: lint gate now passes with zero errors.

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
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- 2026-02-13: `FilterMenu` now destructures hook return values (instead of reading through a ref-containing `menu` object), and `useDropdownMenu` now resets query in close/toggle handlers rather than via close-time effect. Targeted lint for both files passes.

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
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- 2026-02-13 completion: removed `react-hooks/set-state-in-effect` error sites across task creation/details, settings/forms, workspace/diff UI, and websocket/session flows.

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
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- 2026-02-13: moved activity recency to state-driven timer updates in `SessionView` so render no longer calls `Date.now()` directly.

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
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- 2026-02-13: replaced `any` usage in auth/webworkspace paths with concrete generic or exported library types.

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
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- 2026-02-13: refactored `useTerminal` to stop mutating refs during render (moved sync to effects/callbacks, memoized actions object).

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
- Completion (next agent): [ ] Not started  [x] In progress  [ ] Done
- Solution notes (next agent):
- 2026-02-13 correction: previous "Done" status was inaccurate. Route-level lazy loading is still not implemented in `src/App.tsx`, and build output still reports a ~3.24 MB main JS chunk.
- Remaining F08 scope: introduce route-level `lazy`/`Suspense` (and optionally targeted manual chunking) to reduce initial bundle/parse cost.

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
- Completion (next agent): [ ] Not started  [x] In progress  [ ] Done
- Solution notes (next agent):
- 2026-02-13: extracted `src/pages/Settings.tsx` into focused section modules under `src/pages/settings/sections/` and reduced `Settings.tsx` from 1265 lines to 194 lines without behavior changes.
- 2026-02-13: extracted dashboard header/overlay responsibilities into `src/components/dashboard/DashboardHeaderControls.tsx` and `src/components/dashboard/DashboardOverlays.tsx`, reducing `src/pages/Dashboard.tsx` from 1230 lines to 983 lines while preserving behavior.
- 2026-02-13: extracted sidebar tree-node responsibilities into `src/components/layout/SidebarNodes.tsx`, reducing `src/components/layout/Sidebar.tsx` from 950 lines to 406 lines.
- 2026-02-13: extracted task creation form-part components into `src/pages/task/components/TaskCreateFormParts.tsx` and `src/pages/task/components/taskCreateOptions.ts`, reducing `src/pages/task/TaskCreate.tsx` from 902 lines to 490 lines.
- 2026-02-13: extracted dashboard board rendering into `src/components/dashboard/DashboardBoardContent.tsx`, reducing `src/pages/Dashboard.tsx` from 983 lines to 846 lines.
- 2026-02-13: extracted dashboard focus/URL/mobile sync into `src/pages/dashboard/useDashboardFocusSync.ts`, reducing `src/pages/Dashboard.tsx` from 846 lines to 820 lines and fixing panel-open keyboard focus drift.
- Remaining F09 scope: continue reducing `Dashboard.tsx` core size.

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
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- 2026-02-13: extracted shared title/description edit draft logic to `src/pages/task/useTaskEditorDrafts.ts` and wired both `TaskHeader` and `TaskDetailBacklog` to it, reducing duplication while preserving UX.
- 2026-02-13: added `src/pages/task/useTaskEditorDrafts.test.tsx` coverage for shared edit-draft behavior to reduce drift risk.

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
- Completion (next agent): [ ] Not started  [x] In progress  [ ] Done
- Solution notes (next agent):
- 2026-02-13: added `src/pages/task/useTaskEditorDrafts.test.tsx` (4 tests) to cover shared title/description editing flow logic.
- 2026-02-13: added `src/pages/dashboard/useDashboardFocusSync.test.tsx` (4 tests) to cover initial focus selection, URL sync, focus-forward navigation, and mobile column sync.
- 2026-02-13: added `src/lib/sessionCleanup.test.ts` (4 tests) to cover shared stop/delete session cleanup behavior.

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
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- 2026-02-13: added root `README.md` with actual Codeburg setup/runtime commands and replaced `frontend/README.md` Vite template text with frontend-specific instructions.

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
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- 2026-02-13: introduced `src/hooks/useSharedWebSocket.ts` (singleton shared `/ws` manager + hook API) and migrated both `useSidebarRealtimeUpdates` and `useWorkspaceSessionSync` to use it.
- 2026-02-13: kept terminal websocket (`/ws/terminal`) and existing `useWebSocket` hook untouched to minimize blast radius.

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
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- 2026-02-13: introduced `src/lib/sessionCleanup.ts` (`cleanupAgentSession`) and switched both `TaskDetail` and `useTabActions` to use the shared cleanup path.
- 2026-02-13: `TaskDetail` now uses one `closeSessionMutation` backed by shared cleanup instead of duplicated stop/delete mutation chaining.

### F15 - SessionPopout polls in background indefinitely
- Category: Performance / resource waste
- Confidence: 4
- Impact: 3
- Ease: 4
- Evidence:
`src/pages/SessionPopout.tsx:30-36`
- Notes:
Uses `refetchIntervalInBackground: true` with 5s polling. Every popout window keeps polling even when the tab is hidden and the session is completed/error (terminal states that never change). Should either stop polling when status is terminal or disable background polling.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- 2026-02-13: made `SessionPopout` polling interval status-aware so polling stops when session status is terminal (`completed`/`error`) while preserving active-session live refresh.

### F16 - useNotifications manually diffs previous state via useRef
- Category: Fragility / maintainability
- Confidence: 4
- Impact: 2
- Ease: 3
- Evidence:
`src/hooks/useNotifications.ts:67-121`
- Notes:
Tracks previous waiting session IDs in a `useRef` and diffs against current to detect "newly waiting" sessions. This is the same class of ref-tracks-previous-state pattern that caused the session sync bugs. A simpler approach: have the WebSocket `sidebar_update` message carry the session ID + new status, and fire the notification directly from the WebSocket handler instead of diffing snapshots from polling.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- 2026-02-13: switched notification triggering to websocket transition events (`sidebar_update` with `sessionId`/`status`) via shared websocket manager subscription.
- 2026-02-13: retained sidebar snapshot diff only as fallback when websocket is disconnected, preserving resilience if events are missed.
- 2026-02-13: added best-effort cross-tab dedupe markers for per-session waiting notifications, cleared when sessions leave waiting state.

### F17 - useTerminal mutates refs during render and trips React compiler rules
- Category: Bugs / reliability
- Confidence: 5
- Impact: 4
- Ease: 2
- Evidence:
`src/hooks/useTerminal.ts:90`
`src/hooks/useTerminal.ts:374`
`src/hooks/useTerminal.ts:384`
`src/hooks/useTerminal.ts:395`
- Notes:
Historical issue: hook previously mutated refs during render (`sessionStatusRef.current = ...` and `actions.current.* = ...` assignments), which triggered `react-hooks/refs` and risked stale closures/React compiler incompatibility.
- Completion (next agent): [ ] Not started  [ ] In progress  [x] Done
- Solution notes (next agent):
- 2026-02-13 validation update: this finding is stale after prior refactors. `useTerminal` now syncs mutable refs in effects/callback paths (not during render), and targeted lint for `src/hooks/useTerminal.ts` passes.

- Owner/PR (next agent):

## Agent Handoff Summary (fill after implementation)
- Completed findings IDs: F01, F02, F03, F04, F05, F06, F07, F10, F12, F13, F14, F15, F16, F17
- Deferred findings IDs and rationale:
- F08: still in progress; route-level lazy loading/chunking not yet implemented and bundle remains large.
- F09: still in progress; `Dashboard.tsx` remains the largest hotspot.
- F11: still in progress; coverage improved but core flows still under-tested.
- High-level solution summary:
- Continued decomposition and reliability work: split additional Dashboard responsibilities, added targeted regression tests, and centralized session cleanup logic used by both TaskDetail and workspace tab actions.
- Validation run after fixes (`lint`/`test`/`build`):
- `pnpm lint` -> pass, 0 errors, 0 warnings.
- `pnpm test` -> pass, 11 files / 56 tests.
- `pnpm build` -> pass, large chunk warning remains.
