package server

import (
	"net/http"
	"testing"
)

func TestDebtsPerPerson(t *testing.T) {
	c, db := newTestServer(t)
	owner := c.SignedIn("owner")
	ids := map[string]float64{}
	var cats []map[string]any
	c.DoInto("GET", "/api/categories", owner, nil, &cats)
	for _, cat := range cats {
		ids[cat["code"].(string)] = cat["id"].(float64)
	}
	if ids["lend_return"] == 0 || ids["borrow_repay"] == 0 {
		t.Fatalf("repayment categories missing: %v", ids)
	}
	add := func(code, payee string, amount float64, date string) {
		if status, out := c.Do("POST", "/api/transactions", owner, map[string]any{
			"date": date, "category_id": ids[code], "account_id": 1, "amount": amount, "payee": payee,
		}); status != http.StatusCreated {
			t.Fatalf("add %s: %d %v", code, status, out)
		}
	}
	add("lend", "บอส", 1000, "2026-11-01")
	add("lend_return", " บอส ", 400, "2026-11-03")
	add("borrow", "แม่", 2000, "2026-11-02")
	add("borrow_repay", "แม่", 2000, "2026-11-04")

	var debts []map[string]any
	c.DoInto("GET", "/api/debts", owner, nil, &debts)
	byPerson := map[string]map[string]any{}
	for _, d := range debts {
		byPerson[d["person"].(string)] = d
	}
	if d := byPerson["บอส"]; d == nil || d["owed_to_me"].(float64) != 600 || d["returned"].(float64) != 400 {
		t.Fatalf("บอส: %v", d)
	}
	if d := byPerson["แม่"]; d == nil || d["i_owe"].(float64) != 0 || d["borrowed"].(float64) != 2000 {
		t.Fatalf("แม่: %v", d)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM categories`).Scan(&n)
	if n != 6 {
		t.Fatalf("categories = %d, want 6", n)
	}

	other := c.SignedIn("other")
	c.DoInto("GET", "/api/debts", other, nil, &debts)
	if len(debts) != 0 {
		t.Fatalf("other user sees debts: %v", debts)
	}
}
