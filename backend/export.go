package main

import (
	"encoding/csv"
	"net/http"
	"strconv"
	"time"
)

// exportCSV downloads the user's transactions and transfers in [from, to] (YYYY-MM-DD, optional) as CSV.
// The UTF-8 BOM makes Excel read the Thai text correctly.
func (a *API) exportCSV(w http.ResponseWriter, r *http.Request) {
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	for _, d := range []string{from, to} {
		if d == "" {
			continue
		}
		if _, err := time.Parse("2006-01-02", d); err != nil {
			badRequest(w, "from/to must be YYYY-MM-DD")
			return
		}
	}
	if to == "" {
		to = "9999-12-31"
	}
	uid := userID(r)
	rows, err := a.db.QueryContext(r.Context(), selectTxn+`
		WHERE t.user_id = ? AND t.txn_date >= ? AND t.txn_date <= ? ORDER BY t.txn_date, t.id`, uid, from, to)
	if err != nil {
		serverError(w, err)
		return
	}
	var txns []Transaction
	for rows.Next() {
		t, _, err := scanTxn(rows)
		if err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		txns = append(txns, t)
	}
	rows.Close()
	transfers, err := a.monthTransfers(r.Context(), uid, from, to+"~", 0) // "~" sorts after any date suffix: end inclusive
	if err != nil {
		serverError(w, err)
		return
	}

	name := "income-expenses"
	if from != "" {
		name += "_" + from
	}
	if to != "9999-12-31" {
		name += "_" + to
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`.csv"`)
	w.Write([]byte("\uFEFF"))
	cw := csv.NewWriter(w)
	cw.Write([]string{"วันที่", "ประเภท", "หมวด", "รายการ", "จำนวนเงิน", "บัญชี", "ผู้รับ / ไปบัญชี", "รายละเอียด"})
	amount := func(v float64) string { return strconv.FormatFloat(v, 'f', 2, 64) }
	for _, t := range txns {
		kind := "รายจ่าย"
		if t.Direction > 0 {
			kind = "รายรับ"
		}
		account := t.AccountLabel
		if account == "" {
			account = "ไม่ระบุบัญชี"
		}
		cw.Write([]string{t.Date, kind, t.CategoryName, t.SubcategoryName, amount(float64(t.Direction) * t.Amount), account, t.Payee, t.Note})
	}
	for _, tr := range transfers {
		cw.Write([]string{tr.Date, "โอนระหว่างบัญชี", "", "", amount(tr.Amount), tr.FromLabel, tr.ToLabel, tr.Note})
	}
	cw.Flush()
}
