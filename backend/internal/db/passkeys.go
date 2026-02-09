package db

import (
	"database/sql"
	"time"
)

type Passkey struct {
	ID              string
	CredentialID    []byte
	PublicKey       []byte
	AttestationType string
	AAGUID          []byte
	SignCount       uint32
	Name            string
	Transports      *string // JSON array e.g. ["internal","hybrid"]
	CreatedAt       time.Time
	LastUsedAt      *time.Time
}

func scanPasskey(scan scanFunc) (Passkey, error) {
	var p Passkey
	var transports sql.NullString
	var lastUsed sql.NullTime
	err := scan(
		&p.ID,
		&p.CredentialID,
		&p.PublicKey,
		&p.AttestationType,
		&p.AAGUID,
		&p.SignCount,
		&p.Name,
		&transports,
		&p.CreatedAt,
		&lastUsed,
	)
	p.Transports = StringPtr(transports)
	p.LastUsedAt = TimePtr(lastUsed)
	return p, err
}

const passkeyColumns = `id, credential_id, public_key, attestation_type, aaguid, sign_count, name, transports, created_at, last_used_at`

func (db *DB) CreatePasskey(p *Passkey) error {
	p.ID = NewID()
	p.CreatedAt = time.Now()
	_, err := db.conn.Exec(
		`INSERT INTO passkeys (id, credential_id, public_key, attestation_type, aaguid, sign_count, name, transports, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.CredentialID, p.PublicKey, p.AttestationType, p.AAGUID, p.SignCount, p.Name, NullString(p.Transports), p.CreatedAt,
	)
	return err
}

func (db *DB) GetPasskeyByCredentialID(credentialID []byte) (Passkey, error) {
	row := db.conn.QueryRow(
		`SELECT `+passkeyColumns+` FROM passkeys WHERE credential_id = ?`,
		credentialID,
	)
	p, err := scanPasskey(row.Scan)
	if err == sql.ErrNoRows {
		return p, ErrNotFound
	}
	return p, err
}

func (db *DB) ListPasskeys() ([]Passkey, error) {
	rows, err := db.conn.Query(`SELECT ` + passkeyColumns + ` FROM passkeys ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var passkeys []Passkey
	for rows.Next() {
		p, err := scanPasskey(rows.Scan)
		if err != nil {
			return nil, err
		}
		passkeys = append(passkeys, p)
	}
	return passkeys, rows.Err()
}

func (db *DB) UpdatePasskeySignCount(id string, signCount uint32) error {
	res, err := db.conn.Exec(`UPDATE passkeys SET sign_count = ? WHERE id = ?`, signCount, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (db *DB) UpdatePasskeyLastUsed(id string) error {
	res, err := db.conn.Exec(`UPDATE passkeys SET last_used_at = ? WHERE id = ?`, time.Now(), id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (db *DB) DeletePasskey(id string) error {
	res, err := db.conn.Exec(`DELETE FROM passkeys WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (db *DB) RenamePasskey(id, name string) error {
	res, err := db.conn.Exec(`UPDATE passkeys SET name = ? WHERE id = ?`, name, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
