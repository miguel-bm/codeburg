package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/miguel/codeburg/internal/db"
	"github.com/miguel/codeburg/internal/worktree"
)

type Server struct {
	db       *db.DB
	router   chi.Router
	auth     *AuthService
	worktree *worktree.Manager
}

func NewServer(database *db.DB) *Server {
	s := &Server{
		db:       database,
		auth:     NewAuthService(),
		worktree: worktree.NewManager(worktree.DefaultConfig()),
	}
	s.setupRoutes()
	return s
}

func (s *Server) setupRoutes() {
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:*", "https://*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Public routes
	r.Post("/api/auth/login", s.handleLogin)
	r.Post("/api/auth/setup", s.handleSetup)
	r.Get("/api/auth/status", s.handleAuthStatus)

	// Protected routes
	r.Group(func(r chi.Router) {
		r.Use(s.authMiddleware)

		// Auth
		r.Get("/api/auth/me", s.handleMe)

		// Projects
		r.Get("/api/projects", s.handleListProjects)
		r.Post("/api/projects", s.handleCreateProject)
		r.Get("/api/projects/{id}", s.handleGetProject)
		r.Patch("/api/projects/{id}", s.handleUpdateProject)
		r.Delete("/api/projects/{id}", s.handleDeleteProject)

		// Tasks
		r.Get("/api/tasks", s.handleListTasks)
		r.Post("/api/projects/{projectId}/tasks", s.handleCreateTask)
		r.Get("/api/tasks/{id}", s.handleGetTask)
		r.Patch("/api/tasks/{id}", s.handleUpdateTask)
		r.Delete("/api/tasks/{id}", s.handleDeleteTask)

		// Worktrees
		r.Post("/api/tasks/{id}/worktree", s.handleCreateWorktree)
		r.Delete("/api/tasks/{id}/worktree", s.handleDeleteWorktree)
	})

	s.router = r
}

func (s *Server) ListenAndServe(addr string) error {
	return http.ListenAndServe(addr, s.router)
}

// Response helpers

type ErrorResponse struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, ErrorResponse{Error: message})
}

func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}
