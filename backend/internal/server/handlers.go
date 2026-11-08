package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"income-expenses/internal/httpx"
	"income-expenses/internal/money"
)

type Category struct {
	ID            int64         `json:"id"`
	Code          string        `json:"code"`
	Name          string        `json:"name"`
	Direction     int           `json:"direction"`
	Subcategories []Subcategory `json:"subcategories"`
}

type Subcategory struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type Transaction struct {
	ID              int64   `json:"id"`
	Date            string  `json:"date"`
	CategoryID      int64   `json:"category_id"`
	CategoryCode    string  `json:"category_code"`
	CategoryName    string  `json:"category_name"`
	SubcategoryID   *int64  `json:"subcategory_id"`
	SubcategoryName string  `json:"subcategory_name"`
	AccountID       *int64  `json:"account_id"` // nil for rows saved before accounts existed
	AccountLabel    string  `json:"account_label"`
	SlipID          *int64  `json:"slip_id"` // set when created by confirming a bank slip
	SlipFrom        string  `json:"slip_from"`
	SlipTo          string  `json:"slip_to"`
	RecurringID     *int64  `json:"recurring_id"` // set when created by a recurring rule
	Direction       int     `json:"direction"`
	Amount          float64 `json:"amount"`
	Note            string  `json:"note"`
	Payee           string  `json:"payee"` // optional "ผู้รับ"
}

type transactionInput struct {
	Date          string  `json:"date"`
	CategoryID    int64   `json:"category_id"`
	SubcategoryID *int64  `json:"subcategory_id"` // optional
	AccountID     *int64  `json:"account_id"`     // required
	SlipID        *int64  `json:"slip_id"`        // optional: confirms this pending slip (create only)
	Amount        float64 `json:"amount"`
	Note          string  `json:"note"`
	Payee         string  `json:"payee"` // optional
}

func (a *API) listCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(),
		`SELECT id, code, name, direction FROM categories ORDER BY sort_order, id`)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer rows.Close()
	out := []Category{}
	index := map[int64]int{}
	for rows.Next() {
		c := Category{Subcategories: []Subcategory{}}
		if err := rows.Scan(&c.ID, &c.Code, &c.Name, &c.Direction); err != nil {
			httpx.ServerError(w, err)
			return
		}
		index[c.ID] = len(out)
		out = append(out, c)
	}
	rows.Close()

	subs, err := a.db.QueryContext(r.Context(),
		`SELECT id, category_id, name FROM subcategories WHERE user_id = ? ORDER BY sort_order, id`, userID(r))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer subs.Close()
	for subs.Next() {
		var s Subcategory
		var catID int64
		if err := subs.Scan(&s.ID, &catID, &s.Name); err != nil {
			httpx.ServerError(w, err)
			return
		}
		if i, ok := index[catID]; ok {
			out[i].Subcategories = append(out[i].Subcategories, s)
		}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// listPayees returns payee names used before, most recently used first, for the form's suggestions.
func (a *API) listPayees(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), `
		SELECT payee FROM transactions WHERE user_id = ? AND payee <> ''
		GROUP BY payee ORDER BY MAX(txn_date) DESC, MAX(id) DESC LIMIT 50`, userID(r))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			httpx.ServerError(w, err)
			return
		}
		out = append(out, p)
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// listMonths returns every month (YYYY-MM) that has data, newest first.
// The current month is always included so a new user lands on "this month".
func (a *API) listMonths(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), `
		SELECT substr(txn_date, 1, 7) FROM transactions WHERE user_id = ?1
		UNION
		SELECT substr(slip_date, 1, 7) FROM slips WHERE user_id = ?1 AND status = 'pending'
		ORDER BY 1 DESC`, userID(r))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer rows.Close()
	current := time.Now().Format("2006-01")
	months := []string{}
	hasCurrent := false
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			httpx.ServerError(w, err)
			return
		}
		if m == current {
			hasCurrent = true
		}
		months = append(months, m)
	}
	if !hasCurrent {
		months = append(months, current)
		sortDesc(months)
	}
	httpx.WriteJSON(w, http.StatusOK, months)
}

func (a *API) listYears(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(),
		`SELECT DISTINCT CAST(substr(txn_date, 1, 4) AS INTEGER) FROM transactions WHERE user_id = ? ORDER BY 1 DESC`,
		userID(r))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer rows.Close()
	current := time.Now().Year()
	years := []int{}
	hasCurrent := false
	for rows.Next() {
		var y int
		if err := rows.Scan(&y); err != nil {
			httpx.ServerError(w, err)
			return
		}
		if y == current {
			hasCurrent = true
		}
		years = append(years, y)
	}
	if !hasCurrent {
		years = append([]int{current}, years...)
	}
	httpx.WriteJSON(w, http.StatusOK, years)
}

// getBalance returns the all-time balance (opening amounts + transactions),
// for every account or for one account when account_id is given.
func (a *API) getBalance(w http.ResponseWriter, r *http.Request) {
	bal, err := a.balance(r, httpx.QueryID(r, "account_id"))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]float64{"balance": bal})
}

// balance of one account, or of everything when accountID is 0 (transfers between accounts cancel out then).
func (a *API) balance(r *http.Request, accountID int64) (float64, error) {
	var satang int64
	err := a.db.QueryRowContext(r.Context(), `
		SELECT
			(SELECT COALESCE(SUM(opening_satang), 0) FROM accounts WHERE user_id = ?2 AND (?1 = 0 OR id = ?1)) +
			(SELECT COALESCE(SUM(t.amount_satang * c.direction), 0)
			 FROM transactions t JOIN categories c ON c.id = t.category_id
			 WHERE t.user_id = ?2 AND (?1 = 0 OR t.account_id = ?1)) +
			(SELECT COALESCE(SUM(CASE WHEN to_account_id = ?1 THEN amount_satang ELSE -amount_satang END), 0)
			 FROM transfers WHERE user_id = ?2 AND ?1 <> 0 AND (from_account_id = ?1 OR to_account_id = ?1))`,
		accountID, userID(r)).Scan(&satang)
	return money.FromSatang(satang), err
}

func (a *API) listTransactions(w http.ResponseWriter, r *http.Request) {
	month := r.URL.Query().Get("month")
	start, err := time.Parse("2006-01", month)
	if err != nil {
		httpx.BadRequest(w, "month must be YYYY-MM")
		return
	}
	end := start.AddDate(0, 1, 0)
	accountID := httpx.QueryID(r, "account_id")

	rows, err := a.db.QueryContext(r.Context(), selectTxn+`
		WHERE t.user_id = ?4 AND t.txn_date >= ?1 AND t.txn_date < ?2 AND (?3 = 0 OR t.account_id = ?3)
		ORDER BY t.txn_date DESC, t.id DESC`,
		start.Format("2006-01-02"), end.Format("2006-01-02"), accountID, userID(r))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer rows.Close()

	items := []Transaction{}
	byCategory := map[string]float64{}
	var totalIn, totalOut int64
	for rows.Next() {
		t, satang, err := scanTxn(rows)
		if err != nil {
			httpx.ServerError(w, err)
			return
		}
		items = append(items, t)
		byCategory[t.CategoryCode] += t.Amount
		if t.Direction > 0 {
			totalIn += satang
		} else {
			totalOut += satang
		}
	}

	rows.Close()

	bal, err := a.balance(r, accountID)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	// Pending slips have no account yet, so they are listed whatever the account filter.
	pending, err := a.pendingSlips(r.Context(), userID(r), start.Format("2006-01-02"), end.Format("2006-01-02"))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	transfers, err := a.monthTransfers(r.Context(), userID(r), start.Format("2006-01-02"), end.Format("2006-01-02"), accountID)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"month":     month,
		"items":     items,
		"transfers": transfers, // not part of the in/out totals
		"pending":   pending,
		"totals": map[string]any{
			"in":          money.FromSatang(totalIn),
			"out":         money.FromSatang(totalOut),
			"net":         money.FromSatang(totalIn - totalOut),
			"by_category": byCategory,
		},
		"balance": bal,
	})
}

func (a *API) getTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	t, err := a.fetchTxn(r, id)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, t)
}

func (a *API) createTransaction(w http.ResponseWriter, r *http.Request) {
	in, ok := a.decodeInput(w, r)
	if !ok {
		return
	}
	// Insert and (when confirming a slip) link the slip atomically.
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(r.Context(),
		`INSERT INTO transactions (user_id, txn_date, category_id, subcategory_id, account_id, amount_satang, note, payee)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		userID(r), in.Date, in.CategoryID, in.SubcategoryID, in.AccountID, money.ToSatang(in.Amount), in.Note, in.Payee)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	id, _ := res.LastInsertId()
	if in.SlipID != nil {
		upd, err := tx.ExecContext(r.Context(),
			`UPDATE slips SET status = 'confirmed', transaction_id = ? WHERE id = ? AND user_id = ? AND status = 'pending'`,
			id, *in.SlipID, userID(r))
		if err != nil {
			httpx.ServerError(w, err)
			return
		}
		if n, _ := upd.RowsAffected(); n == 0 {
			httpx.WriteJSON(w, http.StatusConflict, map[string]string{"error": "สลิปนี้ถูกคอนเฟิร์มหรือถูกลบไปแล้ว"})
			return
		}
	}
	if err := tx.Commit(); err != nil {
		httpx.ServerError(w, err)
		return
	}
	t, err := a.fetchTxn(r, id)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, t)
}

func (a *API) updateTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	in, ok := a.decodeInput(w, r)
	if !ok {
		return
	}
	res, err := a.db.ExecContext(r.Context(), `
		UPDATE transactions
		SET txn_date = ?, category_id = ?, subcategory_id = ?, account_id = ?, amount_satang = ?, note = ?,
		    payee = ?, updated_at = datetime('now')
		WHERE id = ? AND user_id = ?`,
		in.Date, in.CategoryID, in.SubcategoryID, in.AccountID, money.ToSatang(in.Amount), in.Note, in.Payee, id, userID(r))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.NotFound(w)
		return
	}
	t, err := a.fetchTxn(r, id)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, t)
}

func (a *API) deleteTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	// A transaction confirmed from a slip takes its slip (row + image) with it.
	uid := userID(r)
	var slipFile string
	err := a.db.QueryRowContext(r.Context(),
		`SELECT image_file FROM slips WHERE transaction_id = ? AND user_id = ?`, id, uid).Scan(&slipFile)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		httpx.ServerError(w, err)
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM slips WHERE transaction_id = ? AND user_id = ?`, id, uid); err != nil {
		httpx.ServerError(w, err)
		return
	}
	res, err := tx.ExecContext(r.Context(), `DELETE FROM transactions WHERE id = ? AND user_id = ?`, id, uid)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.NotFound(w)
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.ServerError(w, err)
		return
	}
	a.images.Remove(slipFile)
	w.WriteHeader(http.StatusNoContent)
}

type monthSummary struct {
	Month      int                `json:"month"`
	In         float64            `json:"in"`
	Out        float64            `json:"out"`
	Net        float64            `json:"net"`
	ByCategory map[string]float64 `json:"by_category"`
}

func (a *API) yearlySummary(w http.ResponseWriter, r *http.Request) {
	year, err := strconv.Atoi(r.URL.Query().Get("year"))
	if err != nil || year < 1900 || year > 3000 {
		httpx.BadRequest(w, "year must be a number like 2026")
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `
		SELECT CAST(substr(t.txn_date, 6, 2) AS INTEGER), c.code, c.direction, SUM(t.amount_satang)
		FROM transactions t JOIN categories c ON c.id = t.category_id
		WHERE t.user_id = ?4 AND t.txn_date >= ?1 AND t.txn_date < ?2 AND (?3 = 0 OR t.account_id = ?3)
		GROUP BY 1, c.code, c.direction`,
		strconv.Itoa(year)+"-01-01", strconv.Itoa(year+1)+"-01-01", httpx.QueryID(r, "account_id"), userID(r))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer rows.Close()

	months := make([]monthSummary, 12)
	for i := range months {
		months[i] = monthSummary{Month: i + 1, ByCategory: map[string]float64{}}
	}
	var yearIn, yearOut int64
	for rows.Next() {
		var m, dir int
		var code string
		var satang int64
		if err := rows.Scan(&m, &code, &dir, &satang); err != nil {
			httpx.ServerError(w, err)
			return
		}
		ms := &months[m-1]
		ms.ByCategory[code] = money.FromSatang(satang)
		if dir > 0 {
			ms.In += money.FromSatang(satang)
			yearIn += satang
		} else {
			ms.Out += money.FromSatang(satang)
			yearOut += satang
		}
	}
	for i := range months {
		months[i].Net = money.Round2(months[i].In - months[i].Out)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"year":   year,
		"months": months,
		"totals": map[string]float64{
			"in":  money.FromSatang(yearIn),
			"out": money.FromSatang(yearOut),
			"net": money.FromSatang(yearIn - yearOut),
		},
	})
}

// --- helpers ---

const selectTxn = `
	SELECT t.id, t.txn_date, t.category_id, c.code, c.name, t.subcategory_id, COALESCE(s.name, ''),
	       t.account_id, COALESCE(` + accountLabelSQL + `, ''),
	       sl.id, COALESCE(sl.from_name, ''), COALESCE(sl.to_name, ''),
	       c.direction, t.amount_satang, t.note, t.payee, t.recurring_id
	FROM transactions t
	JOIN categories c ON c.id = t.category_id
	LEFT JOIN subcategories s ON s.id = t.subcategory_id
	LEFT JOIN accounts a ON a.id = t.account_id
	LEFT JOIN banks b ON b.id = a.bank_id
	LEFT JOIN account_types ty ON ty.id = a.type_id
	LEFT JOIN slips sl ON sl.transaction_id = t.id`

func (a *API) fetchTxn(r *http.Request, id int64) (Transaction, error) {
	t, _, err := scanTxn(a.db.QueryRowContext(r.Context(), selectTxn+` WHERE t.id = ? AND t.user_id = ?`, id, userID(r)))
	return t, err
}

type scanner interface{ Scan(dest ...any) error }

func scanTxn(s scanner) (Transaction, int64, error) {
	var t Transaction
	var satang int64
	err := s.Scan(&t.ID, &t.Date, &t.CategoryID, &t.CategoryCode, &t.CategoryName,
		&t.SubcategoryID, &t.SubcategoryName, &t.AccountID, &t.AccountLabel,
		&t.SlipID, &t.SlipFrom, &t.SlipTo, &t.Direction, &satang, &t.Note, &t.Payee, &t.RecurringID)
	t.Amount = money.FromSatang(satang)
	return t, satang, err
}

func (a *API) decodeInput(w http.ResponseWriter, r *http.Request) (transactionInput, bool) {
	var in transactionInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpx.BadRequest(w, "invalid JSON body")
		return in, false
	}
	if _, err := time.Parse("2006-01-02", in.Date); err != nil {
		httpx.BadRequest(w, "date must be YYYY-MM-DD")
		return in, false
	}
	if in.Amount <= 0 || math.IsNaN(in.Amount) || math.IsInf(in.Amount, 0) {
		httpx.BadRequest(w, "amount must be greater than 0")
		return in, false
	}
	var exists bool
	if err := a.db.QueryRowContext(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM categories WHERE id = ?)`, in.CategoryID).Scan(&exists); err != nil {
		httpx.ServerError(w, err)
		return in, false
	}
	if !exists {
		httpx.BadRequest(w, "unknown category_id")
		return in, false
	}
	if in.AccountID == nil {
		httpx.BadRequest(w, "account_id is required")
		return in, false
	}
	if err := a.db.QueryRowContext(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ? AND user_id = ?)`, *in.AccountID, userID(r)).Scan(&exists); err != nil {
		httpx.ServerError(w, err)
		return in, false
	}
	if !exists {
		httpx.BadRequest(w, "unknown account_id")
		return in, false
	}
	if in.SubcategoryID != nil {
		if err := a.db.QueryRowContext(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM subcategories WHERE id = ? AND category_id = ? AND user_id = ?)`,
			*in.SubcategoryID, in.CategoryID, userID(r)).Scan(&exists); err != nil {
			httpx.ServerError(w, err)
			return in, false
		}
		if !exists {
			httpx.BadRequest(w, "subcategory_id does not belong to category_id")
			return in, false
		}
	}
	in.Note = strings.TrimSpace(in.Note)
	in.Payee = strings.TrimSpace(in.Payee)
	return in, true
}

func sortDesc(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] > s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
