package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Handlers struct {
	OnCommand func(ctx context.Context, msg IncomingMessage) (string, error)
	OnMessage func(ctx context.Context, msg IncomingMessage) (string, error)
}

type IncomingMessage struct {
	ChatID     int64
	UserID     int64
	Username   string
	FirstName  string
	LastName   string
	Text       string
	IsCommand  bool
	Command    string
	CommandRaw string
	Args       string
}

// Bot long-polls Telegram updates and delegates messages to configured handlers.
type Bot struct {
	token         string
	webURL        string // e.g. "https://codeburg.miscellanics.com"
	allowedUserID string
	onCommand     func(ctx context.Context, msg IncomingMessage) (string, error)
	onMessage     func(ctx context.Context, msg IncomingMessage) (string, error)
	client        *http.Client
}

// NewBot creates a bot configured to serve a Web App button and optional handlers.
func NewBot(token, webURL, allowedUserID string, handlers Handlers) *Bot {
	return &Bot{
		token:         token,
		webURL:        webURL,
		allowedUserID: strings.TrimSpace(allowedUserID),
		onCommand:     handlers.OnCommand,
		onMessage:     handlers.OnMessage,
		client:        &http.Client{Timeout: 35 * time.Second},
	}
}

// Run starts long-polling. Blocks until ctx is cancelled.
func (b *Bot) Run(ctx context.Context) {
	slog.Info("telegram bot started", "web_url", b.webURL)
	offset := 0
	for {
		select {
		case <-ctx.Done():
			slog.Info("telegram bot stopped")
			return
		default:
		}

		updates, err := b.getUpdates(ctx, offset)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.Error("telegram getUpdates failed", "error", err)
			time.Sleep(5 * time.Second)
			continue
		}

		for _, u := range updates {
			if u.UpdateID >= offset {
				offset = u.UpdateID + 1
			}
			b.handleUpdate(ctx, u)
		}
	}
}

type update struct {
	UpdateID int      `json:"update_id"`
	Message  *message `json:"message"`
}

type message struct {
	Chat       chat            `json:"chat"`
	From       *user           `json:"from,omitempty"`
	Text       string          `json:"text"`
	Entities   []messageEntity `json:"entities,omitempty"`
	WebAppData *messageWebApp  `json:"web_app_data,omitempty"`
}

type user struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

type messageEntity struct {
	Type   string `json:"type"`
	Offset int    `json:"offset"`
	Length int    `json:"length"`
}

type messageWebApp struct {
	Data       string `json:"data"`
	ButtonText string `json:"button_text"`
}

type chat struct {
	ID int64 `json:"id"`
}

func (b *Bot) getUpdates(ctx context.Context, offset int) ([]update, error) {
	apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/getUpdates?offset=%d&timeout=30&allowed_updates=[\"message\"]", b.token, offset)
	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := b.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result struct {
		OK     bool     `json:"ok"`
		Result []update `json:"result"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	if !result.OK {
		return nil, fmt.Errorf("telegram API returned ok=false")
	}
	return result.Result, nil
}

func (b *Bot) handleUpdate(ctx context.Context, u update) {
	if u.Message == nil {
		return
	}
	if !b.isAuthorized(u.Message) {
		return
	}

	msg := parseIncomingMessage(u.Message)
	if msg.Text == "" {
		return
	}

	if msg.IsCommand && msg.Command == "start" {
		b.sendStartMessage(ctx, msg.ChatID)
		return
	}

	var reply string
	var err error
	if msg.IsCommand {
		if b.onCommand != nil {
			reply, err = b.onCommand(ctx, msg)
		} else {
			reply = "Command handling is not configured."
		}
	} else {
		if b.onMessage != nil {
			reply, err = b.onMessage(ctx, msg)
		} else {
			reply = "Message handling is not configured."
		}
	}
	if err != nil {
		slog.Warn("telegram handler failed", "command", msg.Command, "error", err)
		reply = "I could not process that right now."
	}
	if strings.TrimSpace(reply) == "" {
		return
	}
	_ = b.SendMessage(ctx, msg.ChatID, reply)
}

func (b *Bot) isAuthorized(m *message) bool {
	if b.allowedUserID == "" || m.From == nil {
		return true
	}
	got := strconv.FormatInt(m.From.ID, 10)
	if got != b.allowedUserID {
		slog.Warn("telegram unauthorized message ignored", "from_user_id", got)
		return false
	}
	return true
}

func parseIncomingMessage(m *message) IncomingMessage {
	out := IncomingMessage{
		ChatID: m.Chat.ID,
		Text:   strings.TrimSpace(m.Text),
	}
	if m.From != nil {
		out.UserID = m.From.ID
		out.Username = m.From.Username
		out.FirstName = m.From.FirstName
		out.LastName = m.From.LastName
	}
	if out.Text == "" || !strings.HasPrefix(out.Text, "/") {
		return out
	}
	out.IsCommand = true

	token := out.Text
	if space := strings.IndexByte(token, ' '); space >= 0 {
		token = token[:space]
		out.Args = strings.TrimSpace(out.Text[space+1:])
	}
	token = strings.TrimPrefix(token, "/")
	out.CommandRaw = token
	if at := strings.IndexByte(token, '@'); at >= 0 {
		token = token[:at]
	}
	out.Command = strings.ToLower(strings.TrimSpace(token))
	return out
}

func (b *Bot) sendStartMessage(ctx context.Context, chatID int64) {
	slog.Info("telegram /start received", "chat_id", chatID)
	payload := map[string]any{
		"chat_id": chatID,
		"text":    "Open Codeburg or use /help for bot commands.",
		"reply_markup": map[string]any{
			"inline_keyboard": [][]map[string]any{
				{
					{
						"text": "Open Codeburg",
						"web_app": map[string]string{
							"url": b.webURL,
						},
					},
				},
			},
		},
	}
	b.sendJSON(ctx, "sendMessage", payload)
}

func (b *Bot) SendMessage(ctx context.Context, chatID int64, text string) error {
	payload := map[string]any{
		"chat_id": chatID,
		"text":    text,
	}
	return b.sendJSON(ctx, "sendMessage", payload)
}

func (b *Bot) sendJSON(ctx context.Context, method string, payload any) error {
	apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/%s", b.token, method)

	body, err := json.Marshal(payload)
	if err != nil {
		slog.Error("telegram marshal failed", "error", err)
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := b.client.Do(req)
	if err != nil {
		slog.Error("telegram send failed", "error", err)
		return err
	}
	resp.Body.Close()
	return nil
}
