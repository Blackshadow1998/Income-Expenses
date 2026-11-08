// Package server is the HTTP API. It wires sign-in (package auth) and trip bill splitting (package
// trip) with the money ledger kept here: accounts, transactions, slips, transfers, budgets, recurring
// items and debts. Every data route filters by the signed-in user (auth.UserID).
package server

import (
	"crypto/rand"
	"database/sql"
	"net/http"

	"income-expenses/internal/auth"
	"income-expenses/internal/httpx"
	"income-expenses/internal/images"
	"income-expenses/internal/trip"
	"income-expenses/internal/web"
)

// Options are what the API needs from outside.
type Options struct {
	DB             *sql.DB
	SlipsDir       string                               // uploaded slip and trip images
	WebDir         string                               // exported web app; "" = API only
	GoogleClientID string                               // Google sign-in is off when empty
	SendMail       func(to, subject, body string) error // nil when e-mail is not configured
}

// New builds the API. Slip image links are signed with a fresh key per start: they are short-lived
// and the app re-fetches them anyway.
func New(o Options) (*API, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	return newAPI(o.DB, images.New(o.SlipsDir, key), o.WebDir,
		auth.New(auth.Options{DB: o.DB, GoogleClientID: o.GoogleClientID, SendMail: o.SendMail})), nil
}

func newAPI(db *sql.DB, img *images.Store, webDir string, au *auth.Service) *API {
	return &API{db: db, images: img, webDir: webDir, auth: au, trips: trip.New(db, img)}
}

type API struct {
	db     *sql.DB
	images *images.Store // uploaded slip images and their signed links
	webDir string        // exported web app; "" = API only
	auth   *auth.Service
	trips  *trip.Service
}

// userID is the signed-in user of a data route.
func userID(r *http.Request) int64 { return auth.UserID(r) }

// Handler is the whole HTTP API (plus the web app when WebDir is set).
func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	a.auth.Register(mux)
	mux.HandleFunc("GET /api/slips/{id}/image", a.slipImage) // signed link instead of a session

	// Everything below needs a signed-in, PIN-unlocked session and only sees that user's data.
	a.trips.Register(mux, a.auth.RequireUnlocked)
	data := func(pattern string, h http.HandlerFunc) { mux.HandleFunc(pattern, a.auth.RequireUnlocked(h)) }
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

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { httpx.NotFound(w) })
	if a.webDir != "" {
		mux.Handle("/", web.Handler(a.webDir))
	}
	return httpx.CORS(mux)
}
