package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"time"
)

type Budget struct {
	ID              int64   `json:"id"`
	CategoryID      int64   `json:"category_id"`
	CategoryCode    string  `json:"category_code"`
	CategoryName    string  `json:"category_name"`
	SubcategoryID   *int64  `json:"subcategory_id"` // nil = the whole category
	SubcategoryName string  `json:"subcategory_name"`
	Amount          float64 `json:"amount"`
	Spent           float64 `json:"spent"` // in the requested month
}

// listBudgets returns the user's budgets with what was spent against each in ?month=YYYY-MM.
func (a *API) listBudgets(w http.ResponseWriter, r *http.Request) {
	start, err := time.Parse("2006-01", r.URL.Query().Get("month"))
	if err != nil {
		badRequest(w, "month must be YYYY-MM")
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `
		SELECT b.id, b.category_id, c.code, c.name, b.subcategory_id, COALESCE(s.name, ''), b.amount_satang,
		       (SELECT COALESCE(SUM(t.amount_satang), 0) FROM transactions t
		        WHERE t.user_id = b.user_id AND t.category_id = b.category_id
		          AND (b.subcategory_id IS NULL OR t.subcategory_id = b.subcategory_id)
		          AND t.txn_date >= ?2 AND t.txn_date < ?3)
		FROM budgets b
		JOIN categories c ON c.id = b.category_id
		LEFT JOIN subcategories s ON s.id = b.subcategory_id
		WHERE b.user_id = ?1
		ORDER BY c.sort_order, b.subcategory_id IS NOT NULL, s.sort_order, b.id`,
		userID(r), start.Format("2006-01-02"), start.AddDate(0, 1, 0).Format("2006-01-02"))
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	out := []Budget{}
	for rows.Next() {
		var b Budget
		var amount, spent int64
		if err := rows.Scan(&b.ID, &b.CategoryID, &b.CategoryCode, &b.CategoryName, &b.SubcategoryID, &b.SubcategoryName, &amount, &spent); err != nil {
			serverError(w, err)
			return
		}
		b.Amount, b.Spent = fromSatang(amount), fromSatang(spent)
		out = append(out, b)
	}
	writeJSON(w, http.StatusOK, out)
}

type budgetInput struct {
	CategoryID    int64   `json:"category_id"`
	SubcategoryID *int64  `json:"subcategory_id"`
	Amount        float64 `json:"amount"`
}

func (a *API) saveBudget(w http.ResponseWriter, r *http.Request) {
	var in budgetInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		badRequest(w, "invalid JSON body")
		return
	}
	if in.Amount <= 0 || math.IsNaN(in.Amount) || math.IsInf(in.Amount, 0) {
		badRequest(w, "จำนวนเงินต้องมากกว่า 0")
		return
	}
	uid := userID(r)
	var ok bool
	if err := a.db.QueryRowContext(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM categories WHERE id = ?1) AND
		       (?2 IS NULL OR EXISTS(SELECT 1 FROM subcategories WHERE id = ?2 AND category_id = ?1 AND user_id = ?3))`,
		in.CategoryID, in.SubcategoryID, uid).Scan(&ok); err != nil {
		serverError(w, err)
		return
	}
	if !ok {
		badRequest(w, "unknown category or item")
		return
	}
	// One budget per category/item: saving again replaces the amount.
	var id int64
	err := a.db.QueryRowContext(r.Context(), `
		SELECT id FROM budgets WHERE user_id = ? AND category_id = ? AND subcategory_id IS ?`,
		uid, in.CategoryID, in.SubcategoryID).Scan(&id)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		res, err := a.db.ExecContext(r.Context(),
			`INSERT INTO budgets (user_id, category_id, subcategory_id, amount_satang) VALUES (?, ?, ?, ?)`,
			uid, in.CategoryID, in.SubcategoryID, toSatang(in.Amount))
		if err != nil {
			serverError(w, err)
			return
		}
		id, _ = res.LastInsertId()
	case err != nil:
		serverError(w, err)
		return
	default:
		if _, err := a.db.ExecContext(r.Context(),
			`UPDATE budgets SET amount_satang = ? WHERE id = ?`, toSatang(in.Amount), id); err != nil {
			serverError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]int64{"id": id})
}

func (a *API) deleteBudget(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	res, err := a.db.ExecContext(r.Context(), `DELETE FROM budgets WHERE id = ? AND user_id = ?`, id, userID(r))
	if err != nil {
		serverError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		notFound(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
