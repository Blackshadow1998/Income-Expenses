package main

import (
	"net/http"
	"strconv"
	"strings"
	"time"
)

// searchTransactions finds the user's transactions by text (note, payee, item, category) and filters:
// from/to (YYYY-MM-DD, inclusive), category_id, account_id, min/max amount. Newest first, at most 300.
func (a *API) searchTransactions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := []string{"t.user_id = ?"}
	args := []any{userID(r)}
	if text := strings.ToLower(strings.TrimSpace(q.Get("q"))); text != "" {
		where = append(where, `instr(lower(t.note || ' ' || t.payee || ' ' || COALESCE(s.name, '') || ' ' || c.name), ?) > 0`)
		args = append(args, text)
	}
	for _, f := range []struct{ param, cond string }{{"from", "t.txn_date >= ?"}, {"to", "t.txn_date <= ?"}} {
		if v := q.Get(f.param); v != "" {
			if _, err := time.Parse("2006-01-02", v); err != nil {
				badRequest(w, f.param+" must be YYYY-MM-DD")
				return
			}
			where = append(where, f.cond)
			args = append(args, v)
		}
	}
	for _, f := range []struct{ param, cond string }{{"category_id", "t.category_id = ?"}, {"account_id", "t.account_id = ?"}} {
		if id := queryID(r, f.param); id > 0 {
			where = append(where, f.cond)
			args = append(args, id)
		}
	}
	for _, f := range []struct{ param, cond string }{{"min", "t.amount_satang >= ?"}, {"max", "t.amount_satang <= ?"}} {
		if v := q.Get(f.param); v != "" {
			n, err := strconv.ParseFloat(v, 64)
			if err != nil || n < 0 {
				badRequest(w, f.param+" must be a positive number")
				return
			}
			where = append(where, f.cond)
			args = append(args, toSatang(n))
		}
	}

	rows, err := a.db.QueryContext(r.Context(), selectTxn+` WHERE `+strings.Join(where, " AND ")+`
		ORDER BY t.txn_date DESC, t.id DESC LIMIT 300`, args...)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	items := []Transaction{}
	var in, out int64
	for rows.Next() {
		t, satang, err := scanTxn(rows)
		if err != nil {
			serverError(w, err)
			return
		}
		items = append(items, t)
		if t.Direction > 0 {
			in += satang
		} else {
			out += satang
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":  items,
		"totals": map[string]float64{"in": fromSatang(in), "out": fromSatang(out)},
		"capped": len(items) == 300,
	})
}
