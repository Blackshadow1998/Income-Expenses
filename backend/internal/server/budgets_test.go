package server

import (
	"net/http"
	"testing"
)

func TestBudgetsTrackSpendingPerMonth(t *testing.T) {
	c, _ := newTestServer(t)
	owner := c.SignedIn("owner") // old data: a 50 baht expense on 2026-11-01 in item 1 ("ค่าอาหาร - น้ำ")

	for _, b := range []map[string]any{
		{"category_id": 2, "amount": 100},
		{"category_id": 2, "subcategory_id": 1, "amount": 40},
		{"category_id": 2, "amount": 120}, // replaces the first one
	} {
		if status, out := c.Do("POST", "/api/budgets", owner, b); status != http.StatusOK {
			t.Fatalf("save budget %v: %d %v", b, status, out)
		}
	}
	var budgets []map[string]any
	c.DoInto("GET", "/api/budgets?month=2026-11", owner, nil, &budgets)
	if len(budgets) != 2 {
		t.Fatalf("want 2 budgets, got %v", budgets)
	}
	whole, item := budgets[0], budgets[1]
	if whole["amount"].(float64) != 120 || whole["spent"].(float64) != 50 || whole["subcategory_id"] != nil {
		t.Fatalf("category budget: %v", whole)
	}
	if item["subcategory_name"] != "ค่าอาหาร - น้ำ" || item["spent"].(float64) != 50 {
		t.Fatalf("item budget: %v", item)
	}
	c.DoInto("GET", "/api/budgets?month=2026-10", owner, nil, &budgets)
	if budgets[0]["spent"].(float64) != 0 {
		t.Fatalf("October should have nothing spent: %v", budgets)
	}

	other := c.SignedIn("other")
	if status, _ := c.Do("POST", "/api/budgets", other, map[string]any{"category_id": 2, "subcategory_id": 1, "amount": 10}); status != http.StatusBadRequest {
		t.Fatalf("budget on someone else's item: %d", status)
	}
	if status, _ := c.Do("DELETE", "/api/budgets/1", other, nil); status != http.StatusNotFound {
		t.Fatalf("deleting someone else's budget: %d", status)
	}

	// Deleting the item removes its budget too.
	c.Do("DELETE", "/api/subcategories/1", owner, nil)
	c.DoInto("GET", "/api/budgets?month=2026-11", owner, nil, &budgets)
	if len(budgets) != 1 {
		t.Fatalf("item budget should go with the item: %v", budgets)
	}
	if status, _ := c.Do("DELETE", "/api/budgets/1", owner, nil); status != http.StatusNoContent {
		t.Fatalf("delete budget: %d", status)
	}
}
