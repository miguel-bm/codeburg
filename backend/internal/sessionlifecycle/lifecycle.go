package sessionlifecycle

import (
	"errors"
	"fmt"

	"github.com/miguel-bm/codeburg/internal/db"
)

// Event is a logical trigger that may change a session state.
type Event string

const (
	EventSessionStarted       Event = "session_started"
	EventUserMessage          Event = "user_message"
	EventUserActivity         Event = "user_activity"
	EventNotificationWaiting  Event = "notification_waiting"
	EventStopHookContinue     Event = "stop_hook_continue"
	EventStopHookWaiting      Event = "stop_hook_waiting"
	EventAgentTurnComplete    Event = "agent_turn_complete"
	EventSessionEnded         Event = "session_ended"
	EventStopRequested        Event = "stop_requested"
	EventDeleteRequested      Event = "delete_requested"
	EventReconcileOrphan      Event = "reconcile_orphan"
	EventZombieRuntimeMissing Event = "zombie_runtime_missing"
	EventRuntimeExitSuccess   Event = "runtime_exit_success"
	EventRuntimeExitFailure   Event = "runtime_exit_failure"
)

// ErrInvalidTransition is returned when an event is not allowed from a state.
var ErrInvalidTransition = errors.New("invalid session transition")

// Transition is the result of applying an event to a current state.
type Transition struct {
	Event   Event
	From    db.SessionStatus
	To      db.SessionStatus
	Changed bool
}

// Apply validates and computes a session status transition for the given event.
func Apply(current db.SessionStatus, event Event) (Transition, error) {
	switch event {
	case EventSessionStarted:
		return transition(event, current, db.SessionStatusRunning, db.SessionStatusIdle)
	case EventUserMessage, EventUserActivity:
		return transition(event, current, db.SessionStatusRunning, db.SessionStatusRunning, db.SessionStatusWaitingInput)
	case EventNotificationWaiting, EventStopHookWaiting, EventAgentTurnComplete:
		return transition(event, current, db.SessionStatusWaitingInput, db.SessionStatusRunning, db.SessionStatusWaitingInput)
	case EventStopHookContinue:
		return transition(event, current, db.SessionStatusRunning, db.SessionStatusRunning, db.SessionStatusWaitingInput)
	case EventSessionEnded:
		return transition(
			event,
			current,
			db.SessionStatusCompleted,
			db.SessionStatusIdle,
			db.SessionStatusRunning,
			db.SessionStatusWaitingInput,
			db.SessionStatusError,
			db.SessionStatusCompleted,
		)
	case EventStopRequested, EventDeleteRequested:
		return transition(
			event,
			current,
			db.SessionStatusCompleted,
			db.SessionStatusIdle,
			db.SessionStatusRunning,
			db.SessionStatusWaitingInput,
			db.SessionStatusError,
			db.SessionStatusCompleted,
		)
	case EventReconcileOrphan, EventZombieRuntimeMissing:
		return transition(event, current, db.SessionStatusCompleted, db.SessionStatusIdle, db.SessionStatusRunning, db.SessionStatusWaitingInput)
	case EventRuntimeExitSuccess:
		switch current {
		case db.SessionStatusCompleted:
			return Transition{Event: event, From: current, To: db.SessionStatusCompleted, Changed: false}, nil
		case db.SessionStatusError:
			return Transition{Event: event, From: current, To: db.SessionStatusError, Changed: false}, nil
		default:
			return transition(event, current, db.SessionStatusCompleted, db.SessionStatusIdle, db.SessionStatusRunning, db.SessionStatusWaitingInput)
		}
	case EventRuntimeExitFailure:
		switch current {
		case db.SessionStatusCompleted:
			return Transition{Event: event, From: current, To: db.SessionStatusCompleted, Changed: false}, nil
		case db.SessionStatusError:
			return Transition{Event: event, From: current, To: db.SessionStatusError, Changed: false}, nil
		default:
			return transition(event, current, db.SessionStatusError, db.SessionStatusIdle, db.SessionStatusRunning, db.SessionStatusWaitingInput)
		}
	default:
		return Transition{}, fmt.Errorf("%w: unknown event %q", ErrInvalidTransition, event)
	}
}

func transition(event Event, current, target db.SessionStatus, allowed ...db.SessionStatus) (Transition, error) {
	if !contains(allowed, current) {
		return Transition{}, fmt.Errorf("%w: event=%s from=%s", ErrInvalidTransition, event, current)
	}
	return Transition{
		Event:   event,
		From:    current,
		To:      target,
		Changed: current != target,
	}, nil
}

func contains(states []db.SessionStatus, state db.SessionStatus) bool {
	for _, s := range states {
		if s == state {
			return true
		}
	}
	return false
}
