package db

import (
	"database/sql"
	"errors"
	"time"
)

const DefaultUserID = "default"

type UserPreference struct {
	UserID    string
	Key       string
	Value     string
	UpdatedAt time.Time
}

// GetPreference returns a single preference by user and key.
// Returns ErrNotFound if the preference does not exist.
func (db *DB) GetPreference(userID, key string) (*UserPreference, error) {
	row := db.conn.QueryRow(
		`SELECT user_id, key, value, updated_at FROM user_preferences WHERE user_id = ? AND key = ?`,
		userID, key,
	)

	var p UserPreference
	if err := row.Scan(&p.UserID, &p.Key, &p.Value, &p.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// SetPreference upserts a preference value.
func (db *DB) SetPreference(userID, key, value string) (*UserPreference, error) {
	_, err := db.conn.Exec(
		`INSERT INTO user_preferences (user_id, key, value, updated_at)
		 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
		userID, key, value,
	)
	if err != nil {
		return nil, err
	}
	return db.GetPreference(userID, key)
}

// DeletePreference removes a preference. Returns ErrNotFound if it doesn't exist.
func (db *DB) DeletePreference(userID, key string) error {
	res, err := db.conn.Exec(
		`DELETE FROM user_preferences WHERE user_id = ? AND key = ?`,
		userID, key,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
