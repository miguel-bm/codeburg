package api

import (
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/miguel-bm/codeburg/internal/db"
)

// Sidebar response types

type SidebarResponse struct {
	Projects []SidebarProject `json:"projects"`
}

type SidebarProject struct {
	ID    string        `json:"id"`
	Name  string        `json:"name"`
	Tasks []SidebarTask `json:"tasks"`
}

type SidebarTask struct {
	ID        string          `json:"id"`
	Title     string          `json:"title"`
	Status    db.TaskStatus   `json:"status"`
	Branch    *string         `json:"branch,omitempty"`
	PRURL     *string         `json:"prUrl,omitempty"`
	DiffStats *DiffStats      `json:"diffStats,omitempty"`
	Sessions  []SidebarSession `json:"sessions"`
}

type DiffStats struct {
	Additions int `json:"additions"`
	Deletions int `json:"deletions"`
}

type SidebarSession struct {
	ID       string           `json:"id"`
	Provider string           `json:"provider"`
	Status   db.SessionStatus `json:"status"`
	Number   int              `json:"number"`
}

// diffStatsCache is an in-memory cache for diff stats with TTL
type diffStatsCacheEntry struct {
	stats     *DiffStats
	expiresAt time.Time
}

// getCachedDiffStats returns cached diff stats for a task, computing if expired/missing.
// Returns nil on error (non-fatal).
func (s *Server) getCachedDiffStats(task *db.Task) *DiffStats {
	if task.WorktreePath == nil || *task.WorktreePath == "" {
		return nil
	}

	// Check cache
	if cached, ok := s.diffStatsCache.Load(task.ID); ok {
		entry := cached.(diffStatsCacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.stats
		}
	}

	// Compute
	proj, err := s.db.GetProject(task.ProjectID)
	if err != nil {
		return nil
	}

	additions, deletions, err := s.worktree.DiffStats(*task.WorktreePath, proj.DefaultBranch)
	if err != nil {
		slog.Debug("diff stats failed", "task_id", task.ID, "error", err)
		return nil
	}

	stats := &DiffStats{Additions: additions, Deletions: deletions}
	s.diffStatsCache.Store(task.ID, diffStatsCacheEntry{
		stats:     stats,
		expiresAt: time.Now().Add(30 * time.Second),
	})
	return stats
}

// handleSidebar returns aggregated sidebar data
func (s *Server) handleSidebar(w http.ResponseWriter, r *http.Request) {
	// 1. Load all projects
	projects, err := s.db.ListProjects()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list projects")
		return
	}

	// 2. Load tasks with status in (in_progress, in_review)
	tasks, err := s.db.ListTasks(db.TaskFilter{
		Statuses: []db.TaskStatus{db.TaskStatusInProgress, db.TaskStatusInReview},
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list tasks")
		return
	}

	// 3. Load all active sessions
	sessions, err := s.db.ListActiveSessions()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list sessions")
		return
	}

	// Build lookup maps
	sessionsByTask := make(map[string][]*db.AgentSession)
	for _, sess := range sessions {
		// Filter: only non-terminal sessions
		if sess.Provider == "terminal" {
			continue
		}
		sessionsByTask[sess.TaskID] = append(sessionsByTask[sess.TaskID], sess)
	}

	tasksByProject := make(map[string][]*db.Task)
	for _, t := range tasks {
		tasksByProject[t.ProjectID] = append(tasksByProject[t.ProjectID], t)
	}

	// Build project map for default branch lookup
	projectMap := make(map[string]*db.Project)
	for _, p := range projects {
		projectMap[p.ID] = p
	}

	// 4. Compute diff stats concurrently with bounded concurrency
	type diffResult struct {
		taskID string
		stats  *DiffStats
	}

	var diffWg sync.WaitGroup
	diffCh := make(chan diffResult, len(tasks))
	sem := make(chan struct{}, 5) // max 5 concurrent

	for _, t := range tasks {
		if t.WorktreePath == nil {
			continue
		}

		// Check cache first
		if cached, ok := s.diffStatsCache.Load(t.ID); ok {
			entry := cached.(diffStatsCacheEntry)
			if time.Now().Before(entry.expiresAt) {
				diffCh <- diffResult{taskID: t.ID, stats: entry.stats}
				continue
			}
		}

		diffWg.Add(1)
		go func(task *db.Task) {
			defer diffWg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			proj := projectMap[task.ProjectID]
			if proj == nil {
				return
			}

			additions, deletions, err := s.worktree.DiffStats(*task.WorktreePath, proj.DefaultBranch)
			if err != nil {
				slog.Debug("diff stats failed", "task_id", task.ID, "error", err)
				return
			}

			stats := &DiffStats{Additions: additions, Deletions: deletions}
			// Cache for 30 seconds
			s.diffStatsCache.Store(task.ID, diffStatsCacheEntry{
				stats:     stats,
				expiresAt: time.Now().Add(30 * time.Second),
			})
			diffCh <- diffResult{taskID: task.ID, stats: stats}
		}(t)
	}

	// Wait for all goroutines, then close channel
	go func() {
		diffWg.Wait()
		close(diffCh)
	}()

	diffStatsMap := make(map[string]*DiffStats)
	for res := range diffCh {
		diffStatsMap[res.taskID] = res.stats
	}

	// 5. Assemble response
	var resp SidebarResponse
	for _, p := range projects {
		sp := SidebarProject{
			ID:    p.ID,
			Name:  p.Name,
			Tasks: make([]SidebarTask, 0),
		}

		for _, t := range tasksByProject[p.ID] {
			st := SidebarTask{
				ID:        t.ID,
				Title:     t.Title,
				Status:    t.Status,
				Branch:    t.Branch,
				PRURL:     t.PRURL,
				DiffStats: diffStatsMap[t.ID],
				Sessions:  make([]SidebarSession, 0),
			}

			// Number sessions sequentially per task (by creation order)
			taskSessions := sessionsByTask[t.ID]
			for i, sess := range taskSessions {
				st.Sessions = append(st.Sessions, SidebarSession{
					ID:       sess.ID,
					Provider: sess.Provider,
					Status:   sess.Status,
					Number:   i + 1,
				})
			}

			sp.Tasks = append(sp.Tasks, st)
		}

		resp.Projects = append(resp.Projects, sp)
	}

	writeJSON(w, http.StatusOK, resp)
}
