// Package server is the HTTP API: sign-in, accounts, transactions, slips, transfers, budgets,
// recurring items, debts and trip bill splitting. Every data route filters by the signed-in user.
package server

import (
	"context"
	"crypto/rand"
	"database/sql"
	"net/http"

	"income-expenses/internal/httpx"
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
	return &API{db: o.DB, slipsDir: o.SlipsDir, imageKey: key, webDir: o.WebDir,
		googleClientID: o.GoogleClientID, verifyGoogle: verifyGoogleToken, sendMail: o.SendMail}, nil
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

// Handler is the whole HTTP API (plus the web app when WebDir is set).
func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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
	mux.HandleFunc("GET /api/slips/{id}/image", a.slipImage)            // signed link instead of a session
	mux.HandleFunc("GET /api/trip-payments/{id}/slip", a.tripSlipImage) // likewise
	mux.HandleFunc("GET /api/trip-bills/{id}/image", a.tripBillImage)   // likewise

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
	data("GET /api/trips", a.listTrips)
	data("POST /api/trips", a.createTrip)
	data("GET /api/trips/{id}", a.getTrip)
	data("PUT /api/trips/{id}", a.updateTrip)
	data("DELETE /api/trips/{id}", a.deleteTrip)
	data("POST /api/trips/{id}/members", a.addTripMember)
	data("DELETE /api/trips/{id}/members/{member}", a.deleteTripMember)
	data("GET /api/trips/{id}/bills", a.listTripBills)
	data("POST /api/trips/{id}/bills", a.createTripBill)
	data("PUT /api/bills/{id}", a.updateTripBill)
	data("DELETE /api/bills/{id}", a.deleteTripBill)
	data("PUT /api/bills/{id}/image", a.setTripBillImage)
	data("DELETE /api/bills/{id}/image", a.setTripBillImage)
	data("GET /api/trips/{id}/summary", a.tripSummary)
	data("GET /api/trips/{id}/payments", a.listTripPayments)
	data("POST /api/trips/{id}/payments", a.createTripPayment)
	data("PATCH /api/payments/{id}", a.updateTripPayment)
	data("DELETE /api/payments/{id}", a.deleteTripPayment)
	data("PUT /api/payments/{id}/slip", a.setTripPaymentSlip)
	data("POST /api/trip-ocr", a.tripOCR)
	data("DELETE /api/payments/{id}/slip", a.setTripPaymentSlip)

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { httpx.NotFound(w) })
	if a.webDir != "" {
		mux.Handle("/", web.Handler(a.webDir))
	}
	return httpx.CORS(mux)
}
