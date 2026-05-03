package db

import (
	"database/sql"
	"errors"
	"time"
)

type WebPushSubscription struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Endpoint  string    `json:"endpoint"`
	P256DH    string    `json:"p256dh"`
	Auth      string    `json:"auth"`
	UserAgent string    `json:"userAgent,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type UpsertWebPushSubscriptionInput struct {
	UserID    string
	Endpoint  string
	P256DH    string
	Auth      string
	UserAgent string
}

func (db *DB) UpsertWebPushSubscription(input UpsertWebPushSubscriptionInput) (*WebPushSubscription, error) {
	if input.UserID == "" {
		input.UserID = DefaultUserID
	}
	id := NewID()
	_, err := db.conn.Exec(`
		INSERT INTO web_push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
		ON CONFLICT(endpoint) DO UPDATE SET
			user_id = excluded.user_id,
			p256dh = excluded.p256dh,
			auth = excluded.auth,
			user_agent = excluded.user_agent,
			updated_at = CURRENT_TIMESTAMP
	`, id, input.UserID, input.Endpoint, input.P256DH, input.Auth, input.UserAgent)
	if err != nil {
		return nil, err
	}
	return db.GetWebPushSubscriptionByEndpoint(input.Endpoint)
}

func (db *DB) GetWebPushSubscriptionByEndpoint(endpoint string) (*WebPushSubscription, error) {
	row := db.conn.QueryRow(`
		SELECT id, user_id, endpoint, p256dh, auth, COALESCE(user_agent, ''), created_at, updated_at
		FROM web_push_subscriptions
		WHERE endpoint = ?
	`, endpoint)
	return scanWebPushSubscription(row.Scan)
}

func (db *DB) ListWebPushSubscriptions(userID string) ([]WebPushSubscription, error) {
	if userID == "" {
		userID = DefaultUserID
	}
	rows, err := db.conn.Query(`
		SELECT id, user_id, endpoint, p256dh, auth, COALESCE(user_agent, ''), created_at, updated_at
		FROM web_push_subscriptions
		WHERE user_id = ?
		ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []WebPushSubscription{}
	for rows.Next() {
		sub, err := scanWebPushSubscription(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, *sub)
	}
	return out, rows.Err()
}

func (db *DB) DeleteWebPushSubscription(id string) error {
	res, err := db.conn.Exec(`DELETE FROM web_push_subscriptions WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (db *DB) DeleteWebPushSubscriptionByEndpoint(endpoint string) error {
	_, err := db.conn.Exec(`DELETE FROM web_push_subscriptions WHERE endpoint = ?`, endpoint)
	return err
}

func scanWebPushSubscription(scan scanFunc) (*WebPushSubscription, error) {
	var sub WebPushSubscription
	if err := scan(&sub.ID, &sub.UserID, &sub.Endpoint, &sub.P256DH, &sub.Auth, &sub.UserAgent, &sub.CreatedAt, &sub.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &sub, nil
}
