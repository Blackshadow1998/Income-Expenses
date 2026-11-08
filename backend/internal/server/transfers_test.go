package server

import (
	"net/http"
	"testing"
)

func TestTransferMovesMoneyBetweenOwnAccounts(t *testing.T) {
	c, _ := newTestServer(t)
	owner := c.SignedIn("owner") // takes over the old data: account 1 with 1,000 opening, an unassigned 50 expense

	_, acc := c.Do("POST", "/api/accounts", owner, map[string]any{"bank_id": 3, "type_id": 1, "name": "ออม", "opening_balance": 0})
	savings := acc["id"].(float64)

	status, tr := c.Do("POST", "/api/transfers", owner, map[string]any{
		"date": "2026-11-05", "from_account_id": 1, "to_account_id": savings, "amount": 200, "note": "เก็บออม",
	})
	if status != http.StatusCreated || tr["from_label"] == "" || tr["to_label"] == "" {
		t.Fatalf("create transfer: %d %v", status, tr)
	}

	_, accounts := c.Do("GET", "/api/accounts", owner, nil)
	balances := map[float64]float64{}
	for _, a := range accounts["accounts"].([]any) {
		m := a.(map[string]any)
		balances[m["id"].(float64)] = m["balance"].(float64)
	}
	if balances[1] != 800 || balances[savings] != 200 || accounts["total"].(float64) != 950 {
		t.Fatalf("balances %v total %v, want 800 / 200 / 950", balances, accounts["total"])
	}

	_, month := c.Do("GET", "/api/transactions?month=2026-11", owner, nil)
	totals := month["totals"].(map[string]any)
	if totals["in"].(float64) != 0 || totals["out"].(float64) != 50 || len(month["transfers"].([]any)) != 1 {
		t.Fatalf("transfer must not count as income/expense: %v, transfers %v", totals, month["transfers"])
	}
	if month["balance"].(float64) != 950 {
		t.Fatalf("all-account balance %v, want 950", month["balance"])
	}
	_, filtered := c.Do("GET", "/api/transactions?month=2026-11&account_id=2", owner, nil)
	if filtered["balance"].(float64) != 200 || len(filtered["transfers"].([]any)) != 1 {
		t.Fatalf("savings account view: %v", filtered)
	}

	if status, _ := c.Do("DELETE", "/api/accounts/2", owner, nil); status != http.StatusConflict {
		t.Fatalf("deleting an account with a transfer: %d, want 409", status)
	}
	if status, _ := c.Do("POST", "/api/transfers", owner, map[string]any{
		"date": "2026-11-05", "from_account_id": 1, "to_account_id": 1, "amount": 10,
	}); status != http.StatusBadRequest {
		t.Fatalf("same account both sides: %d", status)
	}

	other := c.SignedIn("other")
	if status, _ := c.Do("POST", "/api/transfers", other, map[string]any{
		"date": "2026-11-05", "from_account_id": 1, "to_account_id": savings, "amount": 10,
	}); status != http.StatusBadRequest {
		t.Fatalf("transfer between someone else's accounts: %d", status)
	}
	if status, _ := c.Do("GET", "/api/transfers/1", other, nil); status != http.StatusNotFound {
		t.Fatalf("someone else's transfer: %d", status)
	}

	if status, _ := c.Do("PUT", "/api/transfers/1", owner, map[string]any{
		"date": "2026-11-05", "from_account_id": savings, "to_account_id": 1, "amount": 50,
	}); status != http.StatusOK {
		t.Fatalf("update transfer: %d", status)
	}
	if status, _ := c.Do("DELETE", "/api/transfers/1", owner, nil); status != http.StatusNoContent {
		t.Fatalf("delete transfer: %d", status)
	}
}
