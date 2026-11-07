package main

import (
	"testing"
	"time"
)

func TestInsightsComparesWithLastMonth(t *testing.T) {
	c, _ := newTestServer(t)
	owner := c.signedIn("owner") // old data: 50 baht "ค่าอาหาร - น้ำ" on 2026-11-01
	for _, tx := range []map[string]any{
		{"date": "2026-10-10", "category_id": 2, "account_id": 1, "amount": 100},
		{"date": "2026-11-02", "category_id": 2, "account_id": 1, "amount": 250, "note": "รองเท้า"},
		{"date": "2026-11-03", "category_id": 1, "account_id": 1, "amount": 9999}, // income is ignored
	} {
		c.do("POST", "/api/transactions", owner, tx)
	}
	_, got := c.do("GET", "/api/insights?month=2026-11", owner, nil)
	if got["out"].(float64) != 300 || got["prev_out"].(float64) != 100 || got["change_pct"].(float64) != 200 {
		t.Fatalf("totals: %v", got)
	}
	days := 30.0 // whole month, or the days so far when November 2026 is the current month
	if now := time.Now(); now.Year() == 2026 && now.Month() == time.November {
		days = float64(now.Day())
	}
	if want := round2(300 / days); got["avg_per_day"].(float64) != want {
		t.Fatalf("avg_per_day = %v, want %v", got["avg_per_day"], want)
	}
	top := got["top"].([]any)
	if len(top) != 2 || top[0].(map[string]any)["name"] != "จ่าย" || top[1].(map[string]any)["name"] != "ค่าอาหาร - น้ำ" {
		t.Fatalf("top: %v", top)
	}
	if b := got["biggest"].(map[string]any); b["amount"].(float64) != 250 {
		t.Fatalf("biggest: %v", b)
	}
	_, empty := c.do("GET", "/api/insights?month=2026-09", owner, nil)
	if empty["change_pct"] != nil || empty["biggest"] != nil {
		t.Fatalf("empty month: %v", empty)
	}
}
