package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// AgentMessage stores a single structured chat message for a session.
type AgentMessage struct {
	ID          string    `json:"id"`
	SessionID   string    `json:"sessionId"`
	Seq         int64     `json:"seq"`
	Kind        string    `json:"kind"`
	PayloadJSON string    `json:"payloadJson"`
	CreatedAt   time.Time `json:"createdAt"`
}

// CreateAgentMessageInput contains fields for inserting a chat message.
type CreateAgentMessageInput struct {
	SessionID   string
	Seq         int64
	Kind        string
	PayloadJSON string
}

// CreateAgentMessage inserts a chat message row.
func (db *DB) CreateAgentMessage(input CreateAgentMessageInput) (*AgentMessage, error) {
	id := NewID()
	now := time.Now()

	_, err := db.conn.Exec(`
		INSERT INTO agent_messages (id, session_id, seq, kind, payload_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, id, input.SessionID, input.Seq, input.Kind, input.PayloadJSON, now)
	if err != nil {
		return nil, fmt.Errorf("insert agent message: %w", err)
	}

	return &AgentMessage{
		ID:          id,
		SessionID:   input.SessionID,
		Seq:         input.Seq,
		Kind:        input.Kind,
		PayloadJSON: input.PayloadJSON,
		CreatedAt:   now,
	}, nil
}

// ListAgentMessagesBySession returns all chat messages for a session ordered by sequence.
func (db *DB) ListAgentMessagesBySession(sessionID string) ([]*AgentMessage, error) {
	rows, err := db.conn.Query(`
		SELECT id, session_id, seq, kind, payload_json, created_at
		FROM agent_messages
		WHERE session_id = ?
		ORDER BY seq ASC, created_at ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("query agent messages: %w", err)
	}
	defer rows.Close()

	out := make([]*AgentMessage, 0)
	for rows.Next() {
		msg, err := scanAgentMessage(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, msg)
	}
	return out, rows.Err()
}

// UpdateAgentMessagePayload replaces a message payload and optional kind.
func (db *DB) UpdateAgentMessagePayload(id string, kind string, payloadJSON string) error {
	result, err := db.conn.Exec(`
		UPDATE agent_messages
		SET kind = ?, payload_json = ?
		WHERE id = ?
	`, kind, payloadJSON, id)
	if err != nil {
		return fmt.Errorf("update agent message payload: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// GetLastAgentMessageSeq returns the latest sequence number for a session.
func (db *DB) GetLastAgentMessageSeq(sessionID string) (int64, error) {
	row := db.conn.QueryRow(`
		SELECT COALESCE(MAX(seq), 0)
		FROM agent_messages
		WHERE session_id = ?
	`, sessionID)

	var seq sql.NullInt64
	if err := row.Scan(&seq); err != nil {
		return 0, fmt.Errorf("get last agent message seq: %w", err)
	}
	if seq.Valid {
		return seq.Int64, nil
	}
	return 0, nil
}

// CopyAgentMessages duplicates all messages from one session into another.
// Sequence numbers and payloads are preserved so chat history can be replayed
// in resumed sessions.
func (db *DB) CopyAgentMessages(sourceSessionID, targetSessionID string) (int, error) {
	ctx := context.Background()
	conn, err := db.conn.Conn(ctx)
	if err != nil {
		return 0, fmt.Errorf("acquire db connection for copy agent messages: %w", err)
	}
	defer conn.Close()

	rows, err := conn.QueryContext(ctx, `
		SELECT seq, kind, payload_json, created_at
		FROM agent_messages
		WHERE session_id = ?
		ORDER BY seq ASC, created_at ASC
	`, sourceSessionID)
	if err != nil {
		return 0, fmt.Errorf("query source agent messages: %w", err)
	}
	type sourceMessage struct {
		seq         int64
		kind        string
		payloadJSON string
		createdAt   time.Time
	}
	source := make([]sourceMessage, 0)

	for rows.Next() {
		var row sourceMessage
		if err := rows.Scan(&row.seq, &row.kind, &row.payloadJSON, &row.createdAt); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan source agent message: %w", err)
		}
		source = append(source, row)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, fmt.Errorf("iterate source agent messages: %w", err)
	}
	if err := rows.Close(); err != nil {
		return 0, fmt.Errorf("close source agent messages rows: %w", err)
	}

	for _, row := range source {
		if _, err := conn.ExecContext(ctx, `
			INSERT INTO agent_messages (id, session_id, seq, kind, payload_json, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, NewID(), targetSessionID, row.seq, row.kind, row.payloadJSON, row.createdAt); err != nil {
			return 0, fmt.Errorf("insert copied agent message: %w", err)
		}
	}
	return len(source), nil
}

func scanAgentMessage(scan scanFunc) (*AgentMessage, error) {
	var msg AgentMessage
	err := scan(
		&msg.ID,
		&msg.SessionID,
		&msg.Seq,
		&msg.Kind,
		&msg.PayloadJSON,
		&msg.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &msg, nil
}
