package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

type telegramUser struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Username  string `json:"username"`
}

// validateTelegramInitData validates Telegram Web App initData per
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// Returns the raw data map on success.
func validateTelegramInitData(botToken, initData string) (url.Values, error) {
	values, err := url.ParseQuery(initData)
	if err != nil {
		return nil, fmt.Errorf("invalid initData format")
	}

	hash := values.Get("hash")
	if hash == "" {
		return nil, fmt.Errorf("missing hash")
	}

	// Build data-check-string: sort all key=value pairs except "hash", join with \n
	var pairs []string
	for k, vs := range values {
		if k == "hash" {
			continue
		}
		for _, v := range vs {
			pairs = append(pairs, k+"="+v)
		}
	}
	sort.Strings(pairs)
	dataCheckString := strings.Join(pairs, "\n")

	// HMAC-SHA256(secret_key, data_check_string) where secret_key = HMAC-SHA256("WebAppData", bot_token)
	secretKey := hmacSHA256([]byte("WebAppData"), []byte(botToken))
	computed := hmacSHA256(secretKey, []byte(dataCheckString))
	computedHex := hex.EncodeToString(computed)

	if !hmac.Equal([]byte(computedHex), []byte(hash)) {
		return nil, fmt.Errorf("invalid hash")
	}

	// Check auth_date for replay window (5 minutes)
	authDateStr := values.Get("auth_date")
	if authDateStr == "" {
		return nil, fmt.Errorf("missing auth_date")
	}
	var authDate int64
	fmt.Sscanf(authDateStr, "%d", &authDate)
	if time.Now().Unix()-authDate > 300 {
		return nil, fmt.Errorf("initData expired")
	}

	return values, nil
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}

// unquotePreference strips JSON string quotes from a preference value.
// The preferences API stores raw JSON, so a string value "foo" is stored as `"foo"` in the DB.
func unquotePreference(value string) string {
	var s string
	if err := json.Unmarshal([]byte(value), &s); err == nil {
		return s
	}
	return value
}

func (s *Server) handleTelegramAuth(w http.ResponseWriter, r *http.Request) {
	pref, err := s.db.GetPreference("default", "telegram_bot_token")
	if err != nil || pref.Value == "" {
		writeError(w, http.StatusNotFound, "telegram auth not configured")
		return
	}
	botToken := unquotePreference(pref.Value)
	if botToken == "" {
		writeError(w, http.StatusNotFound, "telegram auth not configured")
		return
	}

	ip := clientIP(r)
	if !s.authLimiter.allow(ip) {
		writeError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}

	var input struct {
		InitData string `json:"initData"`
	}
	if err := decodeJSON(r, &input); err != nil || input.InitData == "" {
		s.authLimiter.record(ip)
		writeError(w, http.StatusBadRequest, "initData is required")
		return
	}

	values, err := validateTelegramInitData(botToken, input.InitData)
	if err != nil {
		s.authLimiter.record(ip)
		slog.Warn("telegram auth validation failed", "error", err)
		writeError(w, http.StatusUnauthorized, "invalid telegram data")
		return
	}

	// Extract user ID from the validated data
	userJSON := values.Get("user")
	if userJSON == "" {
		s.authLimiter.record(ip)
		writeError(w, http.StatusUnauthorized, "no user in telegram data")
		return
	}

	// Parse user ID from the JSON string
	// User field is URL-encoded JSON like {"id":123456,"first_name":"John",...}
	var tgUserID string
	// Simple extraction: find "id": followed by digits
	if idx := strings.Index(userJSON, `"id":`); idx >= 0 {
		rest := userJSON[idx+5:]
		// Skip whitespace
		rest = strings.TrimLeft(rest, " ")
		// Read digits
		end := 0
		for end < len(rest) && rest[end] >= '0' && rest[end] <= '9' {
			end++
		}
		if end > 0 {
			tgUserID = rest[:end]
		}
	}
	if tgUserID == "" {
		s.authLimiter.record(ip)
		writeError(w, http.StatusUnauthorized, "could not extract user ID")
		return
	}

	// Check if this Telegram user ID matches the configured one
	userPref, err := s.db.GetPreference("default", "telegram_user_id")
	allowedID := ""
	if err == nil {
		allowedID = unquotePreference(userPref.Value)
	}
	if err != nil || allowedID != tgUserID {
		s.authLimiter.record(ip)
		slog.Warn("telegram user ID mismatch", "got", tgUserID, "allowed", allowedID)
		writeError(w, http.StatusUnauthorized, "telegram user not authorized")
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
