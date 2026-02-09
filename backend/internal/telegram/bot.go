package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// Bot is a minimal Telegram bot that responds to /start with a Web App button.
type Bot struct {
	token  string
	webURL string // e.g. "https://codeburg.miscellanics.com"
	client *http.Client
}

// NewBot creates a bot that sends a Web App button linking to webURL.
func NewBot(token, webURL string) *Bot {
	return &Bot{
		token:  token,
		webURL: webURL,
		client: &http.Client{Timeout: 35 * time.Second},
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
			b.handleUpdate(u)
		}
	}
}

type update struct {
	UpdateID int      `json:"update_id"`
	Message  *message `json:"message"`
}

type message struct {
	Chat chat   `json:"chat"`
	Text string `json:"text"`
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

func (b *Bot) handleUpdate(u update) {
	if u.Message == nil || u.Message.Text != "/start" {
		return
	}

	chatID := u.Message.Chat.ID
	slog.Info("telegram /start received", "chat_id", chatID)

	payload := map[string]any{
		"chat_id": chatID,
		"text":    "Open Codeburg",
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

	b.sendJSON("sendMessage", payload)
}

func (b *Bot) sendJSON(method string, payload any) {
	apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/%s", b.token, method)

	body, err := json.Marshal(payload)
	if err != nil {
		slog.Error("telegram marshal failed", "error", err)
		return
	}

	resp, err := http.Post(apiURL, "application/json", bytes.NewReader(body))
	if err != nil {
		slog.Error("telegram send failed", "error", err)
		return
	}
	resp.Body.Close()
}
