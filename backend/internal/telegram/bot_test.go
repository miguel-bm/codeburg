package telegram

import "testing"

func TestBotAuthorizationRequiresFromWhenUserIsConfigured(t *testing.T) {
	bot := NewBot("token", "https://example.com", "123", Handlers{})
	if bot.isAuthorized(&message{From: nil}) {
		t.Fatalf("expected unauthorized when from user is missing")
	}
}

func TestParseIncomingMessageCapturesVoiceAndAudio(t *testing.T) {
	msg := parseIncomingMessage(&message{
		Chat:  chat{ID: 42},
		Voice: &voice{FileID: "voice-file"},
		Audio: &audio{FileID: "audio-file"},
	})
	if msg.VoiceFileID != "voice-file" {
		t.Fatalf("expected voice file id, got %q", msg.VoiceFileID)
	}
	if msg.AudioFileID != "audio-file" {
		t.Fatalf("expected audio file id, got %q", msg.AudioFileID)
	}
}

func TestParseIncomingMessageCapturesReplyMetadata(t *testing.T) {
	msg := parseIncomingMessage(&message{
		Chat: chat{ID: 42},
		ReplyToMessage: &message{
			MessageID: 91,
			Text:      "notification text",
		},
		Text: "reply body",
	})
	if msg.ReplyToMessageID != 91 {
		t.Fatalf("expected reply_to_message_id=91, got %d", msg.ReplyToMessageID)
	}
	if msg.ReplyToText != "notification text" {
		t.Fatalf("expected reply_to_text to be captured, got %q", msg.ReplyToText)
	}
}
