package sessionlifecycle

import (
	"errors"
	"testing"

	"github.com/miguel-bm/codeburg/internal/db"
)

func TestApplyTransitions(t *testing.T) {
	tests := []struct {
		name    string
		current db.SessionStatus
		event   Event
		want    db.SessionStatus
		changed bool
		wantErr bool
	}{
		{
			name:    "start idle to running",
			current: db.SessionStatusIdle,
			event:   EventSessionStarted,
			want:    db.SessionStatusRunning,
			changed: true,
		},
		{
			name:    "message waiting to running",
			current: db.SessionStatusWaitingInput,
			event:   EventUserMessage,
			want:    db.SessionStatusRunning,
			changed: true,
		},
		{
			name:    "message running no-op",
			current: db.SessionStatusRunning,
			event:   EventUserMessage,
			want:    db.SessionStatusRunning,
			changed: false,
		},
		{
			name:    "notification running to waiting",
			current: db.SessionStatusRunning,
			event:   EventNotificationWaiting,
			want:    db.SessionStatusWaitingInput,
			changed: true,
		},
		{
			name:    "stop requested error to completed",
			current: db.SessionStatusError,
			event:   EventStopRequested,
			want:    db.SessionStatusCompleted,
			changed: true,
		},
		{
			name:    "runtime failure running to error",
			current: db.SessionStatusRunning,
			event:   EventRuntimeExitFailure,
			want:    db.SessionStatusError,
			changed: true,
		},
		{
			name:    "runtime failure completed stays completed",
			current: db.SessionStatusCompleted,
			event:   EventRuntimeExitFailure,
			want:    db.SessionStatusCompleted,
			changed: false,
		},
		{
			name:    "runtime success error stays error",
			current: db.SessionStatusError,
			event:   EventRuntimeExitSuccess,
			want:    db.SessionStatusError,
			changed: false,
		},
		{
			name:    "reject notification from completed",
			current: db.SessionStatusCompleted,
			event:   EventNotificationWaiting,
			wantErr: true,
		},
		{
			name:    "reject start from running",
			current: db.SessionStatusRunning,
			event:   EventSessionStarted,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Apply(tt.current, tt.event)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				if !errors.Is(err, ErrInvalidTransition) {
					t.Fatalf("expected ErrInvalidTransition, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Apply error: %v", err)
			}
			if got.To != tt.want {
				t.Fatalf("expected to=%s, got %s", tt.want, got.To)
			}
			if got.Changed != tt.changed {
				t.Fatalf("expected changed=%v, got %v", tt.changed, got.Changed)
			}
		})
	}
}
