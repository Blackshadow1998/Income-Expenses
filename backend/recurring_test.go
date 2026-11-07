package main

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestOccurrenceDates(t *testing.T) {
	day := func(s string) time.Time { d, _ := time.ParseInLocation("2006-01-02", s, time.Local); return d }
	cases := []struct {
		from string
		day  int
		want string
	}{
		{"2026-11-07", 7, "2026-11-07"},  // today counts
		{"2026-11-07", 5, "2026-12-05"},  // already passed this month
		{"2026-11-07", 31, "2026-11-30"}, // clamped to the month's last day
		{"2027-02-10", 30, "2027-02-28"},
		{"2026-12-20", 3, "2027-01-03"},
	}
	for _, c := range cases {
		if got := firstOccurrence(day(c.from), c.day).Format("2006-01-02"); got != c.want {
			t.Errorf("firstOccurrence(%s, %d) = %s, want %s", c.from, c.day, got, c.want)
		}
	}
}

func TestRecurringCreatesTransactions(t *testing.T) {
	c, db := newTestServer(t)
	owner := c.signedIn("owner")

	// Catch-up: a rule last due in August creates Aug 31, Sep 30 and Oct 31 by Nov 7.
	if _, err := db.Exec(`INSERT INTO recurring (user_id, day_of_month, category_id, account_id, amount_satang, note, next_date)
		VALUES (1, 31, 2, 1, 10000, 'ค่าเน็ต', '2026-08-31')`); err != nil {
		t.Fatal(err)
	}
	n, err := createDueRecurring(context.Background(), db, time.Date(2026, 11, 7, 12, 0, 0, 0, time.Local))
	if err != nil || n != 3 {
		t.Fatalf("catch-up created %d, %v; want 3", n, err)
	}
	var next string
	db.QueryRow(`SELECT next_date FROM recurring WHERE id = 1`).Scan(&next)
	if next != "2026-11-30" {
		t.Fatalf("next_date = %s, want 2026-11-30", next)
	}
	_, oct := c.do("GET", "/api/transactions?month=2026-10", owner, nil)
	items := oct["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["recurring_id"].(float64) != 1 || items[0].(map[string]any)["date"] != "2026-10-31" {
		t.Fatalf("October recurring transaction: %v", items)
	}

	// Through the API a rule for today's day of month creates today's transaction at once.
	today := time.Now()
	status, out := c.do("POST", "/api/recurring", owner, map[string]any{
		"day": today.Day(), "category_id": 1, "account_id": 1, "amount": 500, "note": "เงินปันผล",
	})
	if status != http.StatusCreated || out["created_transactions"].(float64) < 1 {
		t.Fatalf("create rule: %d %v", status, out)
	}
	var rules []map[string]any
	c.doInto("GET", "/api/recurring", owner, nil, &rules)
	if len(rules) != 2 || rules[0]["account_label"] == "" {
		t.Fatalf("rules: %v", rules)
	}

	other := c.signedIn("other")
	if status, _ := c.do("POST", "/api/recurring", other, map[string]any{"day": 1, "category_id": 2, "account_id": 1, "amount": 1}); status != http.StatusBadRequest {
		t.Fatalf("rule on someone else's account: %d", status)
	}
	if status, _ := c.do("DELETE", "/api/recurring/1", other, nil); status != http.StatusNotFound {
		t.Fatalf("deleting someone else's rule: %d", status)
	}

	// Pausing then deleting keeps the transactions already created.
	if status, _ := c.do("PUT", "/api/recurring/1", owner, map[string]any{"day": 31, "category_id": 2, "account_id": 1, "amount": 100, "active": false}); status != http.StatusOK {
		t.Fatalf("pause rule: %d", status)
	}
	if status, _ := c.do("DELETE", "/api/recurring/1", owner, nil); status != http.StatusNoContent {
		t.Fatalf("delete rule: %d", status)
	}
	_, oct = c.do("GET", "/api/transactions?month=2026-10", owner, nil)
	if items := oct["items"].([]any); len(items) != 1 || items[0].(map[string]any)["recurring_id"] != nil {
		t.Fatalf("transaction should stay, untagged: %v", items)
	}
}
