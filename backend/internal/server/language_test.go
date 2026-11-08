package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

// Error messages follow Accept-Language through the whole API; status codes and the other
// fields stay the same, and a request without the header gets Thai as before.
func TestErrorsFollowAcceptLanguage(t *testing.T) {
	c, _ := newTestServer(t)
	token := c.SignedIn("polyglot")

	do := func(method, path, token, lang string, body any) (int, map[string]any) {
		t.Helper()
		data, _ := json.Marshal(body)
		req, _ := http.NewRequest(method, c.URL+path, bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if lang != "" {
			req.Header.Set("Accept-Language", lang)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		out := map[string]any{}
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}

	login := map[string]string{"username": "polyglot", "password": "not-the-password"}
	budget := map[string]any{"category_id": 2, "amount": 0}
	for _, c := range []struct {
		lang, login, budget string
	}{
		{"en", "Wrong username or password", "The amount must be greater than 0"},
		{"en-GB,en;q=0.9", "Wrong username or password", "The amount must be greater than 0"},
		{"th", "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", "จำนวนเงินต้องมากกว่า 0"},
		{"", "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", "จำนวนเงินต้องมากกว่า 0"},
	} {
		if status, out := do("POST", "/api/auth/login", "", c.lang, login); status != http.StatusUnauthorized ||
			out["error"] != c.login || out["code"] != "bad_credentials" {
			t.Errorf("login %q: %d %v", c.lang, status, out)
		}
		if status, out := do("POST", "/api/budgets", token, c.lang, budget); status != http.StatusBadRequest || out["error"] != c.budget {
			t.Errorf("budget %q: %d %v", c.lang, status, out)
		}
	}

	// English-only messages are unchanged in both languages.
	for _, lang := range []string{"en", "th"} {
		if status, out := do("GET", "/api/no-such-route", token, lang, nil); status != http.StatusNotFound || out["error"] != "not found" {
			t.Errorf("not found %q: %d %v", lang, status, out)
		}
	}
}
