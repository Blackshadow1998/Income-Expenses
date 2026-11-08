package server

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
)

func TestSubcategoriesArePerUserAndEditable(t *testing.T) {
	c, db := newTestServer(t)

	// After the rebuild, transactions must still point at the live table.
	var ddl string
	if err := db.QueryRow(`SELECT sql FROM sqlite_master WHERE name = 'transactions'`).Scan(&ddl); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(ddl, "subcategories_") {
		t.Fatalf("transactions references a temporary table: %s", ddl)
	}

	owner := c.SignedIn("owner")
	items := func(token string) map[string]float64 {
		var cats []map[string]any
		c.DoInto("GET", "/api/categories", token, nil, &cats)
		out := map[string]float64{}
		for _, cat := range cats {
			for _, s := range cat["subcategories"].([]any) {
				m := s.(map[string]any)
				out[cat["code"].(string)+":"+m["name"].(string)] = m["id"].(float64)
			}
		}
		return out
	}

	got := items(owner)
	if len(got) != 1 || got["expense:ค่าอาหาร - น้ำ"] != 1 {
		t.Fatalf("owner should take over the old list, got %v", got)
	}
	_, txn := c.Do("GET", "/api/transactions/1", owner, nil)
	if txn["subcategory_name"] != "ค่าอาหาร - น้ำ" {
		t.Fatalf("old transaction lost its item: %v", txn)
	}

	other := c.SignedIn("other")
	if o := items(other); len(o) != 7 || o["expense:ค่าอาหาร - น้ำ"] == 0 || o["expense:ค่าอาหาร - น้ำ"] == 1 {
		t.Fatalf("new user should get their own starter list, got %v", o)
	}

	status, created := c.Do("POST", "/api/subcategories", owner, map[string]any{"category_id": 2, "name": " ค่าเดินทาง "})
	if status != http.StatusCreated || created["name"] != "ค่าเดินทาง" {
		t.Fatalf("create: %d %v", status, created)
	}
	if status, _ := c.Do("POST", "/api/subcategories", owner, map[string]any{"category_id": 2, "name": "ค่าเดินทาง"}); status != http.StatusConflict {
		t.Fatalf("duplicate name: %d", status)
	}
	id := strconv.FormatFloat(created["id"].(float64), 'f', 0, 64)
	if status, _ := c.Do("PUT", "/api/subcategories/1", other, map[string]any{"name": "hijack"}); status != http.StatusNotFound {
		t.Fatalf("renaming someone else's item: %d", status)
	}
	if status, _ := c.Do("PUT", "/api/subcategories/"+id, owner, map[string]any{"name": "ค่ารถ"}); status != http.StatusOK {
		t.Fatalf("rename: %d", status)
	}
	// Other users can't use the owner's item on a transaction.
	_, acc := c.Do("POST", "/api/accounts", other, map[string]any{"bank_id": 1, "type_id": 1, "opening_balance": 0})
	if status, _ := c.Do("POST", "/api/transactions", other, map[string]any{
		"date": "2026-11-02", "category_id": 2, "subcategory_id": 1, "account_id": acc["id"], "amount": 5,
	}); status != http.StatusBadRequest {
		t.Fatalf("someone else's item on a transaction: %d", status)
	}

	status, del := c.Do("DELETE", "/api/subcategories/1", owner, nil)
	if status != http.StatusOK || del["cleared_transactions"].(float64) != 1 {
		t.Fatalf("delete used item: %d %v", status, del)
	}
	_, txn = c.Do("GET", "/api/transactions/1", owner, nil)
	if txn["subcategory_name"] != "" || txn["category_code"] != "expense" {
		t.Fatalf("transaction after deleting its item: %v", txn)
	}
}
