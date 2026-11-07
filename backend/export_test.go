package main

import (
	"encoding/csv"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestExportCSV(t *testing.T) {
	c, _ := newTestServer(t)
	owner := c.signedIn("owner") // old data: 50 baht expense on 2026-11-01 (no account)
	c.do("POST", "/api/transactions", owner, map[string]any{"date": "2026-11-02", "category_id": 1, "account_id": 1, "amount": 1234.5, "note": "เงินเดือน, พ.ย."})
	_, acc := c.do("POST", "/api/accounts", owner, map[string]any{"bank_id": 3, "type_id": 1, "opening_balance": 0})
	c.do("POST", "/api/transfers", owner, map[string]any{"date": "2026-11-03", "from_account_id": 1, "to_account_id": acc["id"], "amount": 100})
	c.do("POST", "/api/transactions", owner, map[string]any{"date": "2026-12-01", "category_id": 2, "account_id": 1, "amount": 9})

	req, _ := http.NewRequest("GET", c.srv.URL+"/api/export.csv?from=2026-11-01&to=2026-11-30", nil)
	req.Header.Set("Authorization", "Bearer "+owner)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || !strings.HasPrefix(string(body), "\uFEFF") {
		t.Fatalf("status %d, body %q", res.StatusCode, body)
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.Contains(cd, "income-expenses_2026-11-01_2026-11-30.csv") {
		t.Fatalf("Content-Disposition = %q", cd)
	}
	records, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(body), "\uFEFF"))).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	// header + 2 transactions in November + 1 transfer; December is left out.
	if len(records) != 4 {
		t.Fatalf("rows: %v", records)
	}
	if records[1][4] != "-50.00" || records[1][5] != "ไม่ระบุบัญชี" {
		t.Fatalf("expense row: %v", records[1])
	}
	if records[2][4] != "1234.50" || records[2][7] != "เงินเดือน, พ.ย." {
		t.Fatalf("income row (comma in note must survive): %v", records[2])
	}
	if records[3][1] != "โอนระหว่างบัญชี" || records[3][4] != "100.00" {
		t.Fatalf("transfer row: %v", records[3])
	}
}
