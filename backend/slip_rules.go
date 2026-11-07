package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
)

// Slip rules: "when a slip looks like this, record it like that". They only fill in the confirm
// form (the user still confirms), checked top to bottom, first match wins.

type SlipRule struct {
	ID             int64  `json:"id"`
	Name           string `json:"name"`
	MatchKind      string `json:"match_kind"` // to | from | self
	MatchText      string `json:"match_text"`
	BankID         *int64 `json:"bank_id"` // receiver's bank must be this (optional)
	BankName       string `json:"bank_name"`
	Action         string `json:"action"` // transaction | transfer
	CategoryID     *int64 `json:"category_id"`
	CategoryName   string `json:"category_name"`
	SubcategoryID  *int64 `json:"subcategory_id"`
	Subcategory    string `json:"subcategory_name"`
	AccountID      *int64 `json:"account_id"`
	AccountLabel   string `json:"account_label"`
	ToAccountID    *int64 `json:"to_account_id"`
	ToAccountLabel string `json:"to_account_label"`
	Payee          string `json:"payee"`
	Note           string `json:"note"`
}

// SlipSuggestion is a matched rule resolved for one slip, ready to prefill the confirm form.
type SlipSuggestion struct {
	RuleID        int64  `json:"rule_id"`
	RuleName      string `json:"rule_name"`
	Action        string `json:"action"`
	CategoryID    *int64 `json:"category_id"`
	SubcategoryID *int64 `json:"subcategory_id"`
	AccountID     *int64 `json:"account_id"`    // paying account (transfer: from)
	ToAccountID   *int64 `json:"to_account_id"` // transfer only
	Payee         string `json:"payee"`
	Note          string `json:"note"`
}

var selectRule = `
	SELECT r.id, r.name, r.match_kind, r.match_text, r.bank_id, COALESCE(b.name, ''), r.action,
	       r.category_id, COALESCE(c.name, ''), r.subcategory_id, COALESCE(s.name, ''),
	       r.account_id, COALESCE(` + shortLabelSQL("fa", "fb", "ft") + `, ''),
	       r.to_account_id, COALESCE(` + shortLabelSQL("ta", "tb", "tt") + `, ''), r.payee, r.note
	FROM slip_rules r
	LEFT JOIN banks b ON b.id = r.bank_id
	LEFT JOIN categories c ON c.id = r.category_id
	LEFT JOIN subcategories s ON s.id = r.subcategory_id
	LEFT JOIN accounts fa ON fa.id = r.account_id LEFT JOIN banks fb ON fb.id = fa.bank_id LEFT JOIN account_types ft ON ft.id = fa.type_id
	LEFT JOIN accounts ta ON ta.id = r.to_account_id LEFT JOIN banks tb ON tb.id = ta.bank_id LEFT JOIN account_types tt ON tt.id = ta.type_id`

func (a *API) loadRules(ctx context.Context, uid int64) ([]SlipRule, error) {
	rows, err := a.db.QueryContext(ctx, selectRule+` WHERE r.user_id = ? ORDER BY r.sort_order, r.id`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SlipRule{}
	for rows.Next() {
		var r SlipRule
		if err := rows.Scan(&r.ID, &r.Name, &r.MatchKind, &r.MatchText, &r.BankID, &r.BankName, &r.Action,
			&r.CategoryID, &r.CategoryName, &r.SubcategoryID, &r.Subcategory, &r.AccountID, &r.AccountLabel,
			&r.ToAccountID, &r.ToAccountLabel, &r.Payee, &r.Note); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

var (
	titleRe    = regexp.MustCompile(`^(นางสาว|นาง|นาย|น\.?\s*ส\.?|ด\.?\s*ช\.?|ด\.?\s*ญ\.?|mrs\.?|mr\.?|ms\.?|miss)\s*`)
	nameJunkRe = regexp.MustCompile(`[\s.]+`)
)

// matchKey lowercases and drops spaces and dots, so "ร้าน ป้า" matches "ร้านป้า".
func matchKey(s string) string { return nameJunkRe.ReplaceAllString(strings.ToLower(s), "") }

// samePerson: sender and receiver are one person, allowing for the title and a shortened surname
// ("นาย สมชาย ใ" vs "สมชาย ใจดี").
func samePerson(a, b string) bool {
	words := func(s string) []string {
		return strings.Fields(titleRe.ReplaceAllString(strings.ToLower(strings.TrimSpace(s)), ""))
	}
	wa, wb := words(a), words(b)
	if len(wa) == 0 || len(wb) == 0 || wa[0] != wb[0] || len([]rune(wa[0])) < 2 {
		return false
	}
	if len(wa) > 1 && len(wb) > 1 {
		return []rune(wa[1])[0] == []rune(wb[1])[0]
	}
	return true
}

func (r SlipRule) matches(sl Slip) bool {
	if r.BankID != nil && (sl.ToBankID == nil || *sl.ToBankID != *r.BankID) {
		return false
	}
	switch r.MatchKind {
	case "self":
		return samePerson(sl.FromName, sl.ToName)
	case "from":
		return r.MatchText != "" && strings.Contains(matchKey(sl.FromName), matchKey(r.MatchText))
	default:
		return r.MatchText != "" && strings.Contains(matchKey(sl.ToName), matchKey(r.MatchText))
	}
}

// suggest returns what the first matching rule says to record for the slip, with accounts filled in
// from the slip's banks when the rule doesn't name them.
func (a *API) suggest(ctx context.Context, rules []SlipRule, sl Slip) (*SlipSuggestion, error) {
	for _, r := range rules {
		if !r.matches(sl) {
			continue
		}
		s := &SlipSuggestion{RuleID: r.ID, RuleName: r.Name, Action: r.Action, CategoryID: r.CategoryID,
			SubcategoryID: r.SubcategoryID, AccountID: r.AccountID, ToAccountID: r.ToAccountID, Payee: r.Payee, Note: r.Note}
		uid := a.slipOwner(ctx, sl.ID)
		if s.AccountID == nil && sl.BankID != nil {
			s.AccountID = a.accountAtBank(ctx, uid, *sl.BankID, nil)
		}
		if s.Action == "transfer" && s.ToAccountID == nil && sl.ToBankID != nil {
			s.ToAccountID = a.accountAtBank(ctx, uid, *sl.ToBankID, s.AccountID)
		}
		if s.Payee == "" && s.Action == "transaction" {
			s.Payee = sl.ToName
		}
		return s, nil
	}
	return nil, nil
}

func (a *API) slipOwner(ctx context.Context, slipID int64) int64 {
	var uid int64
	_ = a.db.QueryRowContext(ctx, `SELECT COALESCE(user_id, 0) FROM slips WHERE id = ?`, slipID).Scan(&uid)
	return uid
}

// accountAtBank is the user's first account at the bank, other than `not`.
func (a *API) accountAtBank(ctx context.Context, uid, bankID int64, not *int64) *int64 {
	var id int64
	skip := int64(0)
	if not != nil {
		skip = *not
	}
	if err := a.db.QueryRowContext(ctx,
		`SELECT id FROM accounts WHERE user_id = ? AND bank_id = ? AND id <> ? ORDER BY id LIMIT 1`, uid, bankID, skip,
	).Scan(&id); err != nil {
		return nil
	}
	return &id
}

func (a *API) listRules(w http.ResponseWriter, r *http.Request) {
	rules, err := a.loadRules(r.Context(), userID(r))
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

type ruleInput struct {
	Name          string `json:"name"`
	MatchKind     string `json:"match_kind"`
	MatchText     string `json:"match_text"`
	BankID        *int64 `json:"bank_id"`
	Action        string `json:"action"`
	CategoryID    *int64 `json:"category_id"`
	SubcategoryID *int64 `json:"subcategory_id"`
	AccountID     *int64 `json:"account_id"`
	ToAccountID   *int64 `json:"to_account_id"`
	Payee         string `json:"payee"`
	Note          string `json:"note"`
}

func (a *API) decodeRule(w http.ResponseWriter, r *http.Request) (ruleInput, bool) {
	var in ruleInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		badRequest(w, "invalid JSON body")
		return in, false
	}
	in.Name, in.MatchText = strings.TrimSpace(in.Name), strings.TrimSpace(in.MatchText)
	in.Payee, in.Note = strings.TrimSpace(in.Payee), strings.TrimSpace(in.Note)
	fail := func(msg string) (ruleInput, bool) { badRequest(w, msg); return in, false }
	if in.Name == "" || len([]rune(in.Name)) > 40 {
		return fail("ชื่อกฎต้องยาว 1–40 ตัวอักษร")
	}
	switch in.MatchKind {
	case "self":
		in.MatchText = ""
	case "to", "from":
		if in.MatchText == "" {
			return fail("กรุณาใส่คำที่ต้องเจอในชื่อ")
		}
	default:
		return fail("match_kind must be to, from or self")
	}
	switch in.Action {
	case "transaction":
		if in.CategoryID == nil {
			return fail("กรุณาเลือกหมวดหมู่")
		}
		in.ToAccountID = nil
	case "transfer":
		in.CategoryID, in.SubcategoryID, in.Payee = nil, nil, ""
	default:
		return fail("action must be transaction or transfer")
	}
	var ok bool
	if err := a.db.QueryRowContext(r.Context(), `
		SELECT (?1 IS NULL OR EXISTS(SELECT 1 FROM banks WHERE id = ?1))
		   AND (?2 IS NULL OR EXISTS(SELECT 1 FROM categories WHERE id = ?2))
		   AND (?3 IS NULL OR EXISTS(SELECT 1 FROM subcategories WHERE id = ?3 AND category_id = ?2 AND user_id = ?6))
		   AND (?4 IS NULL OR EXISTS(SELECT 1 FROM accounts WHERE id = ?4 AND user_id = ?6))
		   AND (?5 IS NULL OR EXISTS(SELECT 1 FROM accounts WHERE id = ?5 AND user_id = ?6))`,
		in.BankID, in.CategoryID, in.SubcategoryID, in.AccountID, in.ToAccountID, userID(r)).Scan(&ok); err != nil {
		serverError(w, err)
		return in, false
	}
	if !ok {
		return fail("unknown bank, category, item or account")
	}
	return in, true
}

func (a *API) createRule(w http.ResponseWriter, r *http.Request) {
	in, ok := a.decodeRule(w, r)
	if !ok {
		return
	}
	uid := userID(r)
	res, err := a.db.ExecContext(r.Context(), `
		INSERT INTO slip_rules (user_id, name, match_kind, match_text, bank_id, action, category_id, subcategory_id,
		                        account_id, to_account_id, payee, note, sort_order)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) FROM slip_rules WHERE user_id = ?), 0) + 1)`,
		uid, in.Name, in.MatchKind, in.MatchText, in.BankID, in.Action, in.CategoryID, in.SubcategoryID,
		in.AccountID, in.ToAccountID, in.Payee, in.Note, uid)
	if err != nil {
		serverError(w, err)
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, http.StatusCreated, map[string]int64{"id": id})
}

func (a *API) updateRule(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	in, ok := a.decodeRule(w, r)
	if !ok {
		return
	}
	res, err := a.db.ExecContext(r.Context(), `
		UPDATE slip_rules SET name = ?, match_kind = ?, match_text = ?, bank_id = ?, action = ?, category_id = ?,
		       subcategory_id = ?, account_id = ?, to_account_id = ?, payee = ?, note = ?
		WHERE id = ? AND user_id = ?`,
		in.Name, in.MatchKind, in.MatchText, in.BankID, in.Action, in.CategoryID, in.SubcategoryID,
		in.AccountID, in.ToAccountID, in.Payee, in.Note, id, userID(r))
	if err != nil {
		serverError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		notFound(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"id": id})
}

func (a *API) deleteRule(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	res, err := a.db.ExecContext(r.Context(), `DELETE FROM slip_rules WHERE id = ? AND user_id = ?`, id, userID(r))
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

// moveRule swaps a rule with its neighbour above ({"dir": -1}) or below ({"dir": 1}).
func (a *API) moveRule(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Dir int `json:"dir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || (in.Dir != -1 && in.Dir != 1) {
		badRequest(w, "dir must be -1 or 1")
		return
	}
	uid := userID(r)
	rules, err := a.loadRules(r.Context(), uid)
	if err != nil {
		serverError(w, err)
		return
	}
	at := -1
	for i, rule := range rules {
		if rule.ID == id {
			at = i
		}
	}
	if at < 0 {
		notFound(w)
		return
	}
	other := at + in.Dir
	if other < 0 || other >= len(rules) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	rules[at], rules[other] = rules[other], rules[at]
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()
	for i, rule := range rules {
		if _, err := tx.ExecContext(r.Context(), `UPDATE slip_rules SET sort_order = ? WHERE id = ?`, i+1, rule.ID); err != nil {
			serverError(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

var errSlipTaken = errors.New("slip already confirmed or deleted")

// confirmSlipAsTransfer links a pending slip to a transfer inside tx.
func confirmSlipAsTransfer(ctx context.Context, tx *sql.Tx, uid, slipID, transferID int64) error {
	res, err := tx.ExecContext(ctx,
		`UPDATE slips SET status = 'confirmed', transfer_id = ? WHERE id = ? AND user_id = ? AND status = 'pending'`,
		transferID, slipID, uid)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errSlipTaken
	}
	return nil
}
