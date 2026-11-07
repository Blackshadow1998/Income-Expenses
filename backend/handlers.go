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
	"time"
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

type API struct {
	db       *sql.DB
	slipsDir string // uploaded slip images
	imageKey []byte // signs slip image links (see slipImageURL)
	webDir   string // exported web app; "" = API only

	googleClientID string // Google sign-in is off when empty
	verifyGoogle   func(ctx context.Context, clientID, idToken string) (googleClaims, error)
	sendMail       func(to, subject, body string) error // nil when SMTP is not configured
}

func (a *API) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /api/auth/signup", a.signup)
	mux.HandleFunc("POST /api/auth/login", a.login)
	mux.HandleFunc("GET /api/auth/me", a.withSession(a.me))
	mux.HandleFunc("POST /api/auth/unlock", a.withSession(a.unlock))
	mux.HandleFunc("POST /api/auth/pin", a.withSession(a.setPIN))
	mux.HandleFunc("POST /api/auth/lock", a.withSession(a.lock))
	mux.HandleFunc("POST /api/auth/logout", a.withSession(a.logout))
	mux.HandleFunc("POST /api/auth/password", a.withSession(a.changePassword))
	mux.HandleFunc("POST /api/auth/forgot", a.forgotPassword)
	mux.HandleFunc("POST /api/auth/forgot/verify", a.verifyForgot)
	mux.HandleFunc("PUT /api/auth/email", a.withSession(a.setEmail))
	mux.HandleFunc("GET /api/auth/config", a.authConfig)
	mux.HandleFunc("POST /api/auth/google", a.googleSignIn)
	mux.HandleFunc("POST /api/auth/google/link", a.withSession(a.linkGoogle))
	mux.HandleFunc("GET /api/slips/{id}/image", a.slipImage) // signed link instead of a session

	// Everything below needs a signed-in, PIN-unlocked session and only sees that user's data.
	data := func(pattern string, h http.HandlerFunc) { mux.HandleFunc(pattern, a.requireUnlocked(h)) }
	data("POST /api/auth/ping", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	data("GET /api/categories", a.listCategories)
	data("GET /api/months", a.listMonths)
	data("GET /api/years", a.listYears)
	data("GET /api/balance", a.getBalance)
	data("GET /api/transactions", a.listTransactions)
	data("GET /api/transactions/search", a.searchTransactions)
	data("GET /api/transactions/{id}", a.getTransaction)
	data("POST /api/transactions", a.createTransaction)
	data("PUT /api/transactions/{id}", a.updateTransaction)
	data("DELETE /api/transactions/{id}", a.deleteTransaction)
	data("GET /api/summary/yearly", a.yearlySummary)
	data("GET /api/accounts", a.listAccounts)
	data("GET /api/accounts/options", a.accountOptions)
	data("GET /api/accounts/{id}", a.getAccount)
	data("POST /api/accounts", a.createAccount)
	data("PUT /api/accounts/{id}", a.updateAccount)
	data("DELETE /api/accounts/{id}", a.deleteAccount)
	data("GET /api/payees", a.listPayees)
	data("POST /api/slips", a.uploadSlips)
	data("GET /api/slips/{id}", a.getSlip)
	data("DELETE /api/slips/{id}", a.deleteSlip)
	data("POST /api/subcategories", a.createSubcategory)
	data("PUT /api/subcategories/{id}", a.renameSubcategory)
	data("DELETE /api/subcategories/{id}", a.deleteSubcategory)
	data("GET /api/slip-rules", a.listRules)
	data("POST /api/slip-rules", a.createRule)
	data("PUT /api/slip-rules/{id}", a.updateRule)
	data("DELETE /api/slip-rules/{id}", a.deleteRule)
	data("POST /api/slip-rules/{id}/move", a.moveRule)
	data("GET /api/debts", a.listDebts)
	data("GET /api/insights", a.insights)
	data("GET /api/export.csv", a.exportCSV)
	data("GET /api/recurring", a.listRecurring)
	data("POST /api/recurring", a.createRecurring)
	data("PUT /api/recurring/{id}", a.updateRecurring)
	data("DELETE /api/recurring/{id}", a.deleteRecurring)
	data("GET /api/budgets", a.listBudgets)
	data("POST /api/budgets", a.saveBudget)
	data("DELETE /api/budgets/{id}", a.deleteBudget)
	data("POST /api/transfers", a.createTransfer)
	data("GET /api/transfers/{id}", a.getTransfer)
	data("PUT /api/transfers/{id}", a.updateTransfer)
	data("DELETE /api/transfers/{id}", a.deleteTransfer)

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { notFound(w) })
	if a.webDir != "" {
		mux.Handle("/", webApp(a.webDir))
	}
	return cors(mux)
}

func (a *API) listCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(),
		`SELECT id, code, name, direction FROM categories ORDER BY sort_order, id`)
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	out := []Category{}
	index := map[int64]int{}
	for rows.Next() {
		c := Category{Subcategories: []Subcategory{}}
		if err := rows.Scan(&c.ID, &c.Code, &c.Name, &c.Direction); err != nil {
			serverError(w, err)
			return
		}
		index[c.ID] = len(out)
		out = append(out, c)
	}
	rows.Close()

	subs, err := a.db.QueryContext(r.Context(),
		`SELECT id, category_id, name FROM subcategories WHERE user_id = ? ORDER BY sort_order, id`, userID(r))
	if err != nil {
		serverError(w, err)
		return
	}
	defer subs.Close()
	for subs.Next() {
		var s Subcategory
		var catID int64
		if err := subs.Scan(&s.ID, &catID, &s.Name); err != nil {
			serverError(w, err)
			return
		}
		if i, ok := index[catID]; ok {
			out[i].Subcategories = append(out[i].Subcategories, s)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// listPayees returns payee names used before, most recently used first, for the form's suggestions.
func (a *API) listPayees(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), `
		SELECT payee FROM transactions WHERE user_id = ? AND payee <> ''
		GROUP BY payee ORDER BY MAX(txn_date) DESC, MAX(id) DESC LIMIT 50`, userID(r))
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			serverError(w, err)
			return
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, out)
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
		serverError(w, err)
		return
	}
	defer rows.Close()
	current := time.Now().Format("2006-01")
	months := []string{}
	hasCurrent := false
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			serverError(w, err)
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
	writeJSON(w, http.StatusOK, months)
}

func (a *API) listYears(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(),
		`SELECT DISTINCT CAST(substr(txn_date, 1, 4) AS INTEGER) FROM transactions WHERE user_id = ? ORDER BY 1 DESC`,
		userID(r))
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()
	current := time.Now().Year()
	years := []int{}
	hasCurrent := false
	for rows.Next() {
		var y int
		if err := rows.Scan(&y); err != nil {
			serverError(w, err)
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
	writeJSON(w, http.StatusOK, years)
}

// getBalance returns the all-time balance (opening amounts + transactions),
// for every account or for one account when account_id is given.
func (a *API) getBalance(w http.ResponseWriter, r *http.Request) {
	bal, err := a.balance(r, queryID(r, "account_id"))
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]float64{"balance": bal})
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
	return fromSatang(satang), err
}

// queryID reads an optional positive integer query parameter; 0 means "not given".
func queryID(r *http.Request, name string) int64 {
	id, err := strconv.ParseInt(r.URL.Query().Get(name), 10, 64)
	if err != nil || id < 0 {
		return 0
	}
	return id
}

func (a *API) listTransactions(w http.ResponseWriter, r *http.Request) {
	month := r.URL.Query().Get("month")
	start, err := time.Parse("2006-01", month)
	if err != nil {
		badRequest(w, "month must be YYYY-MM")
		return
	}
	end := start.AddDate(0, 1, 0)
	accountID := queryID(r, "account_id")

	rows, err := a.db.QueryContext(r.Context(), selectTxn+`
		WHERE t.user_id = ?4 AND t.txn_date >= ?1 AND t.txn_date < ?2 AND (?3 = 0 OR t.account_id = ?3)
		ORDER BY t.txn_date DESC, t.id DESC`,
		start.Format("2006-01-02"), end.Format("2006-01-02"), accountID, userID(r))
	if err != nil {
		serverError(w, err)
		return
	}
	defer rows.Close()

	items := []Transaction{}
	byCategory := map[string]float64{}
	var totalIn, totalOut int64
	for rows.Next() {
		t, satang, err := scanTxn(rows)
		if err != nil {
			serverError(w, err)
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
		serverError(w, err)
		return
	}
	// Pending slips have no account yet, so they are listed whatever the account filter.
	pending, err := a.pendingSlips(r.Context(), userID(r), start.Format("2006-01-02"), end.Format("2006-01-02"))
	if err != nil {
		serverError(w, err)
		return
	}
	transfers, err := a.monthTransfers(r.Context(), userID(r), start.Format("2006-01-02"), end.Format("2006-01-02"), accountID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"month":     month,
		"items":     items,
		"transfers": transfers, // not part of the in/out totals
		"pending":   pending,
		"totals": map[string]any{
			"in":          fromSatang(totalIn),
			"out":         fromSatang(totalOut),
			"net":         fromSatang(totalIn - totalOut),
			"by_category": byCategory,
		},
		"balance": bal,
	})
}

func (a *API) getTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	t, err := a.fetchTxn(r, id)
	if errors.Is(err, sql.ErrNoRows) {
		notFound(w)
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (a *API) createTransaction(w http.ResponseWriter, r *http.Request) {
	in, ok := a.decodeInput(w, r)
	if !ok {
		return
	}
	// Insert and (when confirming a slip) link the slip atomically.
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(r.Context(),
		`INSERT INTO transactions (user_id, txn_date, category_id, subcategory_id, account_id, amount_satang, note, payee)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		userID(r), in.Date, in.CategoryID, in.SubcategoryID, in.AccountID, toSatang(in.Amount), in.Note, in.Payee)
	if err != nil {
		serverError(w, err)
		return
	}
	id, _ := res.LastInsertId()
	if in.SlipID != nil {
		upd, err := tx.ExecContext(r.Context(),
			`UPDATE slips SET status = 'confirmed', transaction_id = ? WHERE id = ? AND user_id = ? AND status = 'pending'`,
			id, *in.SlipID, userID(r))
		if err != nil {
			serverError(w, err)
			return
		}
		if n, _ := upd.RowsAffected(); n == 0 {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "สลิปนี้ถูกคอนเฟิร์มหรือถูกลบไปแล้ว"})
			return
		}
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	t, err := a.fetchTxn(r, id)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

func (a *API) updateTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
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
		in.Date, in.CategoryID, in.SubcategoryID, in.AccountID, toSatang(in.Amount), in.Note, in.Payee, id, userID(r))
	if err != nil {
		serverError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		notFound(w)
		return
	}
	t, err := a.fetchTxn(r, id)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (a *API) deleteTransaction(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	// A transaction confirmed from a slip takes its slip (row + image) with it.
	uid := userID(r)
	var slipFile string
	err := a.db.QueryRowContext(r.Context(),
		`SELECT image_file FROM slips WHERE transaction_id = ? AND user_id = ?`, id, uid).Scan(&slipFile)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		serverError(w, err)
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM slips WHERE transaction_id = ? AND user_id = ?`, id, uid); err != nil {
		serverError(w, err)
		return
	}
	res, err := tx.ExecContext(r.Context(), `DELETE FROM transactions WHERE id = ? AND user_id = ?`, id, uid)
	if err != nil {
		serverError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		notFound(w)
		return
	}
	if err := tx.Commit(); err != nil {
		serverError(w, err)
		return
	}
	a.removeSlipFile(slipFile)
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
		badRequest(w, "year must be a number like 2026")
		return
	}
	rows, err := a.db.QueryContext(r.Context(), `
		SELECT CAST(substr(t.txn_date, 6, 2) AS INTEGER), c.code, c.direction, SUM(t.amount_satang)
		FROM transactions t JOIN categories c ON c.id = t.category_id
		WHERE t.user_id = ?4 AND t.txn_date >= ?1 AND t.txn_date < ?2 AND (?3 = 0 OR t.account_id = ?3)
		GROUP BY 1, c.code, c.direction`,
		strconv.Itoa(year)+"-01-01", strconv.Itoa(year+1)+"-01-01", queryID(r, "account_id"), userID(r))
	if err != nil {
		serverError(w, err)
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
			serverError(w, err)
			return
		}
		ms := &months[m-1]
		ms.ByCategory[code] = fromSatang(satang)
		if dir > 0 {
			ms.In += fromSatang(satang)
			yearIn += satang
		} else {
			ms.Out += fromSatang(satang)
			yearOut += satang
		}
	}
	for i := range months {
		months[i].Net = round2(months[i].In - months[i].Out)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"year":   year,
		"months": months,
		"totals": map[string]float64{
			"in":  fromSatang(yearIn),
			"out": fromSatang(yearOut),
			"net": fromSatang(yearIn - yearOut),
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
	t.Amount = fromSatang(satang)
	return t, satang, err
}

func (a *API) decodeInput(w http.ResponseWriter, r *http.Request) (transactionInput, bool) {
	var in transactionInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		badRequest(w, "invalid JSON body")
		return in, false
	}
	if _, err := time.Parse("2006-01-02", in.Date); err != nil {
		badRequest(w, "date must be YYYY-MM-DD")
		return in, false
	}
	if in.Amount <= 0 || math.IsNaN(in.Amount) || math.IsInf(in.Amount, 0) {
		badRequest(w, "amount must be greater than 0")
		return in, false
	}
	var exists bool
	if err := a.db.QueryRowContext(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM categories WHERE id = ?)`, in.CategoryID).Scan(&exists); err != nil {
		serverError(w, err)
		return in, false
	}
	if !exists {
		badRequest(w, "unknown category_id")
		return in, false
	}
	if in.AccountID == nil {
		badRequest(w, "account_id is required")
		return in, false
	}
	if err := a.db.QueryRowContext(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ? AND user_id = ?)`, *in.AccountID, userID(r)).Scan(&exists); err != nil {
		serverError(w, err)
		return in, false
	}
	if !exists {
		badRequest(w, "unknown account_id")
		return in, false
	}
	if in.SubcategoryID != nil {
		if err := a.db.QueryRowContext(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM subcategories WHERE id = ? AND category_id = ? AND user_id = ?)`,
			*in.SubcategoryID, in.CategoryID, userID(r)).Scan(&exists); err != nil {
			serverError(w, err)
			return in, false
		}
		if !exists {
			badRequest(w, "subcategory_id does not belong to category_id")
			return in, false
		}
	}
	in.Note = strings.TrimSpace(in.Note)
	in.Payee = strings.TrimSpace(in.Payee)
	return in, true
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		badRequest(w, "invalid id")
		return 0, false
	}
	return id, true
}

func toSatang(baht float64) int64 { return int64(math.Round(baht * 100)) }
func fromSatang(s int64) float64  { return float64(s) / 100 }
func round2(v float64) float64    { return math.Round(v*100) / 100 }

func sortDesc(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] > s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func badRequest(w http.ResponseWriter, msg string) {
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
}

func notFound(w http.ResponseWriter) {
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
}

func serverError(w http.ResponseWriter, err error) {
	logger.Printf("error: %v", err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
