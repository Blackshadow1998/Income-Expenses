package main

import (
	"net/http"
	"testing"
)

func TestSearchTransactions(t *testing.T) {
	c, _ := newTestServer(t)
	owner := c.signedIn("owner")
	for _, tx := range []map[string]any{
		{"date": "2026-10-03", "category_id": 2, "account_id": 1, "amount": 120, "note": "ข้าวมันไก่", "payee": "ร้านป้า"},
		{"date": "2026-11-04", "category_id": 2, "account_id": 1, "amount": 900, "note": "Shopee เสื้อ"},
		{"date": "2026-11-05", "category_id": 1, "account_id": 1, "amount": 5000, "note": "โบนัส"},
	} {
		if status, out := c.do("POST", "/api/transactions", owner, tx); status != http.StatusCreated {
			t.Fatalf("add: %d %v", status, out)
		}
	}
	count := func(query string) int {
		status, out := c.do("GET", "/api/transactions/search?"+query, owner, nil)
		if status != http.StatusOK {
			t.Fatalf("search %q: %d %v", query, status, out)
		}
		return len(out["items"].([]any))
	}
	cases := map[string]int{
		"":         4, // + the old 50 baht expense
		"q=shopee": 1, // case-insensitive ASCII
		"q=" + "%E0%B8%A3%E0%B9%89%E0%B8%B2%E0%B8%99":                                     1, // "ร้าน" in the payee
		"q=" + "%E0%B8%84%E0%B9%88%E0%B8%B2%E0%B8%AD%E0%B8%B2%E0%B8%AB%E0%B8%B2%E0%B8%A3": 1, // "ค่าอาหาร" item name
		"category_id=1":                 1,
		"from=2026-11-01&to=2026-11-04": 2,
		"min=100&max=1000":              2,
		"q=shopee&min=1000":             0,
	}
	for q, want := range cases {
		if got := count(q); got != want {
			t.Errorf("search %q: %d results, want %d", q, got, want)
		}
	}
	other := c.signedIn("other")
	if _, out := c.do("GET", "/api/transactions/search", other, nil); len(out["items"].([]any)) != 0 {
		t.Fatal("other user sees results")
	}
	if status, _ := c.do("GET", "/api/transactions/search?from=nope", owner, nil); status != http.StatusBadRequest {
		t.Fatalf("bad date: %d", status)
	}
}
