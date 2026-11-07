package main

import "net/http"

// Debt is what is still owed between the user and one person (the transactions' payee):
// ให้ยืม minus รับคืนเงินยืม, and กู้ minus คืนเงินกู้.
type Debt struct {
	Person   string  `json:"person"` // "" when the transactions have no payee
	Lent     float64 `json:"lent"`
	Returned float64 `json:"returned"`
	Borrowed float64 `json:"borrowed"`
	Repaid   float64 `json:"repaid"`
	OwedToMe float64 `json:"owed_to_me"` // lent - returned
	IOwe     float64 `json:"i_owe"`      // borrowed - repaid
	LastDate string  `json:"last_date"`
}

func (a *API) listDebts(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), `
		SELECT TRIM(t.payee),
		       SUM(CASE c.code WHEN 'lend'         THEN t.amount_satang ELSE 0 END),
		       SUM(CASE c.code WHEN 'lend_return'  THEN t.amount_satang ELSE 0 END),
		       SUM(CASE c.code WHEN 'borrow'       THEN t.amount_satang ELSE 0 END),
		       SUM(CASE c.code WHEN 'borrow_repay' THEN t.amount_satang ELSE 0 END),
		       MAX(t.txn_date)
		FROM transactions t JOIN categories c ON c.id = t.category_id
		WHERE t.user_id = ? AND c.code IN ('lend', 'lend_return', 'borrow', 'borrow_repay')
		GROUP BY TRIM(t.payee)
		ORDER BY MAX(t.txn_date) DESC`, userID(r))
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	out := []Debt{}
	for rows.Next() {
		var d Debt
		var lent, returned, borrowed, repaid int64
		if err := rows.Scan(&d.Person, &lent, &returned, &borrowed, &repaid, &d.LastDate); err != nil {
			serverError(w, err)
			return
		}
		d.Lent, d.Returned, d.Borrowed, d.Repaid = fromSatang(lent), fromSatang(returned), fromSatang(borrowed), fromSatang(repaid)
		d.OwedToMe, d.IOwe = fromSatang(lent-returned), fromSatang(borrowed-repaid)
		out = append(out, d)
	}
	writeJSON(w, http.StatusOK, out)
}
