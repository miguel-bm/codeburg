Manual Testing Plan

  Prerequisites Check

  # Verify all tools are installed
  go version          # Should be 1.24+
  node --version      # Should be 18+
  git --version       # Should be 2.5+
  tmux -V             # Any recent version
  claude --version    # Optional - for agent features
  just --version      # Optional - for justfile features
  cloudflared --version  # Optional - for tunnel features

  1. Setup & Authentication
  ┌─────┬───────────────┬───────────────────────────────────────────────────────┬───────────────────────────────────┐
  │  #  │     Test      │                         Steps                         │             Expected              │
  ├─────┼───────────────┼───────────────────────────────────────────────────────┼───────────────────────────────────┤
  │ 1.1 │ Fresh setup   │ Delete ~/.codeburg/codeburg.db AND                    │ Shows password setup form         │
  │     │               │ ~/.codeburg/config.yaml, start server, visit          │                                   │
  │     │               │ app                                                   │                                   │
  ├─────┼───────────────┼───────────────────────────────────────────────────────┼───────────────────────────────────┤
  │ 1.2 │ Set password  │ Enter password, submit                                │ Logged in, redirected to          │
  │     │               │                                                       │ dashboard                         │
  ├─────┼───────────────┼───────────────────────────────────────────────────────┼───────────────────────────────────┤
  │ 1.3 │ Logout        │ Refresh page or clear localStorage                    │ Shows login form                  │
  ├─────┼───────────────┼───────────────────────────────────────────────────────┼───────────────────────────────────┤
  │ 1.4 │ Login         │ Enter password                                        │ Logged in successfully            │
  ├─────┼───────────────┼───────────────────────────────────────────────────────┼───────────────────────────────────┤
  │ 1.5 │ Wrong         │ Enter wrong password                                  │ Shows error message               │
  │     │ password      │                                                       │                                   │
  └─────┴───────────────┴───────────────────────────────────────────────────────┴───────────────────────────────────┘
  2. Projects
  ┌─────┬────────────────┬────────────────────────────────────────────────────────┬────────────────────────────────┐
  │  #  │      Test      │                         Steps                          │            Expected            │
  ├─────┼────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────┤
  │ 2.1 │ Create project │ Click "+ project", enter name and valid git repo path  │ Project appears in sidebar     │
  ├─────┼────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────┤
  │ 2.2 │ Invalid path   │ Create project with non-existent path                  │ Error message                  │
  ├─────┼────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────┤
  │ 2.3 │ Non-git path   │ Create project with path that's not a git repo         │ Error message                  │
  ├─────┼────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────┤
  │ 2.4 │ View project   │ Click project in sidebar                               │ Tasks filtered to that project │
  ├─────┼────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────┤
  │ 2.5 │ Delete project │ (via API for now) curl -X DELETE .../api/projects/{id} │ Project removed                │
  └─────┴────────────────┴────────────────────────────────────────────────────────┴────────────────────────────────┘
  3. Tasks & Kanban
  ┌──────┬─────────────────────┬──────────────────────────────────────┬─────────────────────────────────┐
  │  #   │        Test         │                Steps                 │            Expected             │
  ├──────┼─────────────────────┼──────────────────────────────────────┼─────────────────────────────────┤
  │ 3.1  │ Create task         │ Click "+ task", fill form, submit    │ Task appears in Backlog         │
  ├──────┼─────────────────────┼──────────────────────────────────────┼─────────────────────────────────┤
  │ 3.2  │ Drag to In Progress │ Drag task card to In Progress column │ Task moves, worktree created    │
  ├──────┼─────────────────────┼──────────────────────────────────────┼─────────────────────────────────┤
  │ 3.3  │ Check worktree      │ ls ~/.codeburg/worktrees/{project}/  │ Task folder exists              │
  ├──────┼─────────────────────┼──────────────────────────────────────┼─────────────────────────────────┤
  │ 3.4  │ Check branch        │ cd to worktree, git branch           │ On task-{id} branch             │
  ├──────┼─────────────────────┼──────────────────────────────────────┼─────────────────────────────────┤
  │ 3.5  │ Drag to Blocked     │ Drag task to Blocked                 │ Task moves                      │
  ├──────┼─────────────────────┼──────────────────────────────────────┼─────────────────────────────────┤
  │ 3.6  │ Drag to Done        │ Drag task to Done                    │ Task moves                      │
  ├──────┼─────────────────────┼──────────────────────────────────────┼─────────────────────────────────┤
  │ 3.7  │ Pin task            │ Click pin icon on task               │ Task shows pin indicator        │
  ├──────┼─────────────────────┼──────────────────────────────────────┼─────────────────────────────────┤
  │ 3.8  │ Filter by project   │ Select project in dropdown           │ Only that project's tasks shown │
  ├──────┼─────────────────────┼──────────────────────────────────────┼─────────────────────────────────┤
  │ 3.9  │ View all            │ Select "All Projects"                │ All tasks shown                 │
  ├──────┼─────────────────────┼──────────────────────────────────────┼─────────────────────────────────┤
  │ 3.10 │ Click task          │ Click on a task card                 │ Navigates to /tasks/{id}        │
  └──────┴─────────────────────┴──────────────────────────────────────┴─────────────────────────────────┘
  4. Task Detail Page
  ┌─────┬────────────────┬───────────────────────────────────┬──────────────────────────────────────────┐
  │  #  │      Test      │               Steps               │                 Expected                 │
  ├─────┼────────────────┼───────────────────────────────────┼──────────────────────────────────────────┤
  │ 4.1 │ View task info │ Navigate to task detail           │ Shows title, description, status, branch │
  ├─────┼────────────────┼───────────────────────────────────┼──────────────────────────────────────────┤
  │ 4.2 │ Back button    │ Click "< back"                    │ Returns to dashboard                     │
  ├─────┼────────────────┼───────────────────────────────────┼──────────────────────────────────────────┤
  │ 4.3 │ Tab switching  │ Click agent/justfile/tunnels tabs │ Content switches                         │
  └─────┴────────────────┴───────────────────────────────────┴──────────────────────────────────────────┘
  5. Agent Sessions (requires Claude CLI + tmux)
  ┌─────┬─────────────────┬─────────────────────────────────────────┬────────────────────────────────┐
  │  #  │      Test       │                  Steps                  │            Expected            │
  ├─────┼─────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
  │ 5.1 │ Start session   │ Click "+ session", enter prompt, submit │ Session starts, output appears │
  ├─────┼─────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
  │ 5.2 │ View output     │ Watch session view                      │ Streaming output from Claude   │
  ├─────┼─────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
  │ 5.3 │ Send message    │ Type in input, press Enter              │ Message sent, response streams │
  ├─────┼─────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
  │ 5.4 │ Session list    │ Check sidebar                           │ Session appears with status    │
  ├─────┼─────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
  │ 5.5 │ Switch sessions │ Click different session                 │ View switches                  │
  ├─────┼─────────────────┼─────────────────────────────────────────┼────────────────────────────────┤
  │ 5.6 │ Stop session    │ Click "stop" button                     │ Session stops, status updates  │
  └─────┴─────────────────┴─────────────────────────────────────────┴────────────────────────────────┘
  6. Terminal Escape Hatch (requires active session)
  ┌─────┬────────────────────┬───────────────────────────────────────┬─────────────────────────────┐
  │  #  │        Test        │                 Steps                 │          Expected           │
  ├─────┼────────────────────┼───────────────────────────────────────┼─────────────────────────────┤
  │ 6.1 │ Open terminal      │ With active session, click "terminal" │ Full-screen terminal opens  │
  ├─────┼────────────────────┼───────────────────────────────────────┼─────────────────────────────┤
  │ 6.2 │ Type in terminal   │ Type commands                         │ Input appears, output shows │
  ├─────┼────────────────────┼───────────────────────────────────────┼─────────────────────────────┤
  │ 6.3 │ Use slash commands │ Type /help in terminal                │ Claude responds to command  │
  ├─────┼────────────────────┼───────────────────────────────────────┼─────────────────────────────┤
  │ 6.4 │ Close terminal     │ Press Ctrl+Esc or click close         │ Terminal closes             │
  └─────┴────────────────────┴───────────────────────────────────────┴─────────────────────────────┘
  7. Justfile (requires just + justfile in project)
  ┌─────┬──────────────┬───────────────────────────────────────┬───────────────────────────┐
  │  #  │     Test     │                 Steps                 │         Expected          │
  ├─────┼──────────────┼───────────────────────────────────────┼───────────────────────────┤
  │ 7.1 │ View recipes │ Go to task detail, click justfile tab │ Lists available recipes   │
  ├─────┼──────────────┼───────────────────────────────────────┼───────────────────────────┤
  │ 7.2 │ Run recipe   │ Click a recipe                        │ Recipe runs, output shows │
  ├─────┼──────────────┼───────────────────────────────────────┼───────────────────────────┤
  │ 7.3 │ No justfile  │ Project without justfile              │ Shows "no justfile found" │
  └─────┴──────────────┴───────────────────────────────────────┴───────────────────────────┘
  8. Tunnels (requires cloudflared)
  ┌─────┬───────────────┬────────────────────────────────────────────────┬──────────────────────────────┐
  │  #  │     Test      │                     Steps                      │           Expected           │
  ├─────┼───────────────┼────────────────────────────────────────────────┼──────────────────────────────┤
  │ 8.1 │ Create tunnel │ Click "+ new", enter port (e.g., 3000), create │ Tunnel created, URL shown    │
  ├─────┼───────────────┼────────────────────────────────────────────────┼──────────────────────────────┤
  │ 8.2 │ Copy URL      │ Click "copy"                                   │ URL copied to clipboard      │
  ├─────┼───────────────┼────────────────────────────────────────────────┼──────────────────────────────┤
  │ 8.3 │ Test tunnel   │ Start server on port, visit tunnel URL         │ Server accessible via tunnel │
  ├─────┼───────────────┼────────────────────────────────────────────────┼──────────────────────────────┤
  │ 8.4 │ Stop tunnel   │ Click "stop"                                   │ Tunnel removed from list     │
  └─────┴───────────────┴────────────────────────────────────────────────┴──────────────────────────────┘
  9. Mobile Testing (use browser dev tools or actual phone)
  ┌─────┬───────────────────┬───────────────────────────┬───────────────────────────────┐
  │  #  │       Test        │           Steps           │           Expected            │
  ├─────┼───────────────────┼───────────────────────────┼───────────────────────────────┤
  │ 9.1 │ Responsive layout │ Resize to mobile width    │ Layout adapts, columns scroll │
  ├─────┼───────────────────┼───────────────────────────┼───────────────────────────────┤
  │ 9.2 │ Long-press menu   │ Long-press task card      │ Context menu appears          │
  ├─────┼───────────────────┼───────────────────────────┼───────────────────────────────┤
  │ 9.3 │ Move via menu     │ Select status from menu   │ Task moves to that column     │
  ├─────┼───────────────────┼───────────────────────────┼───────────────────────────────┤
  │ 9.4 │ Swipe columns     │ Swipe left/right on board │ Columns scroll horizontally   │
  └─────┴───────────────────┴───────────────────────────┴───────────────────────────────┘
  10. Worktree Edge Cases
  ┌──────┬─────────────────┬────────────────────────────────────────────────────┬────────────────────────────┐
  │  #   │      Test       │                       Steps                        │          Expected          │
  ├──────┼─────────────────┼────────────────────────────────────────────────────┼────────────────────────────┤
  │ 10.1 │ Empty repo      │ Create project with repo that has no commits       │ Error on worktree creation │
  ├──────┼─────────────────┼────────────────────────────────────────────────────┼────────────────────────────┤
  │ 10.2 │ Delete worktree │ Via API: DELETE /api/tasks/{id}/worktree           │ Worktree folder removed    │
  ├──────┼─────────────────┼────────────────────────────────────────────────────┼────────────────────────────┤
  │ 10.3 │ Symlinks        │ Configure symlinkPaths on project, create worktree │ Symlinks exist in worktree │
  └──────┴─────────────────┴────────────────────────────────────────────────────┴────────────────────────────┘
  ---
  Testing Strategy Recommendations

  Highest ROI Tests

  1. Backend API Integration Tests (Highest Value)

  These test the full HTTP request/response cycle with a real database:

  // backend/internal/api/api_test.go
  package api_test

  import (
      "encoding/json"
      "net/http"
      "net/http/httptest"
      "strings"
      "testing"

      "github.com/miguel/codeburg/internal/api"
      "github.com/miguel/codeburg/internal/db"
  )

  func setupTestServer(t *testing.T) (*api.Server, func()) {
      // Use in-memory SQLite for tests
      database, err := db.Open(":memory:")
      if err != nil {
          t.Fatal(err)
      }
      if err := database.Migrate(); err != nil {
          t.Fatal(err)
      }

      server := api.NewServer(database)
      cleanup := func() { database.Close() }
      return server, cleanup
  }

  func TestAuthFlow(t *testing.T) {
      server, cleanup := setupTestServer(t)
      defer cleanup()

      // Test setup
      t.Run("setup creates user", func(t *testing.T) {
          body := `{"password":"testpass123"}`
          req := httptest.NewRequest("POST", "/api/auth/setup", strings.NewReader(body))
          req.Header.Set("Content-Type", "application/json")
          w := httptest.NewRecorder()

          server.ServeHTTP(w, req)

          if w.Code != http.StatusOK {
              t.Errorf("expected 200, got %d", w.Code)
          }

          var resp map[string]string
          json.Unmarshal(w.Body.Bytes(), &resp)
          if resp["token"] == "" {
              t.Error("expected token in response")
          }
      })

      // Test login, create project, create task, etc.
  }

  func TestProjectCRUD(t *testing.T) {
      server, cleanup := setupTestServer(t)
      defer cleanup()
      // ... test project operations
  }

  func TestTaskStatusTransitions(t *testing.T) {
      server, cleanup := setupTestServer(t)
      defer cleanup()
      // ... test task status changes trigger worktree creation
  }

  Why highest value:
  - Tests real HTTP routing, middleware, JSON encoding
  - Tests database operations
  - Catches integration bugs between layers
  - Fast to run (in-memory SQLite)
  - Good coverage with relatively few tests

  2. Backend Unit Tests for Complex Logic (High Value)

  // backend/internal/worktree/worktree_test.go
  package worktree_test

  func TestManager_HasCommits(t *testing.T) {
      // Create temp git repo, test detection
  }

  func TestManager_BranchExists(t *testing.T) {
      // Test branch detection logic
  }

  // backend/internal/justfile/justfile_test.go
  func TestParseJustList(t *testing.T) {
      input := `Available recipes:
      build       # Build the project
      test arg1   # Run tests
      deploy`

      mgr := justfile.NewManager()
      recipes := mgr.parseJustList([]byte(input))

      if len(recipes) != 3 {
          t.Errorf("expected 3 recipes, got %d", len(recipes))
      }
      if recipes[0].Name != "build" {
          t.Errorf("expected 'build', got '%s'", recipes[0].Name)
      }
      if recipes[0].Description != "Build the project" {
          t.Errorf("wrong description")
      }
      if recipes[1].Args != "arg1" {
          t.Errorf("expected args 'arg1'")
      }
  }

  3. Frontend Component Tests (Medium Value)

  Using Vitest + React Testing Library:

  // frontend/src/components/session/SessionList.test.tsx
  import { render, screen } from '@testing-library/react';
  import { SessionList } from './SessionList';

  describe('SessionList', () => {
    it('shows empty state when no sessions', () => {
      render(<SessionList sessions={[]} onSelect={() => {}} />);
      expect(screen.getByText('// no_sessions')).toBeInTheDocument();
    });

    it('renders session items', () => {
      const sessions = [
        { id: '123', status: 'running', provider: 'claude', createdAt: new Date().toISOString() }
      ];
      render(<SessionList sessions={sessions} onSelect={() => {}} />);
      expect(screen.getByText('123...')).toBeInTheDocument();
      expect(screen.getByText('[running]')).toBeInTheDocument();
    });
  });

  Suggested Test File Structure

  backend/
  ├── internal/
  │   ├── api/
  │   │   └── api_test.go          # Integration tests for all endpoints
  │   ├── db/
  │   │   └── db_test.go           # Database operation tests
  │   ├── worktree/
  │   │   └── worktree_test.go     # Worktree logic tests
  │   ├── justfile/
  │   │   └── justfile_test.go     # Parser tests
  │   └── tunnel/
  │       └── tunnel_test.go       # Tunnel management tests

  frontend/
  ├── src/
  │   ├── components/
  │   │   └── session/
  │   │       └── SessionList.test.tsx
  │   └── api/
  │       └── client.test.ts       # API client tests (mock fetch)

  Implementation Priority

  1. Week 1: Backend API Integration Tests
    - Auth flow (setup, login, token validation)
    - Project CRUD
    - Task CRUD + status transitions
    - ~50-100 lines of test code, catches most bugs
  2. Week 2: Unit Tests for Tricky Logic
    - Justfile parser
    - Worktree creation conditions
    - ~100 lines, prevents regressions in complex code
  3. Week 3: Frontend Tests (if time)
    - Session components
    - Kanban interactions
    - Helps with refactoring confidence

  Quick Setup Commands

  # Backend tests
  cd backend
  go test ./... -v

  # Frontend tests (add vitest first)
  cd frontend
  npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
  # Add to package.json scripts: "test": "vitest"
  npm test

  The backend API integration tests give you the most confidence with the least effort - they test the actual
  user-facing behavior through the API contract.