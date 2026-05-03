package api

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/miguel-bm/codeburg/internal/db"
	"github.com/miguel-bm/codeburg/internal/telegram"
)

type AttentionTargetType string

const (
	AttentionTargetSession      AttentionTargetType = "session"
	AttentionTargetConversation AttentionTargetType = "conversation"
)

type AttentionEvent struct {
	ID          string              `json:"id"`
	TargetType  AttentionTargetType `json:"targetType"`
	TargetID    string              `json:"targetId"`
	ProjectID   string              `json:"projectId,omitempty"`
	WorkspaceID string              `json:"workspaceId,omitempty"`
	TaskID      string              `json:"taskId,omitempty"`
	Reason      string              `json:"reason"`
	Title       string              `json:"title"`
	Body        string              `json:"body"`
	URL         string              `json:"url,omitempty"`
	CanReply    bool                `json:"canReply"`
	CreatedAt   string              `json:"createdAt"`
}

type webPushSubscribeRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256DH string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

func (s *Server) notifyAttention(event AttentionEvent) {
	event.TargetID = strings.TrimSpace(event.TargetID)
	if event.TargetID == "" || event.TargetType == "" {
		return
	}
	if event.ID == "" {
		event.ID = db.NewID()
	}
	if event.CreatedAt == "" {
		event.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if event.Title == "" {
		event.Title = "Codeburg"
	}
	if event.Body == "" {
		event.Body = "Needs your attention."
	}

	s.wsHub.BroadcastGlobal("attention", event)
	s.wsHub.BroadcastGlobal("sidebar_update", map[string]string{
		"targetType": string(event.TargetType),
		"targetId":   event.TargetID,
		"projectId":  event.ProjectID,
		"taskId":     event.TaskID,
	})

	if s.notificationsSuppressFocusedTargets() && s.focusedTargetRecently(event.TargetType, event.TargetID, 20*time.Second) {
		slog.Debug("notification skipped: target actively focused", "target_type", event.TargetType, "target_id", event.TargetID)
		return
	}

	s.notifyTelegramAttention(event)
	s.notifyWebPushAttention(event)
}

func (s *Server) sessionAttentionEvent(sessionID, taskID, reason string) AttentionEvent {
	providerLabel := "Agent"
	tabLabel := ""
	projectID := ""
	if session, err := s.db.GetSession(sessionID); err == nil {
		providerLabel = telegramProviderLabel(session.Provider)
		projectID = session.ProjectID
		if session.DisplayName != nil {
			tabLabel = strings.TrimSpace(*session.DisplayName)
		}
	}
	if tabLabel == "" {
		tabLabel = fmt.Sprintf("%s %s", providerLabel, shortID(sessionID))
	}
	taskTitle := ""
	if taskID != "" {
		if task, err := s.db.GetTask(taskID); err == nil {
			taskTitle = task.Title
			projectID = task.ProjectID
		}
	}
	url := ""
	if origin := s.originURL(); origin != "" && taskID != "" {
		url = strings.TrimSuffix(origin, "/") + "/tasks/" + taskID + "/session/" + sessionID
	}
	body := tabLabel + " needs your attention."
	if strings.TrimSpace(taskTitle) != "" {
		body = fmt.Sprintf("%s needs your attention on task %s.", tabLabel, taskTitle)
	}
	return AttentionEvent{
		TargetType: AttentionTargetSession,
		TargetID:   sessionID,
		ProjectID:  projectID,
		TaskID:     taskID,
		Reason:     fallbackReason(reason),
		Title:      "Agent waiting for input",
		Body:       body,
		URL:        url,
		CanReply:   true,
	}
}

func (s *Server) conversationAttentionEvent(conversationID, reason string) (AttentionEvent, error) {
	conversation, err := s.db.GetConversation(conversationID)
	if err != nil {
		return AttentionEvent{}, err
	}
	workspaceID := ""
	if conversation.CurrentWorkspaceID != nil {
		workspaceID = strings.TrimSpace(*conversation.CurrentWorkspaceID)
	}
	url := ""
	if origin := s.originURL(); origin != "" {
		url = strings.TrimSuffix(origin, "/") + "/conversations/" + conversationID
	}
	provider := telegramProviderLabel(conversation.Provider)
	body := fmt.Sprintf("%s chat %q needs your input.", provider, conversation.Title)
	return AttentionEvent{
		TargetType:  AttentionTargetConversation,
		TargetID:    conversation.ID,
		ProjectID:   conversation.ProjectID,
		WorkspaceID: workspaceID,
		Reason:      fallbackReason(reason),
		Title:       "Pi chat waiting for input",
		Body:        body,
		URL:         url,
		CanReply:    true,
	}, nil
}

func (s *Server) notifyConversationNeedsAttention(conversationID, reason string) {
	event, err := s.conversationAttentionEvent(conversationID, reason)
	if err != nil {
		slog.Warn("failed to build conversation attention event", "conversation_id", conversationID, "error", err)
		return
	}
	s.notifyAttention(event)
}

func (s *Server) originURL() string {
	if cfg, err := s.auth.loadConfig(); err == nil {
		return strings.TrimSpace(cfg.Auth.Origin)
	}
	return ""
}

func (s *Server) notifyTelegramSessionNeedsAttention(sessionID, taskID, reason string) {
	s.notifyAttention(s.sessionAttentionEvent(sessionID, taskID, reason))
}

func (s *Server) notifyTelegramAttention(event AttentionEvent) {
	if !s.telegramNotificationsEnabled() {
		return
	}
	s.telegramBotMu.Lock()
	bot := s.telegramBot
	s.telegramBotMu.Unlock()
	if bot == nil {
		return
	}
	chatIDRaw, err := s.telegramPreferenceString("telegram_user_id")
	if err != nil || strings.TrimSpace(chatIDRaw) == "" {
		return
	}
	chatID, err := strconv.ParseInt(strings.TrimSpace(chatIDRaw), 10, 64)
	if err != nil {
		slog.Warn("telegram notify skipped: invalid telegram_user_id", "value", chatIDRaw, "error", err)
		return
	}

	htmlText := html.EscapeString(event.Body)
	plainText := event.Body
	if event.URL != "" {
		htmlText = fmt.Sprintf("<a href=\"%s\">%s</a>", html.EscapeString(event.URL), html.EscapeString(event.Body))
		plainText = event.Body + "\n" + event.URL
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	messageID, err := bot.SendMessageWithOptions(ctx, chatID, htmlText, telegram.SendMessageOptions{ParseMode: "HTML"})
	if err != nil {
		messageID, err = bot.SendMessageWithOptions(ctx, chatID, plainText, telegram.SendMessageOptions{})
	}
	if err != nil {
		slog.Warn("telegram notification delivery failed", "target_type", event.TargetType, "target_id", event.TargetID, "error", err)
		return
	}
	if messageID != 0 && event.CanReply {
		s.telegramStoreReplyTarget(chatID, messageID, event.TargetType, event.TargetID)
	}
}

func (s *Server) notifyWebPushAttention(event AttentionEvent) {
	if !s.webPushNotificationsEnabled() {
		return
	}
	publicKey, privateKey, err := s.ensureVAPIDKeys()
	if err != nil {
		slog.Debug("web push skipped: vapid keys unavailable", "error", err)
		return
	}
	subs, err := s.db.ListWebPushSubscriptions(db.DefaultUserID)
	if err != nil || len(subs) == 0 {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"id":         event.ID,
		"title":      event.Title,
		"body":       event.Body,
		"url":        event.URL,
		"tag":        string(event.TargetType) + ":" + event.TargetID,
		"targetType": event.TargetType,
		"targetId":   event.TargetID,
	})
	for _, sub := range subs {
		subscription := &webpush.Subscription{Endpoint: sub.Endpoint, Keys: webpush.Keys{P256dh: sub.P256DH, Auth: sub.Auth}}
		resp, err := webpush.SendNotification(payload, subscription, &webpush.Options{
			Subscriber:      "mailto:notifications@codeburg.local",
			VAPIDPublicKey:  publicKey,
			VAPIDPrivateKey: privateKey,
			TTL:             60 * 60,
		})
		if resp != nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
				_ = s.db.DeleteWebPushSubscription(sub.ID)
			}
		}
		if err != nil {
			slog.Debug("web push delivery failed", "subscription_id", sub.ID, "error", err)
		}
	}
}

func (s *Server) ensureVAPIDKeys() (string, string, error) {
	pub := ""
	priv := ""
	if pref, err := s.db.GetPreference(db.DefaultUserID, "notification_vapid_public_key"); err == nil {
		pub = strings.TrimSpace(unquotePreference(pref.Value))
	}
	if pref, err := s.db.GetPreference(db.DefaultUserID, "notification_vapid_private_key"); err == nil {
		priv = strings.TrimSpace(unquotePreference(pref.Value))
	}
	if pub != "" && priv != "" {
		return pub, priv, nil
	}
	pub, priv, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return "", "", err
	}
	pubRaw, _ := json.Marshal(pub)
	privRaw, _ := json.Marshal(priv)
	_, _ = s.db.SetPreference(db.DefaultUserID, "notification_vapid_public_key", string(pubRaw))
	_, _ = s.db.SetPreference(db.DefaultUserID, "notification_vapid_private_key", string(privRaw))
	return pub, priv, nil
}

func (s *Server) handleGetVAPIDPublicKey(w http.ResponseWriter, r *http.Request) {
	pub, _, err := s.ensureVAPIDKeys()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to initialize push notifications")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"publicKey": pub})
}

func (s *Server) handleListWebPushSubscriptions(w http.ResponseWriter, r *http.Request) {
	subs, err := s.db.ListWebPushSubscriptions(db.DefaultUserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list push subscriptions")
		return
	}
	writeJSON(w, http.StatusOK, subs)
}

func (s *Server) handleSubscribeWebPush(w http.ResponseWriter, r *http.Request) {
	var req webPushSubscribeRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid subscription")
		return
	}
	if strings.TrimSpace(req.Endpoint) == "" || strings.TrimSpace(req.Keys.P256DH) == "" || strings.TrimSpace(req.Keys.Auth) == "" {
		writeError(w, http.StatusBadRequest, "invalid subscription")
		return
	}
	sub, err := s.db.UpsertWebPushSubscription(db.UpsertWebPushSubscriptionInput{
		UserID:    db.DefaultUserID,
		Endpoint:  strings.TrimSpace(req.Endpoint),
		P256DH:    strings.TrimSpace(req.Keys.P256DH),
		Auth:      strings.TrimSpace(req.Keys.Auth),
		UserAgent: strings.TrimSpace(r.UserAgent()),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save subscription")
		return
	}
	writeJSON(w, http.StatusOK, sub)
}

func (s *Server) handleDeleteWebPushSubscription(w http.ResponseWriter, r *http.Request) {
	id := urlParam(r, "id")
	if err := s.db.DeleteWebPushSubscription(id); err != nil {
		writeDBError(w, err, "push subscription")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleTestNotification(w http.ResponseWriter, r *http.Request) {
	event := AttentionEvent{
		TargetType: AttentionTargetConversation,
		TargetID:   "test",
		Reason:     "test",
		Title:      "Codeburg test notification",
		Body:       "Notifications are working.",
		URL:        "/",
	}
	s.notifyAttention(event)
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func (s *Server) webPushNotificationsEnabled() bool {
	return boolPreference(s, "web_push_notifications_enabled", true)
}

func (s *Server) notificationsSuppressFocusedTargets() bool {
	return boolPreference(s, "notifications_suppress_when_active", s.telegramSuppressFocusedSessionNotifications())
}

func boolPreference(s *Server, key string, fallback bool) bool {
	raw, err := s.telegramPreferenceString(key)
	if err != nil {
		return fallback
	}
	parsed, err := strconv.ParseBool(strings.TrimSpace(raw))
	if err != nil {
		return fallback
	}
	return parsed
}
