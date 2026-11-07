package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// resetPassword is the owner's way back in when a password is forgotten (no e-mail here):
//
//	docker exec income-expenses-api /app/api reset-password <username>
//
// It sets a random temporary password, clears the sign-in pause and signs out every session of that user.
func resetPassword(ctx context.Context, db *sql.DB, username string) (string, error) {
	username = strings.ToLower(strings.TrimSpace(username))
	var uid int64
	err := db.QueryRowContext(ctx,
		`SELECT user_id FROM identities WHERE provider = 'password' AND subject = ?`, username).Scan(&uid)
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("ไม่พบชื่อผู้ใช้ %q", username)
	}
	if err != nil {
		return "", err
	}
	temp, err := randomPassword(12)
	if err != nil {
		return "", err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(temp), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		UPDATE identities SET secret_hash = ?, failed_logins = 0, locked_until = 0
		WHERE provider = 'password' AND subject = ?`, string(hash), username); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, uid); err != nil {
		return "", err
	}
	return temp, tx.Commit()
}

// randomPassword avoids look-alike characters so it can be read out and typed on a phone.
func randomPassword(n int) (string, error) {
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
	b := make([]byte, n)
	for i := range b {
		k, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		b[i] = alphabet[k.Int64()]
	}
	return string(b), nil
}

// changePassword lets a signed-in, unlocked user replace their password (e.g. the temporary one).
// Their other sessions are signed out.
func (a *API) changePassword(w http.ResponseWriter, r *http.Request, s *session) {
	var in struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		badRequest(w, "invalid JSON body")
		return
	}
	if s.pinHash == "" && !s.mustChange {
		authError(w, http.StatusForbidden, "pin_required", "กรุณาตั้ง PIN ก่อนใช้งาน")
		return
	}
	if !a.extendUnlock(w, r, s) {
		return
	}
	if n := len(in.New); n < 8 || n > 72 {
		badRequest(w, "รหัสผ่านใหม่ต้องยาว 8–72 ตัวอักษร")
		return
	}
	var hash, tempHash string
	var tempExpires int64
	err := a.db.QueryRowContext(r.Context(),
		`SELECT secret_hash, temp_hash, temp_expires FROM identities WHERE user_id = ? AND provider = 'password'`,
		s.userID).Scan(&hash, &tempHash, &tempExpires)
	if errors.Is(err, sql.ErrNoRows) {
		badRequest(w, "บัญชีนี้ไม่ได้ใช้รหัสผ่านในการเข้าสู่ระบบ")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	// The current password, or a still-valid temporary one from "forgot password".
	currentOK := bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Current)) == nil ||
		(tempHash != "" && tempExpires > time.Now().Unix() && bcrypt.CompareHashAndPassword([]byte(tempHash), []byte(in.Current)) == nil)
	if !currentOK {
		authError(w, http.StatusUnauthorized, "bad_credentials", "รหัสผ่านปัจจุบันไม่ถูกต้อง")
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(in.New), bcrypt.DefaultCost)
	if err != nil {
		serverError(w, err)
		return
	}
	if _, err := a.db.ExecContext(r.Context(), `
		UPDATE identities SET secret_hash = ?, temp_hash = '', temp_expires = 0
		WHERE user_id = ? AND provider = 'password'`, string(newHash), s.userID); err != nil {
		serverError(w, err)
		return
	}
	if _, err := a.db.ExecContext(r.Context(),
		`UPDATE sessions SET must_change_password = 0 WHERE token_hash = ?`, s.tokenHash); err != nil {
		serverError(w, err)
		return
	}
	if _, err := a.db.ExecContext(r.Context(),
		`DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?`, s.userID, s.tokenHash); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
