// Package trip is trip bill splitting: a trip has members (plain names), bills shared between them
// and payments made to settle up. Who owes whom is always worked out from bills and payments (package
// split), never stored. Payment slips and bill photos live in the images folder as trip-* files.
package trip

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"income-expenses/internal/auth"
	"income-expenses/internal/httpx"
	"income-expenses/internal/i18n"
	"income-expenses/internal/images"
	"income-expenses/internal/money"
	"income-expenses/internal/split"
)

type Service struct {
	db     *sql.DB
	images *images.Store
}

func New(db *sql.DB, img *images.Store) *Service { return &Service{db: db, images: img} }

// Register adds the trip routes; guard (auth.RequireUnlocked) protects every one except the signed
// image links.
func (a *Service) Register(mux *http.ServeMux, guard func(http.HandlerFunc) http.HandlerFunc) {
	mux.HandleFunc("GET /api/trip-payments/{id}/slip", a.tripSlipImage) // signed link instead of a session
	mux.HandleFunc("GET /api/trip-bills/{id}/image", a.tripBillImage)   // likewise
	mux.HandleFunc("GET /api/trip-members/{id}/qr", a.tripMemberQR)     // likewise
	data := func(pattern string, h http.HandlerFunc) { mux.HandleFunc(pattern, guard(h)) }
	data("GET /api/trips", a.listTrips)
	data("POST /api/trips", a.createTrip)
	data("GET /api/trips/{id}", a.getTrip)
	data("PUT /api/trips/{id}", a.updateTrip)
	data("DELETE /api/trips/{id}", a.deleteTrip)
	data("POST /api/trips/{id}/members", a.addTripMember)
	data("POST /api/trips/{id}/pool", a.addTripPool)
	data("PUT /api/trips/{id}/members/{member}", a.updateTripMember)
	data("PUT /api/members/{id}/qr", a.setTripMemberQR)
	data("DELETE /api/members/{id}/qr", a.setTripMemberQR)
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
	data("DELETE /api/payments/{id}/slip", a.setTripPaymentSlip)
	data("POST /api/trip-ocr", a.tripOCR)
}

// TripMember is a person on the trip, or the trip's shared pool (IsPool), with how to pay them.
type TripMember struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	IsPool      bool   `json:"is_pool"`
	PromptPay   string `json:"promptpay"` // mobile (10), ID card (13) or e-Wallet (15) digits
	BankName    string `json:"bank_name"`
	BankAccount string `json:"bank_account"`
	AccountName string `json:"account_name"`
	QRURL       string `json:"qr_url"` // signed link to their payment QR picture, '' without one
}

// TripPool is the shared pool's money. It is a member that never shares bills: members pay into it,
// bills are paid from it and what is left is handed back, all through the usual balances.
type TripPool struct {
	MemberID int64   `json:"member_id"`
	In       float64 `json:"in"`      // paid into the pool
	Spent    float64 `json:"spent"`   // bills paid from it
	Out      float64 `json:"out"`     // paid out of it (refunds)
	Balance  float64 `json:"balance"` // what it should hold now
}

type TripBillPart struct {
	MemberID int64   `json:"member_id"`
	Value    float64 `json:"value"` // baht ('amount' mode) or weight ('ratio'); 0 for 'equal'
	Share    float64 `json:"share"` // what this member owes towards the bill
}

type TripBill struct {
	ID        int64          `json:"id"`
	Title     string         `json:"title"`
	Amount    float64        `json:"amount"`
	PayerID   int64          `json:"payer_id"`
	SplitMode string         `json:"split_mode"`
	Date      string         `json:"date"`
	ImageURL  string         `json:"image_url"` // signed link to the bill's photo, '' without one
	Parts     []TripBillPart `json:"parts"`
}

type TripPayment struct {
	ID          int64   `json:"id"`
	From        int64   `json:"from_member"`
	To          int64   `json:"to_member"`
	Amount      float64 `json:"amount"`
	Date        string  `json:"date"`
	Note        string  `json:"note"`
	SlipURL     string  `json:"slip_url"` // signed link, '' without a slip
	Confirmed   bool    `json:"confirmed"`
	ConfirmedAt string  `json:"confirmed_at"`
}

type Trip struct {
	ID        int64         `json:"id"`
	Name      string        `json:"name"`
	CreatedAt string        `json:"created_at"`
	Total     float64       `json:"total"` // all bills
	Members   []TripMember  `json:"members"`
	Bills     []TripBill    `json:"bills"`
	Payments  []TripPayment `json:"payments"`
	Pool      *TripPool     `json:"pool"` // nil when the trip has no shared pool
}

const maxTripSlipBytes = 10 << 20

// tripData is a trip loaded for working out balances.
type tripData struct {
	Trip
	members  []int64
	bills    []split.Bill
	payments []split.Payment
	names    map[int64]string
}

func (a *Service) ownsTrip(ctx context.Context, uid, tripID int64) (bool, error) {
	var ok bool
	err := a.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM trips WHERE id = ? AND user_id = ?)`, tripID, uid).Scan(&ok)
	return ok, err
}

// tripOf returns the trip a bill or payment belongs to, when the user owns it (0 otherwise).
func (a *Service) tripOf(ctx context.Context, uid int64, table string, id int64) (int64, error) {
	var tripID int64
	err := a.db.QueryRowContext(ctx, `SELECT x.trip_id FROM `+table+` x JOIN trips t ON t.id = x.trip_id WHERE x.id = ? AND t.user_id = ?`,
		id, uid).Scan(&tripID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return tripID, err
}

// loadTrip reads a trip with its members, bills and payments; sql.ErrNoRows when it isn't the user's.
func (a *Service) loadTrip(ctx context.Context, uid, id int64) (*tripData, error) {
	t := &tripData{names: map[int64]string{}}
	err := a.db.QueryRowContext(ctx, `SELECT id, name, created_at FROM trips WHERE id = ? AND user_id = ?`, id, uid).
		Scan(&t.ID, &t.Name, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, name, is_pool, promptpay, bank_name, bank_account, account_name, qr_file
		FROM trip_members WHERE trip_id = ? ORDER BY sort_order, id`, id)
	if err != nil {
		return nil, err
	}
	t.Members = []TripMember{}
	for rows.Next() {
		var m TripMember
		var qr string
		if err := rows.Scan(&m.ID, &m.Name, &m.IsPool, &m.PromptPay, &m.BankName, &m.BankAccount, &m.AccountName, &qr); err != nil {
			rows.Close()
			return nil, err
		}
		if m.IsPool {
			m.Name = i18n.T(i18n.FromContext(ctx), poolName)
			t.Pool = &TripPool{MemberID: m.ID}
		}
		if qr != "" {
			m.QRURL = a.images.Link(memberQR.path, memberQR.sig, m.ID)
		}
		t.Members = append(t.Members, m)
		t.members = append(t.members, m.ID)
		t.names[m.ID] = m.Name
	}
	rows.Close()

	rows, err = a.db.QueryContext(ctx, `
		SELECT b.id, b.title, b.amount_satang, b.payer_id, b.split_mode, b.bill_date, b.image_file, p.member_id, p.value
		FROM trip_bills b JOIN trip_bill_parts p ON p.bill_id = b.id
		WHERE b.trip_id = ? ORDER BY b.bill_date DESC, b.id DESC, p.sort_order`, id)
	if err != nil {
		return nil, err
	}
	t.Bills = []TripBill{}
	var amounts []int64
	for rows.Next() {
		var b TripBill
		var amount, member, value int64
		var image string
		if err := rows.Scan(&b.ID, &b.Title, &amount, &b.PayerID, &b.SplitMode, &b.Date, &image, &member, &value); err != nil {
			rows.Close()
			return nil, err
		}
		if n := len(t.Bills); n == 0 || t.Bills[n-1].ID != b.ID {
			b.Amount = money.FromSatang(amount)
			if image != "" {
				b.ImageURL = a.images.Link(billImage.path, billImage.sig, b.ID)
			}
			t.Bills = append(t.Bills, b)
			t.bills = append(t.bills, split.Bill{Payer: b.PayerID, Amount: amount, Mode: b.SplitMode})
			amounts = append(amounts, amount)
		}
		last := len(t.bills) - 1
		t.bills[last].Parts = append(t.bills[last].Parts, split.Part{Member: member, Value: value})
		v := float64(value)
		if t.bills[last].Mode == split.Amount {
			v = money.FromSatang(value)
		}
		t.Bills[last].Parts = append(t.Bills[last].Parts, TripBillPart{MemberID: member, Value: v})
	}
	rows.Close()
	var total int64
	for i, b := range t.bills {
		total += amounts[i]
		shares, err := split.Shares(b)
		if err != nil {
			return nil, fmt.Errorf("bill %d: %w", t.Bills[i].ID, err)
		}
		for j, s := range shares {
			t.Bills[i].Parts[j].Share = money.FromSatang(s.Amount)
		}
	}
	t.Total = money.FromSatang(total)

	rows, err = a.db.QueryContext(ctx, `
		SELECT id, from_member, to_member, amount_satang, paid_on, note, slip_file, COALESCE(confirmed_at, '')
		FROM trip_payments WHERE trip_id = ? ORDER BY paid_on DESC, id DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	t.Payments = []TripPayment{}
	for rows.Next() {
		var p TripPayment
		var amount int64
		var slip string
		if err := rows.Scan(&p.ID, &p.From, &p.To, &amount, &p.Date, &p.Note, &slip, &p.ConfirmedAt); err != nil {
			return nil, err
		}
		p.Amount = money.FromSatang(amount)
		p.Confirmed = p.ConfirmedAt != ""
		if slip != "" {
			p.SlipURL = a.images.Link(paymentSlip.path, paymentSlip.sig, p.ID)
		}
		t.Payments = append(t.Payments, p)
		t.payments = append(t.payments, split.Payment{From: p.From, To: p.To, Amount: amount})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if t.Pool != nil {
		var in, spent, out int64
		for i, b := range t.bills {
			if b.Payer == t.Pool.MemberID {
				spent += amounts[i]
			}
		}
		for _, p := range t.payments {
			if p.To == t.Pool.MemberID {
				in += p.Amount
			}
			if p.From == t.Pool.MemberID {
				out += p.Amount
			}
		}
		t.Pool.In, t.Pool.Spent, t.Pool.Out = money.FromSatang(in), money.FromSatang(spent), money.FromSatang(out)
		t.Pool.Balance = money.FromSatang(in - spent - out)
	}
	return t, nil
}

func (a *Service) listTrips(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), `
		SELECT t.id, t.name, t.created_at,
		       (SELECT COUNT(*) FROM trip_members m WHERE m.trip_id = t.id AND m.is_pool = 0),
		       (SELECT COUNT(*) FROM trip_bills b WHERE b.trip_id = t.id),
		       (SELECT COALESCE(SUM(amount_satang), 0) FROM trip_bills b WHERE b.trip_id = t.id)
		FROM trips t WHERE t.user_id = ? ORDER BY t.id DESC`, auth.UserID(r))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer rows.Close()
	type item struct {
		ID          int64   `json:"id"`
		Name        string  `json:"name"`
		CreatedAt   string  `json:"created_at"`
		MemberCount int     `json:"member_count"`
		BillCount   int     `json:"bill_count"`
		Total       float64 `json:"total"`
	}
	out := []item{}
	for rows.Next() {
		var it item
		var total int64
		if err := rows.Scan(&it.ID, &it.Name, &it.CreatedAt, &it.MemberCount, &it.BillCount, &total); err != nil {
			httpx.ServerError(w, err)
			return
		}
		it.Total = money.FromSatang(total)
		out = append(out, it)
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func tidyName(s string, max int) (string, bool) {
	s = strings.Join(strings.Fields(s), " ")
	n := len([]rune(s))
	return s, n > 0 && n <= max
}

func (a *Service) createTrip(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name    string   `json:"name"`
		Members []string `json:"members"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpx.BadRequest(w, "invalid JSON body")
		return
	}
	name, ok := tidyName(in.Name, 60)
	if !ok {
		httpx.BadRequest(w, "กรุณาตั้งชื่อทริป (ไม่เกิน 60 ตัวอักษร)")
		return
	}
	var members []string
	seen := map[string]bool{}
	for _, m := range in.Members {
		m, ok := tidyName(m, 40)
		if !ok || seen[m] {
			continue
		}
		seen[m] = true
		members = append(members, m)
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(r.Context(), `INSERT INTO trips (user_id, name) VALUES (?, ?)`, auth.UserID(r), name)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	id, _ := res.LastInsertId()
	for i, m := range members {
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO trip_members (trip_id, name, sort_order) VALUES (?, ?, ?)`, id, m, i); err != nil {
			httpx.ServerError(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		httpx.ServerError(w, err)
		return
	}
	a.respondTrip(w, r, id, http.StatusCreated)
}

func (a *Service) respondTrip(w http.ResponseWriter, r *http.Request, id int64, status int) {
	t, err := a.loadTrip(r.Context(), auth.UserID(r), id)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	httpx.WriteJSON(w, status, t.Trip)
}

func (a *Service) getTrip(w http.ResponseWriter, r *http.Request) {
	if id, ok := httpx.PathID(w, r); ok {
		a.respondTrip(w, r, id, http.StatusOK)
	}
}

func (a *Service) updateTrip(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpx.BadRequest(w, "invalid JSON body")
		return
	}
	name, ok := tidyName(in.Name, 60)
	if !ok {
		httpx.BadRequest(w, "กรุณาตั้งชื่อทริป (ไม่เกิน 60 ตัวอักษร)")
		return
	}
	res, err := a.db.ExecContext(r.Context(), `UPDATE trips SET name = ? WHERE id = ? AND user_id = ?`, name, id, auth.UserID(r))
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.NotFound(w)
		return
	}
	a.respondTrip(w, r, id, http.StatusOK)
}

func (a *Service) deleteTrip(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	files, err := a.tripFiles(r.Context(), paymentSlip, `trip_id = ?`, id)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	for _, k := range []tripImage{billImage, memberQR} {
		more, err := a.tripFiles(r.Context(), k, `trip_id = ?`, id)
		if err != nil {
			httpx.ServerError(w, err)
			return
		}
		files = append(files, more...)
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer tx.Rollback()
	// Children first: bills and payments reference members, which the cascade would remove first.
	for _, q := range []string{
		`DELETE FROM trip_payments WHERE trip_id = ?1 AND trip_id IN (SELECT id FROM trips WHERE user_id = ?2)`,
		`DELETE FROM trip_bills WHERE trip_id = ?1 AND trip_id IN (SELECT id FROM trips WHERE user_id = ?2)`,
	} {
		if _, err := tx.ExecContext(r.Context(), q, id, auth.UserID(r)); err != nil {
			httpx.ServerError(w, err)
			return
		}
	}
	res, err := tx.ExecContext(r.Context(), `DELETE FROM trips WHERE id = ? AND user_id = ?`, id, auth.UserID(r))
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
	for _, f := range files {
		a.images.Remove(f)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *Service) addTripMember(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpx.BadRequest(w, "invalid JSON body")
		return
	}
	name, ok := tidyName(in.Name, 40)
	if !ok {
		httpx.BadRequest(w, "กรุณาใส่ชื่อสมาชิก (ไม่เกิน 40 ตัวอักษร)")
		return
	}
	if owns, err := a.ownsTrip(r.Context(), auth.UserID(r), id); err != nil || !owns {
		if err != nil {
			httpx.ServerError(w, err)
		} else {
			httpx.NotFound(w)
		}
		return
	}
	_, err := a.db.ExecContext(r.Context(), `
		INSERT INTO trip_members (trip_id, name, sort_order)
		VALUES (?1, ?2, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM trip_members WHERE trip_id = ?1))`, id, name)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			httpx.WriteJSON(w, http.StatusConflict, map[string]string{"error": "มีสมาชิกชื่อนี้ในทริปแล้ว"})
			return
		}
		httpx.ServerError(w, err)
		return
	}
	a.respondTrip(w, r, id, http.StatusCreated)
}

func (a *Service) deleteTripMember(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	member, err := strconv.ParseInt(r.PathValue("member"), 10, 64)
	if err != nil {
		httpx.BadRequest(w, "invalid member id")
		return
	}
	if owns, err := a.ownsTrip(r.Context(), auth.UserID(r), id); err != nil || !owns {
		if err != nil {
			httpx.ServerError(w, err)
		} else {
			httpx.NotFound(w)
		}
		return
	}
	var used int
	if err := a.db.QueryRowContext(r.Context(), `
		SELECT (SELECT COUNT(*) FROM trip_bills WHERE trip_id = ?1 AND payer_id = ?2)
		     + (SELECT COUNT(*) FROM trip_bill_parts p JOIN trip_bills b ON b.id = p.bill_id WHERE b.trip_id = ?1 AND p.member_id = ?2)
		     + (SELECT COUNT(*) FROM trip_payments WHERE trip_id = ?1 AND (from_member = ?2 OR to_member = ?2))`,
		id, member).Scan(&used); err != nil {
		httpx.ServerError(w, err)
		return
	}
	if used > 0 {
		httpx.WriteJSON(w, http.StatusConflict, map[string]string{"error": "ลบไม่ได้: สมาชิกคนนี้มีบิลหรือการจ่ายเงินอยู่ ให้ลบหรือแก้บิลเหล่านั้นก่อน"})
		return
	}
	files, err := a.tripFiles(r.Context(), memberQR, `id = ?`, member)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	res, err := a.db.ExecContext(r.Context(), `DELETE FROM trip_members WHERE id = ? AND trip_id = ?`, member, id)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpx.NotFound(w)
		return
	}
	for _, f := range files {
		a.images.Remove(f)
	}
	a.respondTrip(w, r, id, http.StatusOK)
}

// poolName is the shared pool's name in the database (Thai; answered in the client's language).
const poolName = "กองกลาง"

// addTripPool gives the trip its shared pool; a trip has at most one.
func (a *Service) addTripPool(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	if owns, err := a.ownsTrip(r.Context(), auth.UserID(r), id); err != nil || !owns {
		if err != nil {
			httpx.ServerError(w, err)
		} else {
			httpx.NotFound(w)
		}
		return
	}
	var has bool
	if err := a.db.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM trip_members WHERE trip_id = ? AND is_pool = 1)`, id).Scan(&has); err != nil {
		httpx.ServerError(w, err)
		return
	}
	if has {
		httpx.WriteJSON(w, http.StatusConflict, map[string]string{"error": "ทริปนี้มีกองกลางแล้ว"})
		return
	}
	if _, err := a.db.ExecContext(r.Context(), `
		INSERT INTO trip_members (trip_id, name, is_pool, sort_order)
		VALUES (?1, ?2, 1, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM trip_members WHERE trip_id = ?1))`, id, poolName); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			httpx.WriteJSON(w, http.StatusConflict, map[string]string{"error": "มีสมาชิกชื่อนี้ในทริปแล้ว"})
			return
		}
		httpx.ServerError(w, err)
		return
	}
	a.respondTrip(w, r, id, http.StatusCreated)
}

// promptPayID keeps the digits of a PromptPay ID and checks its length: a mobile number (10, from
// 0), an ID card or tax number (13) or an e-Wallet ID (15); ” is allowed (none).
func promptPayID(s string) (string, bool) {
	var b strings.Builder
	for _, c := range s {
		switch {
		case c >= '0' && c <= '9':
			b.WriteRune(c)
		case c == ' ' || c == '-':
		default:
			return "", false
		}
	}
	d := b.String()
	switch len(d) {
	case 0, 13, 15:
		return d, true
	case 10:
		return d, d[0] == '0'
	}
	return "", false
}

// updateTripMember renames a member (not the pool) and sets how to pay them.
func (a *Service) updateTripMember(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	member, err := strconv.ParseInt(r.PathValue("member"), 10, 64)
	if err != nil {
		httpx.BadRequest(w, "invalid member id")
		return
	}
	var in struct {
		Name        string `json:"name"`
		PromptPay   string `json:"promptpay"`
		BankName    string `json:"bank_name"`
		BankAccount string `json:"bank_account"`
		AccountName string `json:"account_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpx.BadRequest(w, "invalid JSON body")
		return
	}
	pp, ok := promptPayID(in.PromptPay)
	if !ok {
		httpx.BadRequest(w, "เลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก เลขบัตรประชาชน 13 หลัก หรือ e-Wallet 15 หลัก")
		return
	}
	bank := strings.Join(strings.Fields(in.BankName), " ")
	account := strings.TrimSpace(in.BankAccount)
	holder := strings.Join(strings.Fields(in.AccountName), " ")
	if len([]rune(bank)) > 60 || len([]rune(account)) > 30 || len([]rune(holder)) > 80 {
		httpx.BadRequest(w, "ข้อมูลบัญชียาวเกินไป")
		return
	}
	if owns, err := a.ownsTrip(r.Context(), auth.UserID(r), id); err != nil || !owns {
		if err != nil {
			httpx.ServerError(w, err)
		} else {
			httpx.NotFound(w)
		}
		return
	}
	var isPool bool
	err = a.db.QueryRowContext(r.Context(), `SELECT is_pool FROM trip_members WHERE id = ? AND trip_id = ?`, member, id).Scan(&isPool)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	name := poolName
	if !isPool {
		if name, ok = tidyName(in.Name, 40); !ok {
			httpx.BadRequest(w, "กรุณาใส่ชื่อสมาชิก (ไม่เกิน 40 ตัวอักษร)")
			return
		}
	}
	if _, err := a.db.ExecContext(r.Context(), `
		UPDATE trip_members SET name = ?, promptpay = ?, bank_name = ?, bank_account = ?, account_name = ? WHERE id = ?`,
		name, pp, bank, account, holder, member); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			httpx.WriteJSON(w, http.StatusConflict, map[string]string{"error": "มีสมาชิกชื่อนี้ในทริปแล้ว"})
			return
		}
		httpx.ServerError(w, err)
		return
	}
	a.respondTrip(w, r, id, http.StatusOK)
}

type tripBillInput struct {
	Title     string  `json:"title"`
	Amount    float64 `json:"amount"`
	PayerID   int64   `json:"payer_id"`
	SplitMode string  `json:"split_mode"`
	Date      string  `json:"date"`
	Parts     []struct {
		MemberID int64   `json:"member_id"`
		Value    float64 `json:"value"`
	} `json:"parts"`
}

// decodeBill validates a bill against the trip's members and returns it with values in satang/weights.
func (a *Service) decodeBill(w http.ResponseWriter, r *http.Request, tripID int64) (tripBillInput, split.Bill, bool) {
	var in tripBillInput
	var b split.Bill
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpx.BadRequest(w, "invalid JSON body")
		return in, b, false
	}
	var ok bool
	if in.Title, ok = tidyName(in.Title, 80); !ok {
		httpx.BadRequest(w, "กรุณาใส่ชื่อรายการ (ไม่เกิน 80 ตัวอักษร)")
		return in, b, false
	}
	if _, err := time.Parse("2006-01-02", in.Date); err != nil {
		httpx.BadRequest(w, "date must be YYYY-MM-DD")
		return in, b, false
	}
	if in.SplitMode == "" {
		in.SplitMode = split.Equal
	}
	members := map[int64]bool{}
	var pool int64
	rows, err := a.db.QueryContext(r.Context(), `SELECT id, is_pool FROM trip_members WHERE trip_id = ?`, tripID)
	if err != nil {
		httpx.ServerError(w, err)
		return in, b, false
	}
	for rows.Next() {
		var id int64
		var isPool bool
		if err := rows.Scan(&id, &isPool); err != nil {
			rows.Close()
			httpx.ServerError(w, err)
			return in, b, false
		}
		members[id] = true
		if isPool {
			pool = id
		}
	}
	rows.Close()
	if !members[in.PayerID] {
		httpx.BadRequest(w, "กรุณาเลือกผู้จ่าย")
		return in, b, false
	}
	b = split.Bill{Payer: in.PayerID, Amount: money.ToSatang(in.Amount), Mode: in.SplitMode}
	for _, p := range in.Parts {
		if !members[p.MemberID] {
			httpx.BadRequest(w, "คนหารต้องเป็นสมาชิกของทริป")
			return in, b, false
		}
		if p.MemberID == pool {
			httpx.BadRequest(w, "กองกลางร่วมหารบิลไม่ได้")
			return in, b, false
		}
		v := int64(0)
		switch in.SplitMode {
		case split.Amount:
			v = money.ToSatang(p.Value)
		case split.Ratio:
			v = int64(p.Value)
			if float64(v) != p.Value {
				httpx.BadRequest(w, "สัดส่วนต้องเป็นจำนวนเต็ม")
				return in, b, false
			}
		}
		b.Parts = append(b.Parts, split.Part{Member: p.MemberID, Value: v})
	}
	if _, err := split.Shares(b); err != nil {
		httpx.BadRequest(w, err.Error())
		return in, b, false
	}
	return in, b, true
}

func writeBillParts(ctx context.Context, tx *sql.Tx, billID int64, b split.Bill) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM trip_bill_parts WHERE bill_id = ?`, billID); err != nil {
		return err
	}
	for i, p := range b.Parts {
		if _, err := tx.ExecContext(ctx, `INSERT INTO trip_bill_parts (bill_id, member_id, value, sort_order) VALUES (?, ?, ?, ?)`,
			billID, p.Member, p.Value, i); err != nil {
			return err
		}
	}
	return nil
}

func (a *Service) listTripBills(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	t, err := a.loadTrip(r.Context(), auth.UserID(r), id)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, t.Bills)
}

func (a *Service) createTripBill(w http.ResponseWriter, r *http.Request) {
	tripID, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	if owns, err := a.ownsTrip(r.Context(), auth.UserID(r), tripID); err != nil || !owns {
		if err != nil {
			httpx.ServerError(w, err)
		} else {
			httpx.NotFound(w)
		}
		return
	}
	in, b, ok := a.decodeBill(w, r, tripID)
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
		INSERT INTO trip_bills (trip_id, title, amount_satang, payer_id, split_mode, bill_date) VALUES (?, ?, ?, ?, ?, ?)`,
		tripID, in.Title, b.Amount, b.Payer, b.Mode, in.Date)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	id, _ := res.LastInsertId()
	if err := writeBillParts(r.Context(), tx, id, b); err != nil {
		httpx.ServerError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.ServerError(w, err)
		return
	}
	a.respondTrip(w, r, tripID, http.StatusCreated)
}

func (a *Service) updateTripBill(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	tripID, err := a.tripOf(r.Context(), auth.UserID(r), "trip_bills", id)
	if err != nil || tripID == 0 {
		if err != nil {
			httpx.ServerError(w, err)
		} else {
			httpx.NotFound(w)
		}
		return
	}
	in, b, ok := a.decodeBill(w, r, tripID)
	if !ok {
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `
		UPDATE trip_bills SET title = ?, amount_satang = ?, payer_id = ?, split_mode = ?, bill_date = ? WHERE id = ?`,
		in.Title, b.Amount, b.Payer, b.Mode, in.Date, id); err != nil {
		httpx.ServerError(w, err)
		return
	}
	if err := writeBillParts(r.Context(), tx, id, b); err != nil {
		httpx.ServerError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.ServerError(w, err)
		return
	}
	a.respondTrip(w, r, tripID, http.StatusOK)
}

func (a *Service) deleteTripBill(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	tripID, err := a.tripOf(r.Context(), auth.UserID(r), "trip_bills", id)
	if err != nil || tripID == 0 {
		if err != nil {
			httpx.ServerError(w, err)
		} else {
			httpx.NotFound(w)
		}
		return
	}
	files, err := a.tripFiles(r.Context(), billImage, `id = ?`, id)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if _, err := a.db.ExecContext(r.Context(), `DELETE FROM trip_bills WHERE id = ?`, id); err != nil {
		httpx.ServerError(w, err)
		return
	}
	for _, f := range files {
		a.images.Remove(f)
	}
	a.respondTrip(w, r, tripID, http.StatusOK)
}

// --- Summary ---

type tripPerson struct {
	MemberID int64       `json:"member_id"`
	Name     string      `json:"name"`
	Net      float64     `json:"net"` // still to receive (+) or to pay (−)
	Receive  []tripOwing `json:"receive"`
	Pay      []tripOwing `json:"pay"`
}

type tripOwing struct {
	MemberID int64   `json:"member_id"`
	Name     string  `json:"name"`
	Amount   float64 `json:"amount"`
}

type tripPair struct {
	From      int64   `json:"from"`
	To        int64   `json:"to"`
	FromName  string  `json:"from_name"`
	ToName    string  `json:"to_name"`
	Owed      float64 `json:"owed"`
	Paid      float64 `json:"paid"`
	Remaining float64 `json:"remaining"`
	Status    string  `json:"status"` // unpaid | partial | paid
}

func (a *Service) tripSummary(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "pairwise"
	}
	if mode != "pairwise" && mode != "minimal" {
		httpx.BadRequest(w, "mode must be pairwise or minimal")
		return
	}
	t, err := a.loadTrip(r.Context(), auth.UserID(r), id)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	pairs, err := split.Pairwise(t.members, t.bills, t.payments)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	nets, err := split.Nets(t.members, t.bills, t.payments)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	out := struct {
		Mode      string       `json:"mode"`
		Total     float64      `json:"total"`
		Pairs     []tripPair   `json:"pairs"`
		Transfers []tripPair   `json:"transfers"` // minimal mode: what's left to transfer
		People    []tripPerson `json:"people"`
		Progress  struct {
			Owed float64 `json:"owed"` // all pair debts
			Paid float64 `json:"paid"` // paid towards them
		} `json:"progress"`
	}{Mode: mode, Total: t.Total, Pairs: []tripPair{}, Transfers: []tripPair{}, People: []tripPerson{}}

	var owed, paid int64
	people := map[int64]*tripPerson{}
	for _, m := range t.Members {
		p := &tripPerson{MemberID: m.ID, Name: m.Name, Net: money.FromSatang(nets[m.ID]), Receive: []tripOwing{}, Pay: []tripOwing{}}
		people[m.ID] = p
	}
	owe := func(from, to, amount int64) {
		if amount <= 0 {
			return
		}
		people[from].Pay = append(people[from].Pay, tripOwing{to, t.names[to], money.FromSatang(amount)})
		people[to].Receive = append(people[to].Receive, tripOwing{from, t.names[from], money.FromSatang(amount)})
	}
	for _, p := range pairs {
		owed += p.Owed
		paid += min(max(p.Paid, 0), p.Owed)
		if p.Remaining < 0 {
			// Paid more than owed (e.g. into the pool): the rest is handed back, shown as a debt the other way.
			back := money.FromSatang(-p.Remaining)
			out.Pairs = append(out.Pairs, tripPair{p.To, p.From, t.names[p.To], t.names[p.From], back, 0, back, split.Unpaid})
			if mode == "pairwise" {
				owe(p.To, p.From, -p.Remaining)
			}
			continue
		}
		out.Pairs = append(out.Pairs, tripPair{p.From, p.To, t.names[p.From], t.names[p.To],
			money.FromSatang(p.Owed), money.FromSatang(p.Paid), money.FromSatang(p.Remaining), p.Status})
		if mode == "pairwise" {
			owe(p.From, p.To, p.Remaining)
		}
	}
	if mode == "minimal" {
		transfers, err := split.Minimal(t.members, t.bills, t.payments)
		if err != nil {
			httpx.ServerError(w, err)
			return
		}
		for _, tr := range transfers {
			out.Transfers = append(out.Transfers, tripPair{From: tr.From, To: tr.To, FromName: t.names[tr.From], ToName: t.names[tr.To],
				Owed: money.FromSatang(tr.Amount), Remaining: money.FromSatang(tr.Amount), Status: split.Unpaid})
			owe(tr.From, tr.To, tr.Amount)
		}
	}
	for _, m := range t.Members {
		out.People = append(out.People, *people[m.ID])
	}
	out.Progress.Owed, out.Progress.Paid = money.FromSatang(owed), money.FromSatang(paid)
	httpx.WriteJSON(w, http.StatusOK, out)
}

// --- Payments ---

func (a *Service) listTripPayments(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	t, err := a.loadTrip(r.Context(), auth.UserID(r), id)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, t.Payments)
}

// tripMembersOK checks that both members belong to the trip and differ.
func (a *Service) tripMembersOK(ctx context.Context, tripID, from, to int64) (bool, error) {
	if from == to {
		return false, nil
	}
	var n int
	err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM trip_members WHERE trip_id = ? AND id IN (?, ?)`, tripID, from, to).Scan(&n)
	return n == 2, err
}

// readTripImage reads an uploaded image (form field `field`) with its file extension; nil data when
// the field wasn't sent.
func readTripImage(r *http.Request, field string) ([]byte, string, error) {
	f, _, err := r.FormFile(field)
	if errors.Is(err, http.ErrMissingFile) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxTripSlipBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) > maxTripSlipBytes {
		return nil, "", errors.New("ไฟล์รูปใหญ่เกิน 10MB")
	}
	ext := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[http.DetectContentType(data)]
	if ext == "" {
		return nil, "", errors.New("รองรับเฉพาะรูป PNG, JPG หรือ WEBP")
	}
	return data, ext, nil
}

// saveTripImage stores an uploaded image (form field `field`) next to the bank slips, so backups
// include it; ” when the field wasn't sent.
func (a *Service) saveTripImage(r *http.Request, field string) (string, error) {
	data, ext, err := readTripImage(r, field)
	if data == nil || err != nil {
		return "", err
	}
	rnd := make([]byte, 12)
	if _, err := rand.Read(rnd); err != nil {
		return "", err
	}
	name := "trip-" + hex.EncodeToString(rnd) + ext
	if err := os.WriteFile(a.images.Path(name), data, 0o644); err != nil {
		return "", err
	}
	return name, nil
}

func (a *Service) createTripPayment(w http.ResponseWriter, r *http.Request) {
	tripID, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	if owns, err := a.ownsTrip(r.Context(), auth.UserID(r), tripID); err != nil || !owns {
		if err != nil {
			httpx.ServerError(w, err)
		} else {
			httpx.NotFound(w)
		}
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxTripSlipBytes+1<<20)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		httpx.BadRequest(w, "ส่งข้อมูลแบบ multipart/form-data (สลิปไม่เกิน 10MB)")
		return
	}
	from, _ := strconv.ParseInt(r.FormValue("from_member"), 10, 64)
	to, _ := strconv.ParseInt(r.FormValue("to_member"), 10, 64)
	amount, err := strconv.ParseFloat(r.FormValue("amount"), 64)
	if err != nil || money.ToSatang(amount) <= 0 {
		httpx.BadRequest(w, "จำนวนเงินต้องมากกว่า 0")
		return
	}
	date := r.FormValue("date")
	if _, err := time.Parse("2006-01-02", date); err != nil {
		httpx.BadRequest(w, "date must be YYYY-MM-DD")
		return
	}
	if ok, err := a.tripMembersOK(r.Context(), tripID, from, to); err != nil || !ok {
		if err != nil {
			httpx.ServerError(w, err)
		} else {
			httpx.BadRequest(w, "ผู้จ่ายและผู้รับต้องเป็นสมาชิกของทริป และเป็นคนละคน")
		}
		return
	}
	note := strings.TrimSpace(r.FormValue("note"))
	slip, err := a.saveTripImage(r, "slip")
	if err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	if _, err := a.db.ExecContext(r.Context(), `
		INSERT INTO trip_payments (trip_id, from_member, to_member, amount_satang, paid_on, note, slip_file) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		tripID, from, to, money.ToSatang(amount), date, note, slip); err != nil {
		a.images.Remove(slip)
		httpx.ServerError(w, err)
		return
	}
	a.respondTrip(w, r, tripID, http.StatusCreated)
}

// updateTripPayment confirms receipt and/or edits a payment; only the fields sent change.
func (a *Service) updateTripPayment(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	tripID, err := a.tripOf(r.Context(), auth.UserID(r), "trip_payments", id)
	if err != nil || tripID == 0 {
		if err != nil {
			httpx.ServerError(w, err)
		} else {
			httpx.NotFound(w)
		}
		return
	}
	var in struct {
		Confirmed *bool    `json:"confirmed"`
		Amount    *float64 `json:"amount"`
		Date      *string  `json:"date"`
		Note      *string  `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpx.BadRequest(w, "invalid JSON body")
		return
	}
	sets, args := []string{}, []any{}
	if in.Amount != nil {
		if money.ToSatang(*in.Amount) <= 0 {
			httpx.BadRequest(w, "จำนวนเงินต้องมากกว่า 0")
			return
		}
		sets, args = append(sets, "amount_satang = ?"), append(args, money.ToSatang(*in.Amount))
	}
	if in.Date != nil {
		if _, err := time.Parse("2006-01-02", *in.Date); err != nil {
			httpx.BadRequest(w, "date must be YYYY-MM-DD")
			return
		}
		sets, args = append(sets, "paid_on = ?"), append(args, *in.Date)
	}
	if in.Note != nil {
		sets, args = append(sets, "note = ?"), append(args, strings.TrimSpace(*in.Note))
	}
	if in.Confirmed != nil {
		if *in.Confirmed {
			sets = append(sets, "confirmed_at = COALESCE(confirmed_at, datetime('now'))")
		} else {
			sets = append(sets, "confirmed_at = NULL")
		}
	}
	if len(sets) == 0 {
		httpx.BadRequest(w, "nothing to change")
		return
	}
	if _, err := a.db.ExecContext(r.Context(), `UPDATE trip_payments SET `+strings.Join(sets, ", ")+` WHERE id = ?`,
		append(args, id)...); err != nil {
		httpx.ServerError(w, err)
		return
	}
	a.respondTrip(w, r, tripID, http.StatusOK)
}

func (a *Service) deleteTripPayment(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	tripID, err := a.tripOf(r.Context(), auth.UserID(r), "trip_payments", id)
	if err != nil || tripID == 0 {
		if err != nil {
			httpx.ServerError(w, err)
		} else {
			httpx.NotFound(w)
		}
		return
	}
	files, err := a.tripFiles(r.Context(), paymentSlip, `id = ?`, id)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	if _, err := a.db.ExecContext(r.Context(), `DELETE FROM trip_payments WHERE id = ?`, id); err != nil {
		httpx.ServerError(w, err)
		return
	}
	for _, f := range files {
		a.images.Remove(f)
	}
	a.respondTrip(w, r, tripID, http.StatusOK)
}

// tripImage is a kind of trip picture: a payment's slip or a bill's photo. sig is its own link
// signature space (images.Store.Link), so a bank-slip link can't open a payment slip or bill.
type tripImage struct {
	table, column, path, sig string
}

var (
	paymentSlip = tripImage{"trip_payments", "slip_file", "/api/trip-payments/%d/slip", "trip"}
	billImage   = tripImage{"trip_bills", "image_file", "/api/trip-bills/%d/image", "tripbill"}
	memberQR    = tripImage{"trip_members", "qr_file", "/api/trip-members/%d/qr", "tripqr"}
)

func (a *Service) tripFiles(ctx context.Context, k tripImage, where string, arg int64) ([]string, error) {
	rows, err := a.db.QueryContext(ctx, `SELECT `+k.column+` FROM `+k.table+` WHERE `+k.column+` <> '' AND `+where, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (a *Service) tripSlipImage(w http.ResponseWriter, r *http.Request) {
	a.serveTripImage(w, r, paymentSlip)
}
func (a *Service) tripBillImage(w http.ResponseWriter, r *http.Request) {
	a.serveTripImage(w, r, billImage)
}
func (a *Service) tripMemberQR(w http.ResponseWriter, r *http.Request) {
	a.serveTripImage(w, r, memberQR)
}

func (a *Service) serveTripImage(w http.ResponseWriter, r *http.Request, k tripImage) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	if !a.images.Valid(r, k.sig, id) {
		httpx.WriteJSON(w, http.StatusForbidden, map[string]string{"error": "ลิงก์รูปหมดอายุ กรุณาเปิดหน้าใหม่"})
		return
	}
	var file string
	err := a.db.QueryRowContext(r.Context(), `SELECT `+k.column+` FROM `+k.table+` WHERE id = ?`, id).Scan(&file)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && file == "") {
		httpx.NotFound(w)
		return
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeFile(w, r, a.images.Path(file))
}

// PUT (multipart, field "image") replaces a bill's photo; DELETE removes it.
func (a *Service) setTripBillImage(w http.ResponseWriter, r *http.Request) {
	a.setTripImage(w, r, billImage, "image")
}

// PUT (multipart, field "qr") sets a member's (or the pool's) payment QR picture; DELETE removes it.
func (a *Service) setTripMemberQR(w http.ResponseWriter, r *http.Request) {
	a.setTripImage(w, r, memberQR, "qr")
}

// PUT (multipart, field "slip") adds or replaces a payment's slip; DELETE removes it.
func (a *Service) setTripPaymentSlip(w http.ResponseWriter, r *http.Request) {
	a.setTripImage(w, r, paymentSlip, "slip")
}

func (a *Service) setTripImage(w http.ResponseWriter, r *http.Request, k tripImage, field string) {
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	tripID, err := a.tripOf(r.Context(), auth.UserID(r), k.table, id)
	if err != nil || tripID == 0 {
		if err != nil {
			httpx.ServerError(w, err)
		} else {
			httpx.NotFound(w)
		}
		return
	}
	file := ""
	if r.Method == http.MethodPut {
		r.Body = http.MaxBytesReader(w, r.Body, maxTripSlipBytes+1<<20)
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			httpx.BadRequest(w, "ส่งรูปแบบ multipart/form-data (ไม่เกิน 10MB)")
			return
		}
		if file, err = a.saveTripImage(r, field); err != nil {
			httpx.BadRequest(w, err.Error())
			return
		}
		if file == "" {
			httpx.BadRequest(w, "กรุณาเลือกรูป")
			return
		}
	}
	old, err := a.tripFiles(r.Context(), k, `id = ?`, id)
	if err != nil {
		a.images.Remove(file)
		httpx.ServerError(w, err)
		return
	}
	if _, err := a.db.ExecContext(r.Context(), `UPDATE `+k.table+` SET `+k.column+` = ? WHERE id = ?`, file, id); err != nil {
		a.images.Remove(file)
		httpx.ServerError(w, err)
		return
	}
	for _, f := range old {
		a.images.Remove(f)
	}
	a.respondTrip(w, r, tripID, http.StatusOK)
}
