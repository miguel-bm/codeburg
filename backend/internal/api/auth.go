package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
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
		secret, _ = hex.DecodeString(string(secret))
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

	return err == nil && token.Valid
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
			writeError(w, http.StatusConflict, "already setup")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to setup")
		return
	}

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
	var input struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if !s.auth.ValidatePassword(input.Password) {
		writeError(w, http.StatusUnauthorized, "invalid password")
		return
	}

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

// URL parameter helper
func urlParam(r *http.Request, key string) string {
	return chi.URLParam(r, key)
}
