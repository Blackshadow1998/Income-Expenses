package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"math"
	"net/http"
	"strings"
	"time"

	"income-expenses/internal/httpx"
	"income-expenses/internal/logx"
	"income-expenses/internal/money"
)

// Recurring rules create ordinary transactions (tagged with recurring_id) once their next_date has
// come. runRecurring checks every 10 minutes; saving a rule also runs it right away.

type Recurring struct {
	ID              int64   `json:"id"`
	Day             int     `json:"day"`
	CategoryID      int64   `json:"category_id"`
	CategoryCode    string  `json:"category_code"`
	CategoryName    string  `json:"category_name"`
	SubcategoryID   *int64  `json:"subcategory_id"`
	SubcategoryName string  `json:"subcategory_name"`
	AccountID       int64   `json:"account_id"`
	AccountLabel    string  `json:"account_label"`
	Amount          float64 `json:"amount"`
	Note            string  `json:"note"`
	Payee           string  `json:"payee"`
	NextDate        string  `json:"next_date"`
	Active          bool    `json:"active"`
}

type recurringInput struct {
	Day           int     `json:"day"`
	CategoryID    int64   `json:"category_id"`
	SubcategoryID *int64  `json:"subcategory_id"`
	AccountID     int64   `json:"account_id"`
	Amount        float64 `json:"amount"`
	Note          string  `json:"note"`
	Payee         string  `json:"payee"`
	Active        *bool   `json:"active"` // default true
}

// occurrence is `day` of the given month, or the month's last day when it is shorter.
func occurrence(year int, month time.Month, day int) time.Time {
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, time.Local).Day()
	return time.Date(year, month, min(day, last), 0, 0, 0, 0, time.Local)
}

// firstOccurrence is the first date on or after `from` that falls on `day`.
func firstOccurrence(from time.Time, day int) time.Time {
	d := occurrence(from.Year(), from.Month(), day)
	if d.Before(time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.Local)) {
		d = occurrence(from.Year(), from.Month()+1, day)
	}
	return d
}

// RunRecurring creates the transactions of recurring items as they fall due, checking every 10 minutes until ctx ends.
func RunRecurring(ctx context.Context, db *sql.DB) {
	for {
		if n, err := createDueRecurring(ctx, db, time.Now()); err != nil {
			logx.Logger.Printf("recurring: %v", err)
		} else if n > 0 {
			logx.Logger.Printf("recurring: created %d transaction(s)", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Minute):
		}
	}
}

// createDueRecurring creates every transaction whose date has come (catching up missed months).
func createDueRecurring(ctx context.Context, db *sql.DB, now time.Time) (int, error) {
	today := now.Format("2006-01-02")
	rows, err := db.QueryContext(ctx,
		`SELECT id, day_of_month, next_date FROM recurring WHERE active = 1 AND next_date <= ?`, today)
	if err != nil {
		return 0, err
	}
	type due struct {
		id   int64
		day  int
		next string
	}
	var list []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.id, &d.day, &d.next); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, d)
	}
	rows.Close()

	created := 0
	for _, d := range list {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return created, err
		}
		next, _ := time.ParseInLocation("2006-01-02", d.next, time.Local)
		for next.Format("2006-01-02") <= today {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO transactions (user_id, txn_date, category_id, subcategory_id, account_id, amount_satang, note, payee, recurring_id)
				SELECT user_id, ?, category_id, subcategory_id, account_id, amount_satang, note, payee, id FROM recurring WHERE id = ?`,
				next.Format("2006-01-02"), d.id); err != nil {
				tx.Rollback()
				return created, err
			}
			created++
			next = occurrence(next.Year(), next.Month()+1, d.day)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE recurring SET next_date = ? WHERE id = ?`, next.Format("2006-01-02"), d.id); err != nil {
			tx.Rollback()
			return created, err
		}
		if err := tx.Commit(); err != nil {
			return created, err
		}
	}
	return created, nil
}

func (a *API) listRecurring(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), `
		SELECT rc.id, rc.day_of_month, rc.category_id, c.code, c.name, rc.subcategory_id, COALESCE(s.name, ''),
		       rc.account_id, `+accountLabelSQL+`, rc.amount_satang, rc.note, rc.payee, rc.next_date, rc.active
		FROM recurring rc
		JOIN categories c ON c.id = rc.category_id
		LEFT JOIN subcategories s ON s.id = rc.subcategory_id
		JOIN accounts a ON a.id = rc.account_id
		JOIN banks b ON b.id = a.bank_id
		JOIN account_types ty ON ty.id = a.type_id
		WHERE rc.user_id = ?
		ORDER BY rc.active DESC, rc.day_of_month, rc.id`, userID(r))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer rows.Close()
	out := []Recurring{}
	for rows.Next() {
		var rc Recurring
		var satang int64
		if err := rows.Scan(&rc.ID, &rc.Day, &rc.CategoryID, &rc.CategoryCode, &rc.CategoryName, &rc.SubcategoryID,
			&rc.SubcategoryName, &rc.AccountID, &rc.AccountLabel, &satang, &rc.Note, &rc.Payee, &rc.NextDate, &rc.Active); err != nil {
			httpx.ServerError(w, err)
			return
		}
		rc.Amount = money.FromSatang(satang)
		out = append(out, rc)
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func (a *API) decodeRecurring(w http.ResponseWriter, r *http.Request) (recurringInput, bool) {
	var in recurringInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpx.BadRequest(w, "invalid JSON body")
		return in, false
	}
	if in.Day < 1 || in.Day > 31 {
		httpx.BadRequest(w, "วันที่ต้องอยู่ระหว่าง 1–31")
		return in, false
	}
	if in.Amount <= 0 || math.IsNaN(in.Amount) || math.IsInf(in.Amount, 0) {
		httpx.BadRequest(w, "จำนวนเงินต้องมากกว่า 0")
		return in, false
	}
	var ok bool
	if err := a.db.QueryRowContext(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM categories WHERE id = ?1)
		   AND EXISTS(SELECT 1 FROM accounts WHERE id = ?2 AND user_id = ?4)
		   AND (?3 IS NULL OR EXISTS(SELECT 1 FROM subcategories WHERE id = ?3 AND category_id = ?1 AND user_id = ?4))`,
		in.CategoryID, in.AccountID, in.SubcategoryID, userID(r)).Scan(&ok); err != nil {
		httpx.ServerError(w, err)
		return in, false
	}
	if !ok {
		httpx.BadRequest(w, "unknown category, item or account")
		return in, false
	}
	in.Note, in.Payee = strings.TrimSpace(in.Note), strings.TrimSpace(in.Payee)
	if in.Active == nil {
		t := true
		in.Active = &t
	}
	return in, true
}

// createRecurring starts with the first matching day from today on (today included), never backdated.
func (a *API) createRecurring(w http.ResponseWriter, r *http.Request) {
	in, ok := a.decodeRecurring(w, r)
	if !ok {
		return
	}
	next := firstOccurrence(time.Now(), in.Day).Format("2006-01-02")
	res, err := a.db.ExecContext(r.Context(), `
		INSERT INTO recurring (user_id, day_of_month, category_id, subcategory_id, account_id, amount_satang, note, payee, next_date, active)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID(r), in.Day, in.CategoryID, in.SubcategoryID, in.AccountID, money.ToSatang(in.Amount), in.Note, in.Payee, next, *in.Active)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	id, _ := res.LastInsertId()
	a.afterRecurringSaved(w, r, id, http.StatusCreated)
}

// updateRecurring changes a rule; a new day (or switching it back on) restarts from today.
func (a *API) updateRecurring(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	in, ok := a.decodeRecurring(w, r)
	if !ok {
		return
	}
	next := firstOccurrence(time.Now(), in.Day).Format("2006-01-02")
	res, err := a.db.ExecContext(r.Context(), `
		UPDATE recurring
		SET category_id = ?, subcategory_id = ?, account_id = ?, amount_satang = ?, note = ?, payee = ?,
		    next_date = CASE WHEN day_of_month <> ?7 OR (active = 0 AND ?8) THEN ?9 ELSE next_date END,
		    day_of_month = ?7, active = ?8
		WHERE id = ?10 AND user_id = ?11`,
		in.CategoryID, in.SubcategoryID, in.AccountID, money.ToSatang(in.Amount), in.Note, in.Payee,
		in.Day, *in.Active, next, id, userID(r))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.NotFound(w)
		return
	}
	a.afterRecurringSaved(w, r, id, http.StatusOK)
}

func (a *API) afterRecurringSaved(w http.ResponseWriter, r *http.Request, id int64, status int) {
	n, err := createDueRecurring(r.Context(), a.db, time.Now())
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	httpx.WriteJSON(w, status, map[string]int64{"id": id, "created_transactions": int64(n)})
}

// deleteRecurring stops the rule; transactions it already created stay.
func (a *API) deleteRecurring(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	res, err := a.db.ExecContext(r.Context(), `DELETE FROM recurring WHERE id = ? AND user_id = ?`, id, userID(r))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.NotFound(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
