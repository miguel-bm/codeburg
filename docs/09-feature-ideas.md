Feature 1: Browser notifications + favicon badge
- New file: frontend/src/hooks/useNotifications.ts
- Requests browser notification permission on mount
- Draws a dynamic favicon with amber count badge when sessions are waiting
- Updates document title with [N] prefix
- Fires Notification API when new waiting sessions appear
- Wired into AppShell in App.tsx

Feature 2: Cmd+K quick switcher

- New file: frontend/src/components/common/CommandPalette.tsx
- Global Cmd+K / Ctrl+K keybinding
- Searches across projects, tasks, sessions, and actions
- Arrow keys + Enter to navigate, Escape to close
- Wired into AppShell in App.tsx

Feature 3: Right-click context menu on sidebar tasks

- Added onContextMenu to SidebarTaskNode in Sidebar.tsx
- Menu options: open task, copy branch name, open PR, move to review/done
- Keyboard escape to dismiss

Feature 4: Double-click drag handle to reset width

- Added onDoubleClick to the drag handle in Layout.tsx
- Resets sidebar to SIDEBAR_DEFAULT (288px) and persists to localStorage

Feature 5: PR link for in_review tasks

- Backend: Migration v7 adds pr_url TEXT to tasks table
- Updated Task struct, UpdateTaskInput, scanTask, UpdateTask query in Go
- Updated SidebarTask in sidebar.go to include prUrl
- Frontend: Added prUrl to Task, UpdateTaskInput, and SidebarTask types
- Sidebar shows clickable "PR" link for in_review tasks with a PR URL
- Context menu also has "open PR" option

Feature 6: Session waiting count in header

- CODEBURG [N] shown when N > 0 waiting sessions
- Amber pulsing text matches the design system

Feature 7: Collapse all / expand all toggle

- Chevron button in sidebar header toggles all project nodes
- Persists collapse state per project to localStorage
- Uses signal pattern to notify child components