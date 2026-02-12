# Kanban & Task Creation — Code Review

Review of `Dashboard.tsx` (~2,700 lines) and `TaskCreate.tsx` (~930 lines).

## Code Smells

### 1. Dashboard.tsx is massive
The main `Dashboard` component is ~1,200 lines mixing drag-and-drop, keyboard navigation, focus management, and filter logic. Extract custom hooks:
- `useDragAndDrop()` — custom drag system (~150 lines)
- `useKanbanFocus()` — bidirectional focus/keyboard nav with URL sync (~200 lines)
- `useDashboardFilters()` — filter state derived from URL params

### 2. SingleSelectFilterMenu / MultiSelectFilterMenu are ~80% identical
Same outside-click handlers, escape handling, search input, positioning. A shared `BaseFilterMenu` with render props would cut ~170 lines of duplication.

### 3. Dropdown logic duplicated across files
`ProjectSearchSelect` and `LabelPicker` in TaskCreate.tsx both implement their own outside-click detection, escape handling, and query state. A `useDropdown()` hook would consolidate this.

### 4. Utility duplication
- `slugifySegment()` in TaskCreate has equivalents elsewhere
- `DEFAULT_LABEL_COLORS` defined in multiple files
- Belong in shared utils/constants

## Potential Bugs

### 1. Session prompt preview doesn't match what's sent
Preview uses `useMemo(() => buildSessionPrompt(title, description))` but mutation calls `buildSessionPrompt(trimmedTitle, trimmedDescription)`. Should use the memoized value in the mutation.

### 2. Branch dirty state survives project changes
Custom branch persists when switching projects. Should reset `branchDirty` on project change.

### 3. Drag position logic inconsistency
Cross-column drops use `colTasks.length` as fallback position value instead of calculating proper position. Could cause ordering issues with gaps in position values.

### 4. No throttling on drag mousemove
`calcDropTarget` iterates all column and card refs on every mousemove. On boards with many cards, this could jank. A `requestAnimationFrame` wrapper would help.

## UX Improvements

### 1. No undo for drag operations
Accidentally dropping a task in the wrong column has no revert. A toast with "Undo" would add confidence.

### 2. ProjectSearchSelect has no keyboard navigation
Can't arrow through options, only click. The existing `Select.tsx` component has full arrow key support; this should match.

### 3. No success feedback on task creation
Just navigates to task detail after creating. A brief toast confirming creation would help.

### 4. Branch name validation missing
No feedback if branch name would be invalid for git (starts with `-`, contains `..`, etc.).

### 5. Keyboard shortcuts not discoverable
Enter to submit in title field and Cmd+Enter in description aren't documented in UI.

## Accessibility

- Filter menus, project select, and context menus lack proper ARIA roles (`role="combobox"`, `role="menu"`, `role="menuitem"`)
- `ProjectSearchSelect` dropdown uses absolute positioning without portal — can get clipped by overflow containers
- Focus not returned to trigger button after selecting/closing dropdown
- Priority colors may not meet WCAG contrast minimums

## Feature Ideas

- **Bulk operations** — multi-select cards to move/archive/label several tasks at once
- **Saved filter presets** — save common filter combinations (e.g., "My bugs", "High priority features")
- **Remember last-used priority/type** — default to what user picked last time instead of always "feature" + "none"
