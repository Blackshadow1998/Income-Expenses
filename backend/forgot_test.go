package main

import (
	"net/http"
	"regexp"
	"sync"
	"testing"
	"time"
)

// mailbox captures e-mails instead of sending them.
type mailbox struct {
	mu   sync.Mutex
	sent []struct{ to, subject, body string }
}

func (m *mailbox) send(to, subject, body string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, struct{ to, subject, body string }{to, subject, body})
	return nil
}

// lastCode waits for the background send and returns the newest code e-mailed to `to`.
func (m *mailbox) lastCode(t *testing.T, to string, count int) string {
	t.Helper()
	for i := 0; i < 50; i++ {
		m.mu.Lock()
		n := len(m.sent)
		var code string
		if n >= count && m.sent[n-1].to == to {
			code = regexp.MustCompile(`\d{6}`).FindString(m.sent[n-1].body)
		}
		m.mu.Unlock()
		if code != "" {
			return code
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no code e-mailed to %s", to)
	return ""
}

func TestForgotPasswordByEmail(t *testing.T) {
	box := &mailbox{}
	c, db := newTestServer(t, func(a *API) { a.sendMail = box.send })
	status, out := c.do("POST", "/api/auth/signup", "", map[string]string{
		"username": "forgetful", "password": "old-password", "email": " Me@Example.com ",
	})
	if status != http.StatusCreated || out["user"].(map[string]any)["email"] != "me@example.com" {
		t.Fatalf("signup with email: %d %v", status, out)
	}
	oldToken := out["token"].(string)
	c.do("POST", "/api/auth/pin", oldToken, map[string]string{"pin": "135790"})

	// Unknown and known addresses get the same answer; only the known one gets mail.
	_, unknown := c.do("POST", "/api/auth/forgot", "", map[string]string{"email": "nobody@example.com"})
	status, known := c.do("POST", "/api/auth/forgot", "", map[string]string{"email": "ME@example.com"})
	if status != http.StatusOK || unknown["message"] != known["message"] {
		t.Fatalf("answers differ: %v vs %v", unknown, known)
	}
	code := box.lastCode(t, "me@example.com", 1)

	// Asking again within a minute sends nothing new.
	c.do("POST", "/api/auth/forgot", "", map[string]string{"email": "me@example.com"})
	time.Sleep(100 * time.Millisecond)
	if len(box.sent) != 1 {
		t.Fatalf("resend within 60s should not mail, sent %d", len(box.sent))
	}

	if status, out := c.do("POST", "/api/auth/forgot/verify", "", map[string]string{"email": "me@example.com", "code": "000000"}); status != http.StatusBadRequest || out["code"] != "invalid_code" {
		t.Fatalf("wrong code: %d %v", status, out)
	}
	status, res := c.do("POST", "/api/auth/forgot/verify", "", map[string]string{"email": "me@example.com", "code": code})
	if status != http.StatusOK || res["username"] != "forgetful" || len(res["temp_password"].(string)) != 12 {
		t.Fatalf("verify: %d %v", status, res)
	}
	temp := res["temp_password"].(string)
	if status, _ := c.do("POST", "/api/auth/forgot/verify", "", map[string]string{"email": "me@example.com", "code": code}); status != http.StatusBadRequest {
		t.Fatalf("a code works only once, got %d", status)
	}

	// Signing in with the temporary password only allows changing the password.
	status, out = c.do("POST", "/api/auth/login", "", map[string]string{"username": "forgetful", "password": temp})
	if status != http.StatusOK || out["must_change_password"] != true {
		t.Fatalf("temp login: %d %v", status, out)
	}
	tok := out["token"].(string)
	if status, out := c.do("GET", "/api/accounts", tok, nil); status != http.StatusForbidden || out["code"] != "password_change_required" {
		t.Fatalf("data with temp session: %d %v", status, out)
	}
	if status, _ := c.do("POST", "/api/auth/password", tok, map[string]string{"current_password": temp, "new_password": "brand-new-pass"}); status != http.StatusNoContent {
		t.Fatalf("change from temp: %d", status)
	}
	if status, _ := c.do("GET", "/api/accounts", tok, nil); status != http.StatusOK {
		t.Fatalf("after change: %d", status)
	}
	if status, _ := c.do("POST", "/api/auth/login", "", map[string]string{"username": "forgetful", "password": temp}); status != http.StatusUnauthorized {
		t.Fatalf("temp password must stop working after the change: %d", status)
	}

	// An expired temporary password doesn't work.
	db.Exec(`UPDATE password_resets SET created_at = created_at - 3600`)
	c.do("POST", "/api/auth/forgot", "", map[string]string{"email": "me@example.com"})
	code = box.lastCode(t, "me@example.com", 2)
	_, res = c.do("POST", "/api/auth/forgot/verify", "", map[string]string{"email": "me@example.com", "code": code})
	db.Exec(`UPDATE identities SET temp_expires = 1`)
	if status, _ := c.do("POST", "/api/auth/login", "", map[string]string{"username": "forgetful", "password": res["temp_password"].(string)}); status != http.StatusUnauthorized {
		t.Fatalf("expired temp password: %d", status)
	}
}

func TestForgotCodeExpiresAndLimitsTries(t *testing.T) {
	box := &mailbox{}
	c, db := newTestServer(t, func(a *API) { a.sendMail = box.send })
	c.do("POST", "/api/auth/signup", "", map[string]string{"username": "someone", "password": "some-password", "email": "s@example.com"})

	c.do("POST", "/api/auth/forgot", "", map[string]string{"email": "s@example.com"})
	code := box.lastCode(t, "s@example.com", 1)
	for i := 0; i < otpMaxTries; i++ {
		c.do("POST", "/api/auth/forgot/verify", "", map[string]string{"email": "s@example.com", "code": "999999"})
	}
	if status, _ := c.do("POST", "/api/auth/forgot/verify", "", map[string]string{"email": "s@example.com", "code": code}); status != http.StatusBadRequest {
		t.Fatalf("code must be dead after %d wrong tries, got %d", otpMaxTries, status)
	}

	db.Exec(`UPDATE password_resets SET created_at = created_at - 120`)
	c.do("POST", "/api/auth/forgot", "", map[string]string{"email": "s@example.com"})
	code = box.lastCode(t, "s@example.com", 2)
	db.Exec(`UPDATE password_resets SET expires_at = 1`) // 3 minutes are up
	if status, _ := c.do("POST", "/api/auth/forgot/verify", "", map[string]string{"email": "s@example.com", "code": code}); status != http.StatusBadRequest {
		t.Fatalf("expired code accepted: %d", status)
	}

	off, _ := newTestServer(t)
	if status, _ := off.do("POST", "/api/auth/forgot", "", map[string]string{"email": "s@example.com"}); status != http.StatusServiceUnavailable {
		t.Fatalf("no SMTP configured: %d", status)
	}
}
