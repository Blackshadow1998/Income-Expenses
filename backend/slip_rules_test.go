package main

import (
	"net/http"
	"strconv"
	"testing"
)

func TestSamePerson(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"นาย สมชาย ใจดี", "สมชาย ใ", true},
		{"นาย สมชาย ใ", "MR สมชาย ใจดี", true},
		{"น.ส. สมหญิง รักดี", "นางสาว สมหญิง ร", true},
		{"นาย สมชาย ใจดี", "นาย สมชาย ขาวสะอาด", false}, // same first name, different surname
		{"นาย สมชาย ใจดี", "ร้าน สมชาย", false},
		{"", "สมชาย", false},
	}
	for _, c := range cases {
		if got := samePerson(c.a, c.b); got != c.want {
			t.Errorf("samePerson(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

func TestSlipRulesSuggestAndConfirmAsTransfer(t *testing.T) {
	c, db := newTestServer(t)
	owner := c.signedIn("owner") // old data: account 1 at bank 2 (KBank)
	_, acc := c.do("POST", "/api/accounts", owner, map[string]any{"bank_id": 3, "type_id": 1, "name": "ออม", "opening_balance": 0})
	savings := acc["id"].(float64)

	insert := func(from, to string, bank, toBank any) string {
		res, err := db.Exec(`INSERT INTO slips (user_id, image_file, file_hash, slip_date, date_found, amount_satang, from_name, to_name, bank_id, to_bank_id)
			VALUES (1, 'x.jpg', ?, '2026-11-05', 1, 50000, ?, ?, ?, ?)`, from+to, from, to, bank, toBank)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		return strconv.FormatInt(id, 10)
	}
	self := insert("นาย สมชาย ใจดี", "สมชาย ใ", 2, 3)
	rent := insert("นาย สมชาย ใจดี", "นางสาว สมศรี หอพักดี", 2, nil)
	other := insert("นาย สมชาย ใจดี", "ร้านกาแฟ", 2, nil)

	for _, r := range []map[string]any{
		{"name": "ค่าหอ", "match_kind": "to", "match_text": "สมศรี", "action": "transaction", "category_id": 2, "note": "ค่าหอเดือนนี้"},
		{"name": "โอนให้ตัวเอง", "match_kind": "self", "action": "transfer"},
	} {
		if status, out := c.do("POST", "/api/slip-rules", owner, r); status != http.StatusCreated {
			t.Fatalf("create rule %v: %d %v", r["name"], status, out)
		}
	}
	if status, _ := c.do("POST", "/api/slip-rules", owner, map[string]any{"name": "x", "match_kind": "to", "action": "transaction", "category_id": 2}); status != http.StatusBadRequest {
		t.Fatalf("rule without match text: %d", status)
	}

	_, s := c.do("GET", "/api/slips/"+self, owner, nil)
	sug, _ := s["suggestion"].(map[string]any)
	if sug == nil || sug["action"] != "transfer" || sug["account_id"].(float64) != 1 || sug["to_account_id"].(float64) != savings {
		t.Fatalf("self-transfer suggestion: %v", s["suggestion"])
	}
	_, s = c.do("GET", "/api/slips/"+rent, owner, nil)
	sug, _ = s["suggestion"].(map[string]any)
	if sug == nil || sug["rule_name"] != "ค่าหอ" || sug["category_id"].(float64) != 2 || sug["payee"] != "นางสาว สมศรี หอพักดี" || sug["note"] != "ค่าหอเดือนนี้" {
		t.Fatalf("rent suggestion: %v", s["suggestion"])
	}
	if _, s = c.do("GET", "/api/slips/"+other, owner, nil); s["suggestion"] != nil {
		t.Fatalf("no rule should match: %v", s["suggestion"])
	}
	_, month := c.do("GET", "/api/transactions?month=2026-11", owner, nil)
	withSuggestion := 0
	for _, p := range month["pending"].([]any) {
		if p.(map[string]any)["suggestion"] != nil {
			withSuggestion++
		}
	}
	if withSuggestion != 2 {
		t.Fatalf("pending slips with a suggestion = %d, want 2", withSuggestion)
	}

	// Order: move the self rule to the top.
	var rules []map[string]any
	c.doInto("GET", "/api/slip-rules", owner, nil, &rules)
	selfRule := strconv.FormatFloat(rules[1]["id"].(float64), 'f', 0, 64)
	c.do("POST", "/api/slip-rules/"+selfRule+"/move", owner, map[string]any{"dir": -1})
	c.doInto("GET", "/api/slip-rules", owner, nil, &rules)
	if rules[0]["name"] != "โอนให้ตัวเอง" {
		t.Fatalf("move: %v", rules)
	}

	// Confirm the self slip as a transfer; it can't be confirmed twice, and deleting the transfer removes it.
	body := map[string]any{"date": "2026-11-05", "from_account_id": 1, "to_account_id": savings, "amount": 500, "slip_id": self}
	body["slip_id"], _ = strconv.Atoi(self)
	status, tr := c.do("POST", "/api/transfers", owner, body)
	if status != http.StatusCreated {
		t.Fatalf("transfer from slip: %d %v", status, tr)
	}
	if status, _ := c.do("POST", "/api/transfers", owner, body); status != http.StatusConflict {
		t.Fatalf("slip confirmed twice: %d", status)
	}
	var left int
	db.QueryRow(`SELECT COUNT(*) FROM slips WHERE status = 'pending'`).Scan(&left)
	if left != 3 { // rent, other and the old-data slip
		t.Fatalf("pending slips = %d, want 3", left)
	}
	c.do("DELETE", "/api/transfers/"+strconv.FormatFloat(tr["id"].(float64), 'f', 0, 64), owner, nil)
	var gone int
	db.QueryRow(`SELECT COUNT(*) FROM slips WHERE id = ?`, self).Scan(&gone)
	if gone != 0 {
		t.Fatal("deleting the transfer should delete its slip")
	}

	other2 := c.signedIn("other")
	c.doInto("GET", "/api/slip-rules", other2, nil, &rules)
	if len(rules) != 0 {
		t.Fatalf("other user sees rules: %v", rules)
	}
	if status, _ := c.do("DELETE", "/api/slip-rules/"+selfRule, other2, nil); status != http.StatusNotFound {
		t.Fatalf("deleting someone else's rule: %d", status)
	}
}
