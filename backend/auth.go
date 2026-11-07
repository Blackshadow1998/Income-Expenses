package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Sign-in model: a user signs in once (username + password now; Google later, as another row in
// identities), which gives a long-lived session token. The money data also needs the session to be
// "unlocked" with the user's 6-digit PIN, and it locks again after unlockTTL without use.
const (
	sessionTTL    = 30 * 24 * time.Hour // signed in for this long without use
	unlockTTL     = 5 * time.Minute     // PIN is asked again after this long without use
	maxPINTries   = 5                   // wrong PINs in a row before the session is signed out
	maxLoginTries = 5                   // wrong passwords in a row before the username is paused
	loginPause    = 5 * time.Minute
)

var (
	usernameRe = regexp.MustCompile(`^[a-z0-9._-]{3,32}$`)
	pinRe      = regexp.MustCompile(`^[0-9]{6}$`)
	// dummyHash keeps "unknown username" as slow as "wrong password", so usernames can't be probed by timing.
	dummyHash, _ = bcrypt.GenerateFromPassword([]byte("not-a-real-password"), bcrypt.DefaultCost)
)

type User struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Username string `json:"username"`
	HasPIN   bool   `json:"has_pin"`
}

type session struct {
	tokenHash     string
	userID        int64
	unlockedUntil int64 // unix seconds
	createdAt     int64 // unix seconds, i.e. when the password was last entered
	pinFailures   int
	pinHash       string // the user's PIN; empty until it is set
}

type sessionHandler func(http.ResponseWriter, *http.Request, *session)

type ctxKey struct{}

// userID is the signed-in user of a request that went through requireUnlocked.
func userID(r *http.Request) int64 {
	id, _ := r.Context().Value(ctxKey{}).(int64)
	return id
}

// authError responses carry a code the app acts on: unauthenticated (show sign-in),
// pin_required (set a PIN first), locked (ask for the PIN), wrong_pin, bad_credentials.
func authError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]string{"error": msg, "code": code})
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// loadSession returns the session of the request's bearer token, or nil when there is none or it expired.
func (a *API) loadSession(r *http.Request) (*session, error) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || token == "" {
		return nil, nil
	}
	s := &session{tokenHash: hashToken(token)}
	err := a.db.QueryRowContext(r.Context(), `
		SELECT s.user_id, s.unlocked_until, CAST(strftime('%s', s.created_at) AS INTEGER), s.pin_failures, u.pin_hash
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, s.tokenHash, time.Now().Unix(),
	).Scan(&s.userID, &s.unlockedUntil, &s.createdAt, &s.pinFailures, &s.pinHash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return s, err
}

// withSession lets a request through with any valid session, locked or not.
func (a *API) withSession(h sessionHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s, err := a.loadSession(r)
		if err != nil {
			serverError(w, err)
			return
		}
		if s == nil {
			authError(w, http.StatusUnauthorized, "unauthenticated", "กรุณาเข้าสู่ระบบ")
			return
		}
		h(w, r, s)
	}
}

// requireUnlocked guards the money data: a valid session unlocked with the PIN within unlockTTL.
func (a *API) requireUnlocked(h http.HandlerFunc) http.HandlerFunc {
	return a.withSession(func(w http.ResponseWriter, r *http.Request, s *session) {
		if s.pinHash == "" {
			authError(w, http.StatusForbidden, "pin_required", "กรุณาตั้ง PIN ก่อนใช้งาน")
			return
		}
		if !a.extendUnlock(w, r, s) {
			return
		}
		h(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, s.userID)))
	})
}

// extendUnlock refuses a locked session; otherwise each use pushes both the idle lock and the session expiry forward.
func (a *API) extendUnlock(w http.ResponseWriter, r *http.Request, s *session) bool {
	now := time.Now()
	if now.Unix() >= s.unlockedUntil {
		authError(w, http.StatusUnauthorized, "locked", "กรุณาใส่ PIN")
		return false
	}
	if err := a.markUnlocked(r.Context(), s, now); err != nil {
		serverError(w, err)
		return false
	}
	return true
}

func (a *API) markUnlocked(ctx context.Context, s *session, now time.Time) error {
	_, err := a.db.ExecContext(ctx,
		`UPDATE sessions SET unlocked_until = ?, expires_at = ? WHERE token_hash = ?`,
		now.Add(unlockTTL).Unix(), now.Add(sessionTTL).Unix(), s.tokenHash)
	return err
}

type credentials struct {
	Name     string `json:"name"` // display name, sign-up only
	Username string `json:"username"`
	Password string `json:"password"`
}

func decodeCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	var in credentials
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		badRequest(w, "invalid JSON body")
		return in, false
	}
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	in.Name = strings.TrimSpace(in.Name)
	return in, true
}

func (a *API) signup(w http.ResponseWriter, r *http.Request) {
	in, ok := decodeCredentials(w, r)
	if !ok {
		return
	}
	if !usernameRe.MatchString(in.Username) {
		badRequest(w, "ชื่อผู้ใช้ต้องยาว 3–32 ตัว ใช้ได้เฉพาะ a-z 0-9 . _ -")
		return
	}
	if n := len(in.Password); n < 8 || n > 72 {
		badRequest(w, "รหัสผ่านต้องยาว 8–72 ตัวอักษร")
		return
	}
	if in.Name == "" {
		in.Name = in.Username
	}
	if len([]rune(in.Name)) > 50 {
		badRequest(w, "ชื่อที่แสดงยาวเกิน 50 ตัวอักษร")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		serverError(w, err)
		return
	}

	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()
	var taken bool
	if err := tx.QueryRowContext(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM identities WHERE provider = 'password' AND subject = ?)`, in.Username,
	).Scan(&taken); err != nil {
		serverError(w, err)
		return
	}
	if taken {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "ชื่อผู้ใช้นี้มีคนใช้แล้ว"})
		return
	}
	uid, err := newUser(r.Context(), tx, in.Name)
	if err != nil {
		serverError(w, err)
		return
	}
	if _, err := tx.ExecContext(r.Context(),
		`INSERT INTO identities (user_id, provider, subject, secret_hash) VALUES (?, 'password', ?, ?)`,
		uid, in.Username, string(hash)); err != nil {
		serverError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	a.startSession(w, r, uid, http.StatusCreated)
}

// newUser creates a user (any sign-in method). The first user takes over the data recorded before
// sign-in existed; anyone without an item list gets the starter one.
func newUser(ctx context.Context, tx *sql.Tx, name string) (int64, error) {
	res, err := tx.ExecContext(ctx, `INSERT INTO users (name) VALUES (?)`, name)
	if err != nil {
		return 0, err
	}
	uid, _ := res.LastInsertId()
	var users int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&users); err != nil {
		return 0, err
	}
	if users == 1 {
		for _, table := range []string{"accounts", "transactions", "slips", "subcategories"} {
			if _, err := tx.ExecContext(ctx, `UPDATE `+table+` SET user_id = ? WHERE user_id IS NULL`, uid); err != nil {
				return 0, err
			}
		}
	}
	var items int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM subcategories WHERE user_id = ?`, uid).Scan(&items); err != nil {
		return 0, err
	}
	if items == 0 {
		if _, err := tx.ExecContext(ctx, starterSubcategories, uid); err != nil {
			return 0, err
		}
	}
	return uid, nil
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	in, ok := decodeCredentials(w, r)
	if !ok {
		return
	}
	var identityID, uid, lockedUntil int64
	var hash string
	var failed int
	err := a.db.QueryRowContext(r.Context(), `
		SELECT id, user_id, secret_hash, failed_logins, locked_until
		FROM identities WHERE provider = 'password' AND subject = ?`, in.Username,
	).Scan(&identityID, &uid, &hash, &failed, &lockedUntil)
	if errors.Is(err, sql.ErrNoRows) {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(in.Password))
		authError(w, http.StatusUnauthorized, "bad_credentials", "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	now := time.Now()
	if lockedUntil > now.Unix() {
		mins := (lockedUntil - now.Unix() + 59) / 60
		writeJSON(w, http.StatusTooManyRequests, map[string]string{
			"error": fmt.Sprintf("ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ %d นาทีแล้วลองใหม่", mins),
		})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) != nil {
		failed++
		var until int64
		if failed >= maxLoginTries {
			failed, until = 0, now.Add(loginPause).Unix()
		}
		if _, err := a.db.ExecContext(r.Context(),
			`UPDATE identities SET failed_logins = ?, locked_until = ? WHERE id = ?`, failed, until, identityID); err != nil {
			serverError(w, err)
			return
		}
		authError(w, http.StatusUnauthorized, "bad_credentials", "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
		return
	}
	if _, err := a.db.ExecContext(r.Context(),
		`UPDATE identities SET failed_logins = 0, locked_until = 0 WHERE id = ?`, identityID); err != nil {
		serverError(w, err)
		return
	}
	a.startSession(w, r, uid, http.StatusOK)
}

// startSession issues a new bearer token (only its hash is stored) that starts out unlocked.
func (a *API) startSession(w http.ResponseWriter, r *http.Request, uid int64, status int) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		serverError(w, err)
		return
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	now := time.Now()
	if _, err := a.db.ExecContext(r.Context(), `DELETE FROM sessions WHERE expires_at <= ?`, now.Unix()); err != nil {
		serverError(w, err)
		return
	}
	if _, err := a.db.ExecContext(r.Context(),
		`INSERT INTO sessions (token_hash, user_id, expires_at, unlocked_until) VALUES (?, ?, ?, ?)`,
		hashToken(token), uid, now.Add(sessionTTL).Unix(), now.Add(unlockTTL).Unix()); err != nil {
		serverError(w, err)
		return
	}
	u, err := a.fetchUser(r.Context(), uid)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, status, map[string]any{"token": token, "user": u})
}

func (a *API) fetchUser(ctx context.Context, id int64) (User, error) {
	var u User
	err := a.db.QueryRowContext(ctx, `
		SELECT u.id, u.name, COALESCE(i.subject, ''), u.pin_hash <> ''
		FROM users u LEFT JOIN identities i ON i.user_id = u.id AND i.provider = 'password'
		WHERE u.id = ?`, id).Scan(&u.ID, &u.Name, &u.Username, &u.HasPIN)
	return u, err
}

func (a *API) me(w http.ResponseWriter, r *http.Request, s *session) {
	u, err := a.fetchUser(r.Context(), s.userID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u, "locked": time.Now().Unix() >= s.unlockedUntil})
}

type pinInput struct {
	PIN        string `json:"pin"`
	CurrentPIN string `json:"current_pin"` // when changing an existing PIN
}

func (a *API) unlock(w http.ResponseWriter, r *http.Request, s *session) {
	var in pinInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		badRequest(w, "invalid JSON body")
		return
	}
	if s.pinHash == "" {
		authError(w, http.StatusForbidden, "pin_required", "กรุณาตั้ง PIN ก่อนใช้งาน")
		return
	}
	if !a.checkPIN(w, r, s, in.PIN) {
		return
	}
	if err := a.markUnlocked(r.Context(), s, time.Now()); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// checkPIN compares pin with the user's PIN. Wrong PINs count against the session; after
// maxPINTries in a row it is signed out, so guessing needs the password again.
func (a *API) checkPIN(w http.ResponseWriter, r *http.Request, s *session, pin string) bool {
	if bcrypt.CompareHashAndPassword([]byte(s.pinHash), []byte(pin)) == nil {
		if s.pinFailures > 0 {
			if _, err := a.db.ExecContext(r.Context(), `UPDATE sessions SET pin_failures = 0 WHERE token_hash = ?`, s.tokenHash); err != nil {
				serverError(w, err)
				return false
			}
		}
		return true
	}
	left := maxPINTries - s.pinFailures - 1
	if left <= 0 {
		if _, err := a.db.ExecContext(r.Context(), `DELETE FROM sessions WHERE token_hash = ?`, s.tokenHash); err != nil {
			serverError(w, err)
			return false
		}
		authError(w, http.StatusUnauthorized, "unauthenticated",
			"ใส่ PIN ผิด "+strconv.Itoa(maxPINTries)+" ครั้ง กรุณาเข้าสู่ระบบด้วยรหัสผ่านอีกครั้ง")
		return false
	}
	if _, err := a.db.ExecContext(r.Context(),
		`UPDATE sessions SET pin_failures = pin_failures + 1 WHERE token_hash = ?`, s.tokenHash); err != nil {
		serverError(w, err)
		return false
	}
	writeJSON(w, http.StatusUnauthorized, map[string]any{
		"error":         fmt.Sprintf("PIN ไม่ถูกต้อง (เหลืออีก %d ครั้ง)", left),
		"code":          "wrong_pin",
		"attempts_left": left,
	})
	return false
}

// setPIN sets the first PIN (right after sign-up/sign-in) or changes it. Changing needs the current
// PIN, except within unlockTTL of signing in with the password, which is how a forgotten PIN is reset.
func (a *API) setPIN(w http.ResponseWriter, r *http.Request, s *session) {
	var in pinInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		badRequest(w, "invalid JSON body")
		return
	}
	if s.pinHash != "" {
		if !a.extendUnlock(w, r, s) {
			return
		}
		justSignedIn := time.Now().Unix()-s.createdAt < int64(unlockTTL/time.Second)
		if (in.CurrentPIN != "" || !justSignedIn) && !a.checkPIN(w, r, s, in.CurrentPIN) {
			return
		}
	}
	if !pinRe.MatchString(in.PIN) {
		badRequest(w, "PIN ต้องเป็นตัวเลข 6 หลัก")
		return
	}
	if weakPIN(in.PIN) {
		badRequest(w, "PIN ง่ายเกินไป (เช่น 000000, 123456) กรุณาเลือกใหม่")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.PIN), bcrypt.DefaultCost)
	if err != nil {
		serverError(w, err)
		return
	}
	if _, err := a.db.ExecContext(r.Context(), `UPDATE users SET pin_hash = ? WHERE id = ?`, string(hash), s.userID); err != nil {
		serverError(w, err)
		return
	}
	if err := a.markUnlocked(r.Context(), s, time.Now()); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// weakPIN rejects one repeated digit and straight runs like 123456 or 987654.
func weakPIN(p string) bool {
	same, up, down := true, true, true
	for i := 1; i < len(p); i++ {
		same = same && p[i] == p[0]
		up = up && p[i] == p[i-1]+1
		down = down && p[i] == p[i-1]-1
	}
	return same || up || down
}

func (a *API) lock(w http.ResponseWriter, r *http.Request, s *session) {
	if _, err := a.db.ExecContext(r.Context(), `UPDATE sessions SET unlocked_until = 0 WHERE token_hash = ?`, s.tokenHash); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) logout(w http.ResponseWriter, r *http.Request, s *session) {
	if _, err := a.db.ExecContext(r.Context(), `DELETE FROM sessions WHERE token_hash = ?`, s.tokenHash); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// slipImageURL is a signed, short-lived link to a slip image: <Image>/<img> tags can't send the
// Authorization header. The expiry is rounded to the hour so the URL (and browser cache) stays stable.
func (a *API) slipImageURL(id int64) string {
	exp := time.Now().Truncate(time.Hour).Add(2 * time.Hour).Unix()
	return fmt.Sprintf("/api/slips/%d/image?exp=%d&sig=%s", id, exp, a.signImage(id, exp))
}

func (a *API) signImage(id, exp int64) string {
	m := hmac.New(sha256.New, a.imageKey)
	fmt.Fprintf(m, "%d.%d", id, exp)
	return hex.EncodeToString(m.Sum(nil))
}

func (a *API) validImageSig(r *http.Request, id int64) bool {
	exp, err := strconv.ParseInt(r.URL.Query().Get("exp"), 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}
	return hmac.Equal([]byte(r.URL.Query().Get("sig")), []byte(a.signImage(id, exp)))
}
