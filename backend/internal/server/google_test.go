package server

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

// fakeGoogle accepts tokens "tok-<sub>" for the client ID "cid".
func fakeGoogle(a *API) {
	a.googleClientID = "cid"
	a.verifyGoogle = func(_ context.Context, clientID, token string) (googleClaims, error) {
		if clientID != "cid" || len(token) < 5 || token[:4] != "tok-" {
			return googleClaims{}, errors.New("bad token")
		}
		return googleClaims{Sub: token[4:], Email: token[4:] + "@gmail.com", Name: "G " + token[4:], EmailVerified: "true", Aud: "cid"}, nil
	}
}

func TestGoogleSignIn(t *testing.T) {
	off, _ := newTestServer(t)
	if status, _ := off.do("POST", "/api/auth/google", "", map[string]string{"credential": "tok-1"}); status != http.StatusNotFound {
		t.Fatalf("google sign-in should be off without a client ID: %d", status)
	}
	if _, cfg := off.do("GET", "/api/auth/config", "", nil); cfg["google_client_id"] != "" {
		t.Fatalf("config: %v", cfg)
	}

	c, _ := newTestServer(t, fakeGoogle)
	// First Google user is a new user: takes over the old data, then sets a PIN.
	status, out := c.do("POST", "/api/auth/google", "", map[string]string{"credential": "tok-111"})
	if status != http.StatusCreated || out["user"].(map[string]any)["name"] != "G 111" {
		t.Fatalf("google sign-up: %d %v", status, out)
	}
	tok := out["token"].(string)
	c.do("POST", "/api/auth/pin", tok, map[string]string{"pin": "135790"})
	if _, m := c.do("GET", "/api/transactions?month=2026-11", tok, nil); len(m["items"].([]any)) != 1 {
		t.Fatalf("first google user should own the old data: %v", m)
	}
	// Same Google account again signs into the same user.
	if status, again := c.do("POST", "/api/auth/google", "", map[string]string{"credential": "tok-111"}); status != http.StatusOK || again["user"].(map[string]any)["has_pin"] != true {
		t.Fatalf("google sign-in again: %d %v", status, again)
	}
	if status, _ := c.do("POST", "/api/auth/google", "", map[string]string{"credential": "forged"}); status != http.StatusUnauthorized {
		t.Fatalf("bad token: %d", status)
	}

	// A password user links Google, then can sign in with it.
	pw := c.signedIn("pwuser")
	if status, _ := c.do("POST", "/api/auth/google/link", pw, map[string]string{"credential": "tok-222"}); status != http.StatusNoContent {
		t.Fatalf("link: %d", status)
	}
	if status, _ := c.do("POST", "/api/auth/google/link", pw, map[string]string{"credential": "tok-111"}); status != http.StatusConflict {
		t.Fatalf("linking someone else's Google account: %d", status)
	}
	_, linked := c.do("POST", "/api/auth/google", "", map[string]string{"credential": "tok-222"})
	if linked["user"].(map[string]any)["username"] != "pwuser" {
		t.Fatalf("linked sign-in should reach the password user: %v", linked)
	}
}
