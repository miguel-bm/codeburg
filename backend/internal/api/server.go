package api

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/gitclone"
	"github.com/miguel-bm/codeburg/internal/portsuggest"
	"github.com/miguel-bm/codeburg/internal/telegram"
	"github.com/miguel-bm/codeburg/internal/tunnel"
	"github.com/miguel-bm/codeburg/internal/worktree"
)

// allowedOrigins defines which origins may make cross-origin requests.
// Used by both CORS middleware and WebSocket CheckOrigin.
// Starts with localhost; the configured origin is appended at startup.
var allowedOrigins = []string{
	"http://localhost:*",
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
	db                *db.DB
	router            chi.Router
	auth              *AuthService
	worktree          *worktree.Manager
	wsHub             *WSHub
	sessions          *SessionManager
	tunnels           *tunnel.Manager
	portSuggest       *portsuggest.Manager
	gitclone          gitclone.Config
	authLimiter       *loginRateLimiter
	diffStatsCache    sync.Map // taskID -> diffStatsCacheEntry
	webauthn          *webauthn.WebAuthn
	challenges        *challengeStore
	telegramBotCancel context.CancelFunc
	telegramBotMu     sync.Mutex
}

func NewServer(database *db.DB) *Server {
	wsHub := NewWSHub()
	go wsHub.Run() // Start the WebSocket hub

	authSvc := NewAuthService()

	s := &Server{
		db:          database,
		auth:        authSvc,
		worktree:    worktree.NewManager(worktree.DefaultConfig()),
		wsHub:       wsHub,
		sessions:    NewSessionManager(),
		tunnels:     tunnel.NewManager(),
		portSuggest: portsuggest.NewManager(nil),
		gitclone:    gitclone.DefaultConfig(),
		authLimiter: newLoginRateLimiter(5, 1*time.Minute),
		challenges:  newChallengeStore(),
	}

	// Initialize WebAuthn + CORS if origin is configured
	if config, err := authSvc.loadConfig(); err == nil && config.Auth.Origin != "" {
		// Add configured origin to allowed CORS origins
		allowedOrigins = append(allowedOrigins, config.Auth.Origin)

		parsed, err := url.Parse(config.Auth.Origin)
		if err == nil {
			rpID := parsed.Hostname()
			wa, err := webauthn.New(&webauthn.Config{
				RPDisplayName: "Codeburg",
				RPID:          rpID,
				RPOrigins:     []string{config.Auth.Origin},
				AuthenticatorSelection: protocol.AuthenticatorSelection{
					ResidentKey:      protocol.ResidentKeyRequirementRequired,
					UserVerification: protocol.VerificationPreferred,
				},
			})
			if err != nil {
				slog.Error("failed to initialize WebAuthn", "error", err)
			} else {
				s.webauthn = wa
				slog.Info("webauthn initialized", "rpID", rpID, "origin", config.Auth.Origin)
			}
		}
	}

	// Start Telegram bot if token preference is configured
	s.startTelegramBot()

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

	// Passkey public routes (rate-limited internally)
	r.Post("/api/auth/passkey/login/begin", s.handlePasskeyLoginBegin)
	r.Post("/api/auth/passkey/login/finish", s.handlePasskeyLoginFinish)

	// Telegram public route (rate-limited internally)
	r.Post("/api/auth/telegram", s.handleTelegramAuth)

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
		r.Post("/api/auth/password", s.handleChangePassword)

		// Passkey management (protected)
		r.Post("/api/auth/passkey/register/begin", s.handlePasskeyRegisterBegin)
		r.Post("/api/auth/passkey/register/finish", s.handlePasskeyRegisterFinish)
		r.Get("/api/auth/passkeys", s.handleListPasskeys)
		r.Patch("/api/auth/passkeys/{id}", s.handleRenamePasskey)
		r.Delete("/api/auth/passkeys/{id}", s.handleDeletePasskey)

		// Sidebar (aggregated)
		r.Get("/api/sidebar", s.handleSidebar)

		// Projects
		r.Get("/api/projects", s.handleListProjects)
		r.Post("/api/projects", s.handleCreateProject)
		r.Get("/api/projects/{id}", s.handleGetProject)
		r.Patch("/api/projects/{id}", s.handleUpdateProject)
		r.Delete("/api/projects/{id}", s.handleDeleteProject)
		r.Post("/api/projects/{id}/sync-default-branch", s.handleSyncProjectDefaultBranch)
		r.Get("/api/projects/{id}/files", s.handleListProjectFiles)
		r.Post("/api/projects/{id}/files", s.handleCreateProjectFileEntry)
		r.Get("/api/projects/{id}/file", s.handleReadProjectFile)
		r.Put("/api/projects/{id}/file", s.handlePutProjectFile)
		r.Delete("/api/projects/{id}/file", s.handleDeleteProjectFile)
		r.Post("/api/projects/{id}/file/rename", s.handleRenameProjectFile)
		r.Post("/api/projects/{id}/file/duplicate", s.handleDuplicateProjectFile)
		r.Get("/api/projects/{id}/secrets", s.handleGetProjectSecrets)
		r.Patch("/api/projects/{id}/secrets", s.handlePatchProjectSecrets)
		r.Get("/api/projects/{id}/secrets/content", s.handleGetProjectSecretContent)
		r.Put("/api/projects/{id}/secrets/content", s.handlePutProjectSecretContent)
		r.Post("/api/projects/{id}/secrets/resolve", s.handleResolveProjectSecrets)
		r.Post("/api/projects/{id}/files/search", s.handleSearchProjectFiles)

		// Project sessions
		r.Get("/api/projects/{id}/sessions", s.handleListProjectSessions)
		r.Post("/api/projects/{id}/sessions", s.handleStartProjectSession)

		// Project git
		r.Get("/api/projects/{id}/git/status", s.handleProjectGitStatus)
		r.Get("/api/projects/{id}/git/diff", s.handleProjectGitDiff)
		r.Get("/api/projects/{id}/git/diff-content", s.handleProjectGitDiffContent)
		r.Post("/api/projects/{id}/git/stage", s.handleProjectGitStage)
		r.Post("/api/projects/{id}/git/unstage", s.handleProjectGitUnstage)
		r.Post("/api/projects/{id}/git/revert", s.handleProjectGitRevert)
		r.Post("/api/projects/{id}/git/commit", s.handleProjectGitCommit)
		r.Post("/api/projects/{id}/git/pull", s.handleProjectGitPull)
		r.Post("/api/projects/{id}/git/push", s.handleProjectGitPush)
		r.Post("/api/projects/{id}/git/stash", s.handleProjectGitStash)
		r.Get("/api/projects/{id}/git/log", s.handleProjectGitLog)

		// Project tunnels
		r.Get("/api/projects/{id}/tunnels", s.handleListProjectTunnels)
		r.Post("/api/projects/{id}/tunnels", s.handleCreateProjectTunnel)

		// Branches
		r.Get("/api/projects/{id}/branches", s.handleListBranches)

		// Tasks
		r.Get("/api/tasks", s.handleListTasks)
		r.Post("/api/projects/{projectId}/tasks", s.handleCreateTask)
		r.Get("/api/tasks/{id}", s.handleGetTask)
		r.Patch("/api/tasks/{id}", s.handleUpdateTask)
		r.Delete("/api/tasks/{id}", s.handleDeleteTask)
		r.Post("/api/tasks/{id}/create-pr", s.handleCreatePR)

		// Worktrees
		r.Post("/api/tasks/{id}/worktree", s.handleCreateWorktree)
		r.Delete("/api/tasks/{id}/worktree", s.handleDeleteWorktree)

		// Task files
		r.Get("/api/tasks/{id}/files", s.handleListTaskFiles)
		r.Post("/api/tasks/{id}/files", s.handleCreateTaskFileEntry)
		r.Get("/api/tasks/{id}/file", s.handleReadTaskFile)
		r.Put("/api/tasks/{id}/file", s.handlePutTaskFile)
		r.Delete("/api/tasks/{id}/file", s.handleDeleteTaskFile)
		r.Post("/api/tasks/{id}/file/rename", s.handleRenameTaskFile)
		r.Post("/api/tasks/{id}/file/duplicate", s.handleDuplicateTaskFile)
		r.Post("/api/tasks/{id}/files/search", s.handleSearchTaskFiles)

		// Sessions
		r.Get("/api/tasks/{taskId}/sessions", s.handleListSessions)
		r.Post("/api/tasks/{taskId}/sessions", s.handleStartSession)
		r.Get("/api/sessions/{id}", s.handleGetSession)
		r.Post("/api/sessions/{id}/message", s.handleSendMessage)
		r.Post("/api/sessions/{id}/stop", s.handleStopSession)
		r.Delete("/api/sessions/{id}", s.handleDeleteSession)

		// Recipes / Justfile
		r.Get("/api/tasks/{id}/recipes", s.handleListTaskRecipes)
		r.Get("/api/projects/{id}/recipes", s.handleListProjectRecipes)
		r.Get("/api/projects/{id}/justfile", s.handleListJustRecipes)
		r.Post("/api/projects/{id}/just/{recipe}", s.handleRunJustRecipe)
		r.Get("/api/tasks/{id}/justfile", s.handleListTaskJustRecipes)
		r.Post("/api/tasks/{id}/just/{recipe}", s.handleRunJustRecipeInTask)
		r.Get("/api/tasks/{id}/just/{recipe}/stream", s.handleStreamJustRecipe)

		// Git operations
		r.Get("/api/tasks/{id}/git/status", s.handleGitStatus)
		r.Get("/api/tasks/{id}/git/diff", s.handleGitDiff)
		r.Get("/api/tasks/{id}/git/diff-content", s.handleGitDiffContent)
		r.Post("/api/tasks/{id}/git/stage", s.handleGitStage)
		r.Post("/api/tasks/{id}/git/unstage", s.handleGitUnstage)
		r.Post("/api/tasks/{id}/git/revert", s.handleGitRevert)
		r.Post("/api/tasks/{id}/git/commit", s.handleGitCommit)
		r.Post("/api/tasks/{id}/git/pull", s.handleGitPull)
		r.Post("/api/tasks/{id}/git/push", s.handleGitPush)
		r.Post("/api/tasks/{id}/git/stash", s.handleGitStash)
		r.Get("/api/tasks/{id}/git/log", s.handleGitLog)

		// Labels
		r.Get("/api/projects/{id}/labels", s.handleListLabels)
		r.Post("/api/projects/{id}/labels", s.handleCreateLabel)
		r.Delete("/api/labels/{id}", s.handleDeleteLabel)
		r.Post("/api/tasks/{id}/labels", s.handleAssignLabel)
		r.Delete("/api/tasks/{id}/labels/{labelId}", s.handleUnassignLabel)

		// Tunnels
		r.Get("/api/tasks/{id}/tunnels", s.handleListTunnels)
		r.Post("/api/tasks/{id}/tunnels", s.handleCreateTunnel)
		r.Get("/api/tasks/{id}/port-suggestions", s.handleListTaskPortSuggestions)
		r.Post("/api/tasks/{id}/ports/scan", s.handleScanTaskPorts)
		r.Delete("/api/tunnels/{id}", s.handleStopTunnel)

		// Archives
		r.Post("/api/projects/{id}/archive", s.handleArchiveProject)
		r.Get("/api/archives", s.handleListArchives)
		r.Post("/api/archives/{filename}/unarchive", s.handleUnarchiveProject)
		r.Delete("/api/archives/{filename}", s.handleDeleteArchive)

		// Telegram bot management
		r.Post("/api/telegram/bot/restart", s.handleRestartTelegramBot)

		// Preferences
		r.Get("/api/preferences/{key}", s.handleGetPreference)
		r.Put("/api/preferences/{key}", s.handleSetPreference)
		r.Delete("/api/preferences/{key}", s.handleDeletePreference)
	})

	// Serve frontend static files (SPA with index.html fallback)
	s.serveFrontend(r)

	s.router = r
}

// serveFrontend serves the built frontend from frontend/dist/.
// For SPA routing, any path that doesn't match a static file falls back to index.html.
func (s *Server) serveFrontend(r chi.Router) {
	// Look for frontend/dist relative to the working directory
	distPath := "frontend/dist"
	if _, err := os.Stat(distPath); os.IsNotExist(err) {
		// Try relative to the binary location
		exe, _ := os.Executable()
		distPath = filepath.Join(filepath.Dir(exe), "..", "frontend", "dist")
	}
	if _, err := os.Stat(distPath); os.IsNotExist(err) {
		slog.Warn("frontend dist not found, skipping static file serving", "path", distPath)
		return
	}

	absPath, _ := filepath.Abs(distPath)
	slog.Info("serving frontend", "path", absPath)
	fsys := http.Dir(absPath)

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// Try to serve the file directly
		if f, err := fsys.Open(path); err == nil {
			stat, _ := f.Stat()
			f.Close()
			if !stat.IsDir() {
				http.FileServer(fsys).ServeHTTP(w, r)
				return
			}
			// Check for index.html in directory
			if idx, err := fsys.Open(filepath.Join(path, "index.html")); err == nil {
				idx.Close()
				http.FileServer(fsys).ServeHTTP(w, r)
				return
			}
		}

		// SPA fallback: serve index.html for client-side routing
		indexPath := filepath.Join(absPath, "index.html")
		if _, err := os.Stat(indexPath); errors.Is(err, fs.ErrNotExist) {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, indexPath)
	})
}

func (s *Server) ListenAndServe(addr string) error {
	return http.ListenAndServe(addr, s.router)
}

// startTelegramBot reads the bot token from preferences and the origin from config,
// cancels any existing bot goroutine, and starts a new one if the token is set.
func (s *Server) startTelegramBot() {
	s.telegramBotMu.Lock()
	defer s.telegramBotMu.Unlock()

	// Cancel existing bot if running
	if s.telegramBotCancel != nil {
		s.telegramBotCancel()
		s.telegramBotCancel = nil
	}

	// Read bot token from preferences
	pref, err := s.db.GetPreference("default", "telegram_bot_token")
	if err != nil || pref.Value == "" {
		slog.Info("telegram bot not started: no bot token configured")
		return
	}
	token := unquotePreference(pref.Value)
	if token == "" {
		return
	}

	// Read origin from config
	config, err := s.auth.loadConfig()
	if err != nil || config.Auth.Origin == "" {
		slog.Warn("telegram bot not started: no origin configured")
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.telegramBotCancel = cancel

	bot := telegram.NewBot(token, config.Auth.Origin)
	go bot.Run(ctx)
}

func (s *Server) handleRestartTelegramBot(w http.ResponseWriter, r *http.Request) {
	s.startTelegramBot()
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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
