package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"income-expenses/internal/httpx"
	"income-expenses/internal/logx"
)

// Google sign-in (identities.provider = 'google', subject = Google account id). Off unless
// GOOGLE_CLIENT_ID is set. The web app gets an ID token from Google Identity Services and the
// server checks it with Google's tokeninfo endpoint.

type googleClaims struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified string `json:"email_verified"`
	Name          string `json:"name"`
	Aud           string `json:"aud"`
}

var googleHTTP = &http.Client{Timeout: 10 * time.Second}

// verifyGoogleToken asks Google whether the ID token is valid; the audience must be our client ID.
func verifyGoogleToken(ctx context.Context, clientID, idToken string) (googleClaims, error) {
	var c googleClaims
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://oauth2.googleapis.com/tokeninfo?id_token="+url.QueryEscape(idToken), nil)
	if err != nil {
		return c, err
	}
	res, err := googleHTTP.Do(req)
	if err != nil {
		return c, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return c, fmt.Errorf("google rejected the token (%d)", res.StatusCode)
	}
	if err := json.NewDecoder(res.Body).Decode(&c); err != nil {
		return c, err
	}
	if c.Aud != clientID || c.Sub == "" {
		return c, errors.New("token is for another app")
	}
	if c.EmailVerified != "true" {
		return c, errors.New("email not verified")
	}
	return c, nil
}

// authConfig tells the app which optional sign-in methods are on.
func (a *Service) authConfig(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"google_client_id": a.googleClientID})
}

func (a *Service) googleClaimsFrom(w http.ResponseWriter, r *http.Request) (googleClaims, bool) {
	if a.googleClientID == "" {
		httpx.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "ยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วย Google"})
		return googleClaims{}, false
	}
	var in struct {
		Credential string `json:"credential"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Credential == "" {
		httpx.BadRequest(w, "credential is required")
		return googleClaims{}, false
	}
	c, err := a.verifyGoogle(r.Context(), a.googleClientID, in.Credential)
	if err != nil {
		logx.Logger.Printf("google sign-in: %v", err)
		authError(w, http.StatusUnauthorized, "bad_credentials", "ยืนยันตัวตนกับ Google ไม่สำเร็จ")
		return c, false
	}
	return c, true
}

// googleSignIn signs in the user linked to the Google account, or creates a new user for it
// (the same as signing up, then they set a PIN).
func (a *Service) googleSignIn(w http.ResponseWriter, r *http.Request) {
	c, ok := a.googleClaimsFrom(w, r)
	if !ok {
		return
	}
	var uid int64
	err := a.db.QueryRowContext(r.Context(),
		`SELECT user_id FROM identities WHERE provider = 'google' AND subject = ?`, c.Sub).Scan(&uid)
	if errors.Is(err, sql.ErrNoRows) {
		tx, err := a.db.BeginTx(r.Context(), nil)
		if err != nil {
			httpx.ServerError(w, err)
			return
		}
		defer tx.Rollback()
		name := c.Name
		if name == "" {
			name = c.Email
		}
		if uid, err = newUser(r.Context(), tx, name); err == nil {
			_, err = tx.ExecContext(r.Context(),
				`INSERT INTO identities (user_id, provider, subject) VALUES (?, 'google', ?)`, uid, c.Sub)
		}
		if err == nil { // Google already verified this address; keep it for "forgot password" unless taken.
			_, err = tx.ExecContext(r.Context(),
				`UPDATE users SET email = ?1 WHERE id = ?2 AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?1)`,
				normalizeEmail(c.Email), uid)
		}
		if err == nil {
			err = tx.Commit()
		}
		if err != nil {
			httpx.ServerError(w, err)
			return
		}
		a.startSession(w, r, uid, http.StatusCreated, false)
		return
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	a.startSession(w, r, uid, http.StatusOK, false)
}

// linkGoogle adds Google sign-in to the signed-in (unlocked) user.
func (a *Service) linkGoogle(w http.ResponseWriter, r *http.Request, s *session) {
	if !a.extendUnlock(w, r, s) {
		return
	}
	c, ok := a.googleClaimsFrom(w, r)
	if !ok {
		return
	}
	var owner int64
	err := a.db.QueryRowContext(r.Context(),
		`SELECT user_id FROM identities WHERE provider = 'google' AND subject = ?`, c.Sub).Scan(&owner)
	switch {
	case err == nil && owner == s.userID:
		w.WriteHeader(http.StatusNoContent)
		return
	case err == nil:
		httpx.WriteJSON(w, http.StatusConflict, map[string]string{"error": "บัญชี Google นี้ผูกกับผู้ใช้อื่นอยู่แล้ว"})
		return
	case !errors.Is(err, sql.ErrNoRows):
		httpx.ServerError(w, err)
		return
	}
	if _, err := a.db.ExecContext(r.Context(), `
		INSERT INTO identities (user_id, provider, subject) VALUES (?, 'google', ?)
		ON CONFLICT (provider, subject) DO NOTHING`, s.userID, c.Sub); err != nil {
		httpx.ServerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
