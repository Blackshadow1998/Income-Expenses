package auth

import (
	"context"
	"net/http"
	"testing"
)

func TestResetAndChangePassword(t *testing.T) {
	c, db := newTestServer(t)
	token := c.SignedIn("forgetful")

	// Pause the username with wrong passwords first; the reset must clear that too.
	for i := 0; i < maxLoginTries; i++ {
		c.Do("POST", "/api/auth/login", "", map[string]string{"username": "forgetful", "password": "nope-nope"})
	}
	temp, err := ResetPassword(context.Background(), db, "Forgetful")
	if err != nil || len(temp) != 12 {
		t.Fatalf("reset: %q %v", temp, err)
	}
	if status, _ := c.Do("GET", "/api/auth/me", token, nil); status != http.StatusUnauthorized {
		t.Fatalf("old session should be signed out, got %d", status)
	}
	status, out := c.Do("POST", "/api/auth/login", "", map[string]string{"username": "forgetful", "password": temp})
	if status != http.StatusOK {
		t.Fatalf("login with temporary password: %d %v", status, out)
	}
	token = out["token"].(string)

	if status, _ := c.Do("POST", "/api/auth/password", token, map[string]string{"current_password": "wrong-one", "new_password": "brand-new-pass"}); status != http.StatusUnauthorized {
		t.Fatalf("change with wrong current password: %d", status)
	}
	if status, _ := c.Do("POST", "/api/auth/password", token, map[string]string{"current_password": temp, "new_password": "short"}); status != http.StatusBadRequest {
		t.Fatalf("too-short new password: %d", status)
	}
	if status, _ := c.Do("POST", "/api/auth/password", token, map[string]string{"current_password": temp, "new_password": "brand-new-pass"}); status != http.StatusNoContent {
		t.Fatalf("change password: %d", status)
	}
	if status, _ := c.Do("POST", "/api/auth/login", "", map[string]string{"username": "forgetful", "password": "brand-new-pass"}); status != http.StatusOK {
		t.Fatalf("login with new password: %d", status)
	}

	if _, err := ResetPassword(context.Background(), db, "nobody"); err == nil {
		t.Fatal("unknown username should fail")
	}
}
