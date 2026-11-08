// Package apitest holds the helpers the HTTP API tests share: a JSON client for a test server and
// a fresh database. It is only imported by _test files.
package apitest

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"income-expenses/internal/database"
)

type Client struct {
	T   *testing.T
	URL string // the test server, e.g. http://127.0.0.1:1234
}

// Serve starts h on a test server that closes when the test ends.
func Serve(t *testing.T, h http.Handler) Client {
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return Client{T: t, URL: srv.URL}
}

// OpenDB opens an up-to-date database in a temporary folder and returns it with that folder
// (handy as the images folder).
func OpenDB(t *testing.T) (*sql.DB, string) {
	t.Helper()
	dir := t.TempDir()
	db, err := database.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db, dir
}

func (c Client) Do(method, path, token string, body any) (int, map[string]any) {
	out := map[string]any{}
	status := c.DoInto(method, path, token, body, &out)
	return status, out
}

// DoInto decodes the response body into out (e.g. a slice for list endpoints).
func (c Client) DoInto(method, path, token string, body, out any) int {
	c.T.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, c.URL+path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.T.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	_ = json.NewDecoder(res.Body).Decode(out)
	return res.StatusCode
}

// SignedIn signs up a user, sets a PIN and returns the session token.
func (c Client) SignedIn(username string) string {
	c.T.Helper()
	status, out := c.Do("POST", "/api/auth/signup", "", map[string]string{"username": username, "password": "password-" + username})
	if status != http.StatusCreated {
		c.T.Fatalf("signup %s: %d %v", username, status, out)
	}
	token := out["token"].(string)
	if status, out := c.Do("POST", "/api/auth/pin", token, map[string]string{"pin": "135790"}); status != http.StatusNoContent {
		c.T.Fatalf("set pin: %d %v", status, out)
	}
	return token
}
