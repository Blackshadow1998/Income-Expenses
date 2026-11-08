package server

import (
	"encoding/csv"
	"net/http"
	"strconv"
	"time"

	"income-expenses/internal/httpx"
	"income-expenses/internal/i18n"
)

// exportCSV downloads the user's transactions and transfers in [from, to] (YYYY-MM-DD, optional) as CSV.
// The UTF-8 BOM makes Excel read the Thai text correctly. The header, the type column and the shared
// category names follow Accept-Language; the user's own data is written as stored.
func (a *API) exportCSV(w http.ResponseWriter, r *http.Request) {
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	for _, d := range []string{from, to} {
		if d == "" {
			continue
		}
		if _, err := time.Parse("2006-01-02", d); err != nil {
			httpx.BadRequest(w, "from/to must be YYYY-MM-DD")
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
		httpx.ServerError(w, err)
		return
	}
	var txns []Transaction
	for rows.Next() {
		t, _, err := scanTxn(rows)
		if err != nil {
			rows.Close()
			httpx.ServerError(w, err)
			return
		}
		txns = append(txns, t)
	}
	rows.Close()
	transfers, err := a.monthTransfers(r.Context(), uid, from, to+"~", 0) // "~" sorts after any date suffix: end inclusive
	if err != nil {
		httpx.ServerError(w, err)
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
	lang := i18n.FromContext(r.Context())
	text := func(s string) string { return i18n.T(lang, s) }
	cw := csv.NewWriter(w)
	cw.Write([]string{text("วันที่"), text("ประเภท"), text("หมวด"), text("รายการ"), text("จำนวนเงิน"), text("บัญชี"), text("ผู้รับ / ไปบัญชี"), text("รายละเอียด")})
	amount := func(v float64) string { return strconv.FormatFloat(v, 'f', 2, 64) }
	for _, t := range txns {
		kind := text("รายจ่าย")
		if t.Direction > 0 {
			kind = text("รายรับ")
		}
		account := t.AccountLabel
		if account == "" {
			account = text("ไม่ระบุบัญชี")
		}
		category := i18n.Category(lang, t.CategoryCode, t.CategoryName)
		cw.Write([]string{t.Date, kind, category, t.SubcategoryName, amount(float64(t.Direction) * t.Amount), account, t.Payee, t.Note})
	}
	for _, tr := range transfers {
		cw.Write([]string{tr.Date, text("โอนระหว่างบัญชี"), "", "", amount(tr.Amount), tr.FromLabel, tr.ToLabel, tr.Note})
	}
	cw.Flush()
}
