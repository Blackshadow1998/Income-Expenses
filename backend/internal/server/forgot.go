package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"strings"
	"time"

	"income-expenses/internal/httpx"
	"income-expenses/internal/logx"

	"golang.org/x/crypto/bcrypt"
)

// Forgot password, by e-mail:
//  1. POST /api/auth/forgot {email}: if a user has that e-mail, a 6-digit code (valid 3 minutes) is
//     e-mailed. The answer is the same whether or not the e-mail is known, so it can't be used to
//     find out who has an account.
//  2. POST /api/auth/forgot/verify {email, code}: a right code gives a temporary password valid for
//     a day. Signing in with it only allows changing the password (sessions.must_change_password).
const (
	otpTTL          = 3 * time.Minute
	otpResendAfter  = 60 * time.Second
	otpPerHour      = 5
	otpMaxTries     = 5
	tempPasswordTTL = 24 * time.Hour
)

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func normalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

const forgotSent = "ถ้ามีบัญชีที่ใช้อีเมลนี้ เราส่งรหัส 6 หลักไปแล้ว ใช้ได้ภายใน 3 นาที (เช็กในจดหมายขยะด้วย)"

func (a *API) forgotPassword(w http.ResponseWriter, r *http.Request) {
	if a.sendMail == nil {
		httpx.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "ยังไม่ได้ตั้งค่าการส่งอีเมล กรุณาติดต่อผู้ดูแล"})
		return
	}
	var in struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpx.BadRequest(w, "invalid JSON body")
		return
	}
	email := normalizeEmail(in.Email)
	if !emailRe.MatchString(email) {
		httpx.BadRequest(w, "รูปแบบอีเมลไม่ถูกต้อง")
		return
	}
	sent := func() {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"message": forgotSent, "expires_in": int(otpTTL / time.Second)})
	}

	var uid int64
	err := a.db.QueryRowContext(r.Context(), `SELECT id FROM users WHERE email = ?`, email).Scan(&uid)
	if errors.Is(err, sql.ErrNoRows) {
		sent()
		return
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	now := time.Now()
	var last, lastHour int64
	if err := a.db.QueryRowContext(r.Context(), `
		SELECT COALESCE(MAX(created_at), 0), COUNT(*) FROM password_resets WHERE user_id = ? AND created_at > ?`,
		uid, now.Add(-time.Hour).Unix()).Scan(&last, &lastHour); err != nil {
		httpx.ServerError(w, err)
		return
	}
	// Too soon or too many: answer the same, send nothing.
	if now.Unix()-last < int64(otpResendAfter/time.Second) || lastHour >= otpPerHour {
		sent()
		return
	}
	code, err := randomDigits(6)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer tx.Rollback()
	// A new code replaces any earlier one.
	if _, err := tx.ExecContext(r.Context(), `UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0`, uid); err != nil {
		httpx.ServerError(w, err)
		return
	}
	if _, err := tx.ExecContext(r.Context(),
		`INSERT INTO password_resets (user_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		uid, string(hash), now.Add(otpTTL).Unix(), now.Unix()); err != nil {
		httpx.ServerError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.ServerError(w, err)
		return
	}
	// Send in the background so known and unknown addresses take the same time to answer.
	go func() {
		body := fmt.Sprintf("รหัสยืนยันสำหรับตั้งรหัสผ่านใหม่ของคุณคือ\n\n    %s\n\nใช้ได้ภายใน 3 นาที และใช้ได้ครั้งเดียว\nถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร รหัสผ่านของคุณยังเหมือนเดิม\n\n— รายรับรายจ่าย", code)
		if err := a.sendMail(email, "รหัสยืนยัน "+code+" — รายรับรายจ่าย", body); err != nil {
			logx.Logger.Printf("forgot password: %v", err)
		}
	}()
	sent()
}

func (a *API) verifyForgot(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpx.BadRequest(w, "invalid JSON body")
		return
	}
	invalid := func(msg string) {
		httpx.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": msg, "code": "invalid_code"})
	}
	const wrong = "รหัสไม่ถูกต้องหรือหมดอายุ กรุณาขอรหัสใหม่"
	now := time.Now()
	var resetID, uid int64
	var hash string
	var attempts int
	err := a.db.QueryRowContext(r.Context(), `
		SELECT pr.id, pr.user_id, pr.code_hash, pr.attempts FROM password_resets pr JOIN users u ON u.id = pr.user_id
		WHERE u.email = ? AND pr.used = 0 AND pr.expires_at > ? ORDER BY pr.id DESC LIMIT 1`,
		normalizeEmail(in.Email), now.Unix()).Scan(&resetID, &uid, &hash, &attempts)
	if errors.Is(err, sql.ErrNoRows) {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(in.Code))
		invalid(wrong)
		return
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(strings.TrimSpace(in.Code))) != nil {
		attempts++
		if _, err := a.db.ExecContext(r.Context(),
			`UPDATE password_resets SET attempts = ?, used = (? >= ?) WHERE id = ?`, attempts, attempts, otpMaxTries, resetID); err != nil {
			httpx.ServerError(w, err)
			return
		}
		if left := otpMaxTries - attempts; left > 0 {
			invalid(fmt.Sprintf("รหัสไม่ถูกต้อง (เหลืออีก %d ครั้ง)", left))
		} else {
			invalid(wrong)
		}
		return
	}

	temp, err := randomPassword(12)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	tempHash, err := bcrypt.GenerateFromPassword([]byte(temp), bcrypt.DefaultCost)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	expires := now.Add(tempPasswordTTL)
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `UPDATE password_resets SET used = 1 WHERE id = ?`, resetID); err != nil {
		httpx.ServerError(w, err)
		return
	}
	res, err := tx.ExecContext(r.Context(), `
		UPDATE identities SET temp_hash = ?, temp_expires = ?, failed_logins = 0, locked_until = 0
		WHERE user_id = ? AND provider = 'password'`, string(tempHash), expires.Unix(), uid)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		invalid("บัญชีนี้เข้าสู่ระบบด้วย Google ไม่มีรหัสผ่านให้ตั้งใหม่")
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.ServerError(w, err)
		return
	}
	u, err := a.fetchUser(r.Context(), uid)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"username":      u.Username,
		"temp_password": temp,
		"expires_at":    expires.Format(time.RFC3339),
	})
}

// setEmail changes the signed-in user's e-mail for password resets; it needs their password.
func (a *API) setEmail(w http.ResponseWriter, r *http.Request, s *session) {
	if !a.extendUnlock(w, r, s) {
		return
	}
	var in struct {
		Email    string `json:"email"`
		Password string `json:"current_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpx.BadRequest(w, "invalid JSON body")
		return
	}
	email := normalizeEmail(in.Email)
	if email != "" && !emailRe.MatchString(email) {
		httpx.BadRequest(w, "รูปแบบอีเมลไม่ถูกต้อง")
		return
	}
	var hash string
	err := a.db.QueryRowContext(r.Context(),
		`SELECT secret_hash FROM identities WHERE user_id = ? AND provider = 'password'`, s.userID).Scan(&hash)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		httpx.ServerError(w, err)
		return
	}
	if hash != "" && bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) != nil {
		authError(w, http.StatusUnauthorized, "bad_credentials", "รหัสผ่านปัจจุบันไม่ถูกต้อง")
		return
	}
	_, err = a.db.ExecContext(r.Context(), `UPDATE users SET email = ? WHERE id = ?`, email, s.userID)
	if isUniqueViolation(err) {
		httpx.WriteJSON(w, http.StatusConflict, map[string]string{"error": "อีเมลนี้มีบัญชีอื่นใช้อยู่แล้ว"})
		return
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func randomDigits(n int) (string, error) {
	b := make([]byte, n)
	for i := range b {
		k, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		b[i] = byte('0' + k.Int64())
	}
	return string(b), nil
}
