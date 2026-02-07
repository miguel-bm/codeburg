package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/miguel/codeburg/internal/db"
	"github.com/miguel/codeburg/internal/gitclone"
	"github.com/miguel/codeburg/internal/tunnel"
	"github.com/miguel/codeburg/internal/worktree"
)

// allowedOrigins defines which origins may make cross-origin requests.
// Used by both CORS middleware and WebSocket CheckOrigin.
var allowedOrigins = []string{
	"http://localhost:*",
	"https://codeburg.miscellanics.com",
}

// isAllowedOrigin checks whether an origin matches the allowedOrigins list.
// Supports the "http://localhost:*" wildcard pattern (any port on localhost).
func isAllowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	for _, allowed := range allowedOrigins {
		if allowed == origin {
			return true
		}
		// Handle "http://localhost:*" — match any port on localhost.
		if strings.HasSuffix(allowed, ":*") {
			prefix := strings.TrimSuffix(allowed, ":*")
			parsed, err := url.Parse(origin)
			if err != nil {
				continue
			}
			// Rebuild without port to compare scheme+host.
			withoutPort := parsed.Scheme + "://" + parsed.Hostname()
			if withoutPort == prefix {
				return true
			}
		}
	}
	return false
}

type Server struct {
	db          *db.DB
	router      chi.Router
	auth        *AuthService
	worktree    *worktree.Manager
	wsHub       *WSHub
	sessions    *SessionManager
	tunnels     *tunnel.Manager
	gitclone    gitclone.Config
	authLimiter *loginRateLimiter
}

func NewServer(database *db.DB) *Server {
	wsHub := NewWSHub()
	go wsHub.Run() // Start the WebSocket hub

	s := &Server{
		db:          database,
		auth:        NewAuthService(),
		worktree:    worktree.NewManager(worktree.DefaultConfig()),
		wsHub:       wsHub,
		sessions:    NewSessionManager(),
		tunnels:     tunnel.NewManager(),
		gitclone:    gitclone.DefaultConfig(),
		authLimiter: newLoginRateLimiter(5, 1*time.Minute),
	}

	// Restore sessions that survived a server restart
	s.sessions.Reconcile(database)

	// Start background cleanup of zombie sessions
	go s.sessions.StartCleanupLoop(database, wsHub)

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
		AllowedOrigins:   allowedOrigins,
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

	// WebSocket (public, auth handled in handshake)
	r.Get("/ws", s.handleWebSocket)
	r.Get("/ws/terminal", s.handleTerminalWS)

	// Hook endpoint (auth handled inline — accepts scoped hook tokens or full JWTs)
	r.Post("/api/sessions/{id}/hook", s.handleSessionHook)

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

		// Sessions
		r.Get("/api/tasks/{taskId}/sessions", s.handleListSessions)
		r.Post("/api/tasks/{taskId}/sessions", s.handleStartSession)
		r.Get("/api/sessions/{id}", s.handleGetSession)
		r.Post("/api/sessions/{id}/message", s.handleSendMessage)
		r.Delete("/api/sessions/{id}", s.handleStopSession)

		// Justfile
		r.Get("/api/projects/{id}/justfile", s.handleListJustRecipes)
		r.Post("/api/projects/{id}/just/{recipe}", s.handleRunJustRecipe)
		r.Get("/api/tasks/{id}/justfile", s.handleListTaskJustRecipes)
		r.Post("/api/tasks/{id}/just/{recipe}", s.handleRunJustRecipeInTask)
		r.Get("/api/tasks/{id}/just/{recipe}/stream", s.handleStreamJustRecipe)

		// Tunnels
		r.Get("/api/tasks/{id}/tunnels", s.handleListTunnels)
		r.Post("/api/tasks/{id}/tunnels", s.handleCreateTunnel)
		r.Delete("/api/tunnels/{id}", s.handleStopTunnel)
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

func writeDBError(w http.ResponseWriter, err error, entity string) {
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, entity+" not found")
	} else {
		writeError(w, http.StatusInternalServerError, "failed to get "+entity)
	}
}

func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}
