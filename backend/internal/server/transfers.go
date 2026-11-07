package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"income-expenses/internal/httpx"
	"income-expenses/internal/money"
)

type Transfer struct {
	ID            int64   `json:"id"`
	Date          string  `json:"date"`
	FromAccountID int64   `json:"from_account_id"`
	FromLabel     string  `json:"from_label"`
	ToAccountID   int64   `json:"to_account_id"`
	ToLabel       string  `json:"to_label"`
	Amount        float64 `json:"amount"`
	Note          string  `json:"note"`
}

type transferInput struct {
	Date          string  `json:"date"`
	FromAccountID int64   `json:"from_account_id"`
	ToAccountID   int64   `json:"to_account_id"`
	Amount        float64 `json:"amount"`
	Note          string  `json:"note"`
	SlipID        *int64  `json:"slip_id"` // optional: confirms this pending slip (create only)
}

// shortLabelSQL is "ธนาคาร · ชื่อบัญชี" (or the type name when the account has no name) for aliases acc, bk, ty.
func shortLabelSQL(acc, bk, ty string) string {
	return bk + `.name || ' · ' || COALESCE(NULLIF(` + acc + `.name, ''), ` + ty + `.name)`
}

var selectTransfer = `
	SELECT tr.id, tr.txn_date, tr.from_account_id, ` + shortLabelSQL("fa", "fb", "ft") + `,
	       tr.to_account_id, ` + shortLabelSQL("ta", "tb", "tt") + `, tr.amount_satang, tr.note
	FROM transfers tr
	JOIN accounts fa ON fa.id = tr.from_account_id JOIN banks fb ON fb.id = fa.bank_id JOIN account_types ft ON ft.id = fa.type_id
	JOIN accounts ta ON ta.id = tr.to_account_id JOIN banks tb ON tb.id = ta.bank_id JOIN account_types tt ON tt.id = ta.type_id`

func scanTransfer(s scanner) (Transfer, error) {
	var t Transfer
	var satang int64
	err := s.Scan(&t.ID, &t.Date, &t.FromAccountID, &t.FromLabel, &t.ToAccountID, &t.ToLabel, &satang, &t.Note)
	t.Amount = money.FromSatang(satang)
	return t, err
}

// monthTransfers lists a user's transfers in [start, end), only those touching accountID when it isn't 0.
func (a *API) monthTransfers(ctx context.Context, uid int64, start, end string, accountID int64) ([]Transfer, error) {
	rows, err := a.db.QueryContext(ctx, selectTransfer+`
		WHERE tr.user_id = ?1 AND tr.txn_date >= ?2 AND tr.txn_date < ?3
		  AND (?4 = 0 OR tr.from_account_id = ?4 OR tr.to_account_id = ?4)
		ORDER BY tr.txn_date DESC, tr.id DESC`, uid, start, end, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Transfer{}
	for rows.Next() {
		t, err := scanTransfer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (a *API) fetchTransfer(r *http.Request, id int64) (Transfer, error) {
	return scanTransfer(a.db.QueryRowContext(r.Context(), selectTransfer+` WHERE tr.id = ? AND tr.user_id = ?`, id, userID(r)))
}

func (a *API) getTransfer(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	t, err := a.fetchTransfer(r, id)
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

func (a *API) createTransfer(w http.ResponseWriter, r *http.Request) {
	in, ok := a.decodeTransfer(w, r)
	if !ok {
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(r.Context(), `
		INSERT INTO transfers (user_id, txn_date, from_account_id, to_account_id, amount_satang, note)
		VALUES (?, ?, ?, ?, ?, ?)`,
		userID(r), in.Date, in.FromAccountID, in.ToAccountID, money.ToSatang(in.Amount), in.Note)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	id, _ := res.LastInsertId()
	if in.SlipID != nil {
		if err := confirmSlipAsTransfer(r.Context(), tx, userID(r), *in.SlipID, id); errors.Is(err, errSlipTaken) {
			httpx.WriteJSON(w, http.StatusConflict, map[string]string{"error": "สลิปนี้ถูกคอนเฟิร์มหรือถูกลบไปแล้ว"})
			return
		} else if err != nil {
			httpx.ServerError(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		httpx.ServerError(w, err)
		return
	}
	a.respondTransfer(w, r, id, http.StatusCreated)
}

func (a *API) updateTransfer(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	in, ok := a.decodeTransfer(w, r)
	if !ok {
		return
	}
	res, err := a.db.ExecContext(r.Context(), `
		UPDATE transfers
		SET txn_date = ?, from_account_id = ?, to_account_id = ?, amount_satang = ?, note = ?, updated_at = datetime('now')
		WHERE id = ? AND user_id = ?`,
		in.Date, in.FromAccountID, in.ToAccountID, money.ToSatang(in.Amount), in.Note, id, userID(r))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.NotFound(w)
		return
	}
	a.respondTransfer(w, r, id, http.StatusOK)
}

func (a *API) respondTransfer(w http.ResponseWriter, r *http.Request, id int64, status int) {
	t, err := a.fetchTransfer(r, id)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	httpx.WriteJSON(w, status, t)
}

func (a *API) deleteTransfer(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	// A transfer confirmed from a slip takes its slip (row + image) with it.
	uid := userID(r)
	var slipFile string
	err := a.db.QueryRowContext(r.Context(),
		`SELECT image_file FROM slips WHERE transfer_id = ? AND user_id = ?`, id, uid).Scan(&slipFile)
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
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM slips WHERE transfer_id = ? AND user_id = ?`, id, uid); err != nil {
		httpx.ServerError(w, err)
		return
	}
	res, err := tx.ExecContext(r.Context(), `DELETE FROM transfers WHERE id = ? AND user_id = ?`, id, uid)
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
	a.removeSlipFile(slipFile)
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) decodeTransfer(w http.ResponseWriter, r *http.Request) (transferInput, bool) {
	var in transferInput
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
	if in.FromAccountID == in.ToAccountID {
		httpx.BadRequest(w, "บัญชีต้นทางและปลายทางต้องเป็นคนละบัญชี")
		return in, false
	}
	var owned int
	if err := a.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM accounts WHERE user_id = ? AND id IN (?, ?)`,
		userID(r), in.FromAccountID, in.ToAccountID).Scan(&owned); err != nil {
		httpx.ServerError(w, err)
		return in, false
	}
	if owned != 2 {
		httpx.BadRequest(w, "unknown account")
		return in, false
	}
	in.Note = strings.TrimSpace(in.Note)
	return in, true
}
