package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gopkg.in/yaml.v3"
)

type AuthService struct {
	configPath string
	jwtSecret  []byte
}

type Config struct {
	Auth AuthConfig `yaml:"auth"`
}

type AuthConfig struct {
	PasswordHash string `yaml:"password_hash"`
}

type contextKey string

const userContextKey contextKey = "user"

func NewAuthService() *AuthService {
	home, _ := os.UserHomeDir()
	configPath := filepath.Join(home, ".codeburg", "config.yaml")

	// Generate or load JWT secret
	secretPath := filepath.Join(home, ".codeburg", ".jwt_secret")
	secret, err := os.ReadFile(secretPath)
	if err != nil {
		// Generate new secret
		secret = make([]byte, 32)
		rand.Read(secret)
		os.MkdirAll(filepath.Dir(secretPath), 0700)
		os.WriteFile(secretPath, []byte(hex.EncodeToString(secret)), 0600)
	} else {
		decoded, decErr := hex.DecodeString(strings.TrimSpace(string(secret)))
		if decErr != nil {
			slog.Warn("corrupt jwt secret file, regenerating", "error", decErr)
			decoded = make([]byte, 32)
			rand.Read(decoded)
			os.WriteFile(secretPath, []byte(hex.EncodeToString(decoded)), 0600)
		}
		secret = decoded
	}

	return &AuthService{
		configPath: configPath,
		jwtSecret:  secret,
	}
}

func (a *AuthService) loadConfig() (*Config, error) {
	data, err := os.ReadFile(a.configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return &Config{}, nil
		}
		return nil, err
	}

	var config Config
	if err := yaml.Unmarshal(data, &config); err != nil {
		return nil, err
	}
	return &config, nil
}

func (a *AuthService) saveConfig(config *Config) error {
	data, err := yaml.Marshal(config)
	if err != nil {
		return err
	}
	os.MkdirAll(filepath.Dir(a.configPath), 0755)
	return os.WriteFile(a.configPath, data, 0600)
}

func (a *AuthService) IsSetup() bool {
	config, err := a.loadConfig()
	if err != nil {
		return false
	}
	return config.Auth.PasswordHash != ""
}

func (a *AuthService) Setup(password string) error {
	if a.IsSetup() {
		return errors.New("already setup")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	config, _ := a.loadConfig()
	config.Auth.PasswordHash = string(hash)
	return a.saveConfig(config)
}

// ChangePassword hashes the new password and saves it to the config file.
func (a *AuthService) ChangePassword(newPassword string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	config, err := a.loadConfig()
	if err != nil {
		return err
	}

	config.Auth.PasswordHash = string(hash)
	return a.saveConfig(config)
}

func (a *AuthService) ValidatePassword(password string) bool {
	config, err := a.loadConfig()
	if err != nil || config.Auth.PasswordHash == "" {
		return false
	}

	err = bcrypt.CompareHashAndPassword([]byte(config.Auth.PasswordHash), []byte(password))
	return err == nil
}

func (a *AuthService) GenerateToken() (string, error) {
	claims := jwt.MapClaims{
		"sub": "user",
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(7 * 24 * time.Hour).Unix(), // 7 days
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(a.jwtSecret)
}

func (a *AuthService) ValidateToken(tokenString string) bool {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return a.jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return false
	}

	// Reject scoped tokens — they should only be accepted by ValidateHookToken
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return false
	}
	if scope, _ := claims["scope"].(string); scope != "" {
		return false
	}

	return true
}

// GenerateHookToken creates a scoped JWT that can only call the hook endpoint for a specific session.
func (a *AuthService) GenerateHookToken(sessionID string) (string, error) {
	claims := jwt.MapClaims{
		"sub":   "hook",
		"scope": "session_hook",
		"sid":   sessionID,
		"iat":   time.Now().Unix(),
		"exp":   time.Now().Add(7 * 24 * time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(a.jwtSecret)
}

// ValidateHookToken checks that a JWT is a valid scoped hook token for the given session.
func (a *AuthService) ValidateHookToken(tokenString, sessionID string) bool {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return a.jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return false
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return false
	}

	scope, _ := claims["scope"].(string)
	sid, _ := claims["sid"].(string)
	return scope == "session_hook" && sid == sessionID
}

// loginRateLimiter tracks failed auth attempts per IP.
type loginRateLimiter struct {
	mu       sync.Mutex
	attempts map[string][]time.Time // IP → timestamps of recent failures
	window   time.Duration
	max      int
}

func newLoginRateLimiter(max int, window time.Duration) *loginRateLimiter {
	return &loginRateLimiter{
		attempts: make(map[string][]time.Time),
		window:   window,
		max:      max,
	}
}

// allow returns true if the IP has not exceeded the rate limit.
func (rl *loginRateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-rl.window)

	// Prune old entries
	recent := rl.attempts[ip][:0]
	for _, t := range rl.attempts[ip] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	rl.attempts[ip] = recent

	return len(recent) < rl.max
}

// record adds a failed attempt for the IP.
func (rl *loginRateLimiter) record(ip string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	rl.attempts[ip] = append(rl.attempts[ip], time.Now())
}

// reset clears attempts for the IP (called on successful login).
func (rl *loginRateLimiter) reset(ip string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	delete(rl.attempts, ip)
}

// clientIP extracts the real client IP, checking reverse-proxy headers
// in order: CF-Connecting-IP (cloudflared), X-Forwarded-For, RemoteAddr.
func clientIP(r *http.Request) string {
	if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
		return ip
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// First entry is the original client
		if i := strings.IndexByte(xff, ','); i > 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	// Strip port from RemoteAddr
	addr := r.RemoteAddr
	if i := strings.LastIndex(addr, ":"); i > 0 {
		return addr[:i]
	}
	return addr
}

// HTTP Handlers

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth == "" {
			writeError(w, http.StatusUnauthorized, "missing authorization header")
			return
		}

		parts := strings.SplitN(auth, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			writeError(w, http.StatusUnauthorized, "invalid authorization header")
			return
		}

		if !s.auth.ValidateToken(parts[1]) {
			writeError(w, http.StatusUnauthorized, "invalid token")
			return
		}

		ctx := context.WithValue(r.Context(), userContextKey, "user")
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{
		"setup": s.auth.IsSetup(),
	})
}

func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !s.authLimiter.allow(ip) {
		writeError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}

	var input struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if input.Password == "" {
		writeError(w, http.StatusBadRequest, "password is required")
		return
	}

	if len(input.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	if err := s.auth.Setup(input.Password); err != nil {
		if err.Error() == "already setup" {
			s.authLimiter.record(ip)
			writeError(w, http.StatusConflict, "already setup")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to setup")
		return
	}

	s.authLimiter.reset(ip)

	// Generate token after setup
	token, err := s.auth.GenerateToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"token": token,
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !s.authLimiter.allow(ip) {
		writeError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}

	var input struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if !s.auth.ValidatePassword(input.Password) {
		s.authLimiter.record(ip)
		writeError(w, http.StatusUnauthorized, "invalid password")
		return
	}

	s.authLimiter.reset(ip)

	token, err := s.auth.GenerateToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"token": token,
	})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"user": "authenticated",
	})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var input struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if input.CurrentPassword == "" || input.NewPassword == "" {
		writeError(w, http.StatusBadRequest, "current and new passwords are required")
		return
	}

	if len(input.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "new password must be at least 8 characters")
		return
	}

	if !s.auth.ValidatePassword(input.CurrentPassword) {
		writeError(w, http.StatusUnauthorized, "invalid current password")
		return
	}

	if err := s.auth.ChangePassword(input.NewPassword); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to change password")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// URL parameter helper
func urlParam(r *http.Request, key string) string {
	return chi.URLParam(r, key)
}
