package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
)

type Account struct {
	ID       int64   `json:"id"`
	BankID   int64   `json:"bank_id"`
	BankName string  `json:"bank_name"`
	TypeID   int64   `json:"type_id"`
	TypeCode string  `json:"type_code"`
	TypeName string  `json:"type_name"`
	Name     string  `json:"name"`
	Label    string  `json:"label"`
	Opening  float64 `json:"opening_balance"`
	Balance  float64 `json:"balance"` // opening + all transactions of this account
	TxnCount int     `json:"transaction_count"`
}

type accountInput struct {
	BankID  int64   `json:"bank_id"`
	TypeID  int64   `json:"type_id"`
	Name    string  `json:"name"`
	Opening float64 `json:"opening_balance"`
}

type Option struct {
	ID   int64  `json:"id"`
	Code string `json:"code,omitempty"`
	Name string `json:"name"`
}

type typeTotal struct {
	Code    string  `json:"code"`
	Name    string  `json:"name"`
	Balance float64 `json:"balance"`
	Count   int     `json:"count"`
}

// accountLabelSQL builds "ธนาคาร · ประเภท · ชื่อ" for display; expects aliases a, b, ty.
const accountLabelSQL = `b.name || ' · ' || ty.name || CASE WHEN a.name <> '' THEN ' · ' || a.name ELSE '' END`

const selectAccount = `
	SELECT a.id, a.bank_id, b.name, a.type_id, ty.code, ty.name, a.name, ` + accountLabelSQL + `,
	       a.opening_satang,
	       a.opening_satang + COALESCE((
	           SELECT SUM(t.amount_satang * c.direction)
	           FROM transactions t JOIN categories c ON c.id = t.category_id
	           WHERE t.account_id = a.id), 0),
	       (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id)
	FROM accounts a
	JOIN banks b ON b.id = a.bank_id
	JOIN account_types ty ON ty.id = a.type_id`

func scanAccount(s scanner) (Account, error) {
	var a Account
	var opening, balance int64
	err := s.Scan(&a.ID, &a.BankID, &a.BankName, &a.TypeID, &a.TypeCode, &a.TypeName, &a.Name, &a.Label,
		&opening, &balance, &a.TxnCount)
	a.Opening = fromSatang(opening)
	a.Balance = fromSatang(balance)
	return a, err
}

func (a *API) fetchAccount(ctx context.Context, id int64) (Account, error) {
	return scanAccount(a.db.QueryRowContext(ctx, selectAccount+` WHERE a.id = ?`, id))
}

// listAccounts returns every account with its balance, plus the grand total and
// a per-type breakdown. Transactions saved before accounts existed are reported as "unassigned".
func (a *API) listAccounts(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), selectAccount+` ORDER BY ty.sort_order, b.sort_order, a.id`)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()

	accounts := []Account{}
	byType := []typeTotal{}
	var total float64
	for rows.Next() {
		acc, err := scanAccount(rows)
		if err != nil {
			serverError(w, err)
			return
		}
		accounts = append(accounts, acc)
		total += acc.Balance
		if n := len(byType); n == 0 || byType[n-1].Code != acc.TypeCode {
			byType = append(byType, typeTotal{Code: acc.TypeCode, Name: acc.TypeName})
		}
		bt := &byType[len(byType)-1]
		bt.Balance = round2(bt.Balance + acc.Balance)
		bt.Count++
	}
	rows.Close()

	var unassignedSatang int64
	var unassignedCount int
	if err := a.db.QueryRowContext(r.Context(), `
		SELECT COALESCE(SUM(t.amount_satang * c.direction), 0), COUNT(*)
		FROM transactions t JOIN categories c ON c.id = t.category_id
		WHERE t.account_id IS NULL`).Scan(&unassignedSatang, &unassignedCount); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"accounts": accounts,
		"by_type":  byType,
		"unassigned": map[string]any{
			"balance": fromSatang(unassignedSatang),
			"count":   unassignedCount,
		},
		"total": round2(total + fromSatang(unassignedSatang)),
	})
}

func (a *API) accountOptions(w http.ResponseWriter, r *http.Request) {
	banks, err := a.options(r.Context(), `SELECT id, '', name FROM banks ORDER BY sort_order, id`)
	if err != nil {
		serverError(w, err)
		return
	}
	types, err := a.options(r.Context(), `SELECT id, code, name FROM account_types ORDER BY sort_order, id`)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"banks": banks, "types": types})
}

func (a *API) options(ctx context.Context, query string) ([]Option, error) {
	rows, err := a.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Option{}
	for rows.Next() {
		var o Option
		if err := rows.Scan(&o.ID, &o.Code, &o.Name); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (a *API) getAccount(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	acc, err := a.fetchAccount(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		notFound(w)
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, acc)
}

func (a *API) createAccount(w http.ResponseWriter, r *http.Request) {
	in, ok := a.decodeAccountInput(w, r)
	if !ok {
		return
	}
	res, err := a.db.ExecContext(r.Context(),
		`INSERT INTO accounts (bank_id, type_id, name, opening_satang) VALUES (?, ?, ?, ?)`,
		in.BankID, in.TypeID, in.Name, toSatang(in.Opening))
	if err != nil {
		serverError(w, err)
		return
	}
	id, _ := res.LastInsertId()
	acc, err := a.fetchAccount(r.Context(), id)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, acc)
}

func (a *API) updateAccount(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	in, ok := a.decodeAccountInput(w, r)
	if !ok {
		return
	}
	res, err := a.db.ExecContext(r.Context(), `
		UPDATE accounts
		SET bank_id = ?, type_id = ?, name = ?, opening_satang = ?, updated_at = datetime('now')
		WHERE id = ?`,
		in.BankID, in.TypeID, in.Name, toSatang(in.Opening), id)
	if err != nil {
		serverError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		notFound(w)
		return
	}
	acc, err := a.fetchAccount(r.Context(), id)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, acc)
}

// deleteAccount refuses to delete an account that still has transactions,
// so no income/expense history is lost by accident.
func (a *API) deleteAccount(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var count int
	if err := a.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM transactions WHERE account_id = ?`, id).Scan(&count); err != nil {
		serverError(w, err)
		return
	}
	if count > 0 {
		writeJSON(w, http.StatusConflict, map[string]string{
			"error": "บัญชีนี้ยังมีรายการรับ/จ่ายอยู่ " + strconv.Itoa(count) + " รายการ กรุณาย้ายหรือลบรายการก่อน",
		})
		return
	}
	res, err := a.db.ExecContext(r.Context(), `DELETE FROM accounts WHERE id = ?`, id)
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

func (a *API) decodeAccountInput(w http.ResponseWriter, r *http.Request) (accountInput, bool) {
	var in accountInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		badRequest(w, "invalid JSON body")
		return in, false
	}
	if math.IsNaN(in.Opening) || math.IsInf(in.Opening, 0) {
		badRequest(w, "opening_balance must be a number")
		return in, false
	}
	var bankOK, typeOK bool
	if err := a.db.QueryRowContext(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM banks WHERE id = ?), EXISTS(SELECT 1 FROM account_types WHERE id = ?)`,
		in.BankID, in.TypeID).Scan(&bankOK, &typeOK); err != nil {
		serverError(w, err)
		return in, false
	}
	if !bankOK {
		badRequest(w, "unknown bank_id")
		return in, false
	}
	if !typeOK {
		badRequest(w, "unknown type_id")
		return in, false
	}
	in.Name = strings.TrimSpace(in.Name)
	return in, true
}
