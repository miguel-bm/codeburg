package db

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/oklog/ulid/v2"
	_ "modernc.org/sqlite"
)

// ErrNotFound is returned when a requested entity does not exist.
var ErrNotFound = errors.New("not found")

type DB struct {
	conn *sql.DB
}

// DefaultPath returns the default database path (~/.codeburg/codeburg.db)
func DefaultPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "codeburg.db"
	}
	return filepath.Join(home, ".codeburg", "codeburg.db")
}

// Open opens or creates the database at the given path
func Open(path string) (*DB, error) {
	// Ensure directory exists
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}

	// Open database with WAL mode for better concurrency
	conn, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// Test connection
	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return &DB{conn: conn}, nil
}

// Close closes the database connection
func (db *DB) Close() error {
	return db.conn.Close()
}

// NewID generates a new ULID
func NewID() string {
	return ulid.Make().String()
}

// scanFunc is the common signature shared by (*sql.Row).Scan and (*sql.Rows).Scan,
// allowing a single scan function per entity to handle both cases.
type scanFunc func(dest ...any) error

// NullString converts a string pointer to sql.NullString
func NullString(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *s, Valid: true}
}

// NullTime converts a time pointer to sql.NullTime
func NullTime(t *time.Time) sql.NullTime {
	if t == nil {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: *t, Valid: true}
}

// StringPtr converts sql.NullString to string pointer
func StringPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	return &ns.String
}

// TimePtr converts sql.NullTime to time pointer
func TimePtr(nt sql.NullTime) *time.Time {
	if !nt.Valid {
		return nil
	}
	return &nt.Time
}
