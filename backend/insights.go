package main

import (
	"net/http"
	"time"
)

type spendItem struct {
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
}

// insights summarises a month's spending (money out) against the previous month: change, the
// biggest items, the daily average (days so far for the current month) and the largest expense.
func (a *API) insights(w http.ResponseWriter, r *http.Request) {
	start, err := time.Parse("2006-01", r.URL.Query().Get("month"))
	if err != nil {
		badRequest(w, "month must be YYYY-MM")
		return
	}
	uid := userID(r)
	end := start.AddDate(0, 1, 0)
	prev := start.AddDate(0, -1, 0)
	day := func(t time.Time) string { return t.Format("2006-01-02") }

	sum := func(from, to time.Time, dir int) (int64, error) {
		var s int64
		err := a.db.QueryRowContext(r.Context(), `
			SELECT COALESCE(SUM(t.amount_satang), 0) FROM transactions t JOIN categories c ON c.id = t.category_id
			WHERE t.user_id = ? AND c.direction = ? AND t.txn_date >= ? AND t.txn_date < ?`,
			uid, dir, day(from), day(to)).Scan(&s)
		return s, err
	}
	out, err := sum(start, end, -1)
	if err != nil {
		serverError(w, err)
		return
	}
	prevOut, err := sum(prev, start, -1)
	if err != nil {
		serverError(w, err)
		return
	}

	rows, err := a.db.QueryContext(r.Context(), `
		SELECT COALESCE(s.name, c.name), SUM(t.amount_satang)
		FROM transactions t JOIN categories c ON c.id = t.category_id LEFT JOIN subcategories s ON s.id = t.subcategory_id
		WHERE t.user_id = ? AND c.direction = -1 AND t.txn_date >= ? AND t.txn_date < ?
		GROUP BY COALESCE(s.name, c.name) ORDER BY 2 DESC LIMIT 3`, uid, day(start), day(end))
	if err != nil {
		serverError(w, err)
		return
	}
	top := []spendItem{}
	for rows.Next() {
		var it spendItem
		var satang int64
		if err := rows.Scan(&it.Name, &satang); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		it.Amount = fromSatang(satang)
		top = append(top, it)
	}
	rows.Close()

	var biggest *Transaction
	if t, _, err := scanTxn(a.db.QueryRowContext(r.Context(), selectTxn+`
		WHERE t.user_id = ? AND c.direction = -1 AND t.txn_date >= ? AND t.txn_date < ?
		ORDER BY t.amount_satang DESC LIMIT 1`, uid, day(start), day(end))); err == nil {
		biggest = &t
	}

	// Days to average over: the whole month, or up to today for the current month.
	days := end.Sub(start).Hours() / 24
	now := time.Now()
	if now.Year() == start.Year() && now.Month() == start.Month() {
		days = float64(now.Day())
	}
	var change *float64
	if prevOut > 0 {
		c := round2(float64(out-prevOut) / float64(prevOut) * 100)
		change = &c
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"out":         fromSatang(out),
		"prev_out":    fromSatang(prevOut),
		"change_pct":  change, // null when last month had no spending
		"avg_per_day": round2(fromSatang(out) / days),
		"top":         top,
		"biggest":     biggest,
	})
}
