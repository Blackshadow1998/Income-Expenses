package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const (
	maxSlipBytes   = 10 << 20 // per image
	maxUploadBytes = 60 << 20 // per request
)

type Slip struct {
	ID            int64   `json:"id"`
	Date          string  `json:"date"`
	DateFound     bool    `json:"date_found"`
	Amount        float64 `json:"amount"`
	FromName      string  `json:"from_name"`
	ToName        string  `json:"to_name"`
	Ref           string  `json:"ref"`
	BankID        *int64  `json:"bank_id"`
	BankName      string  `json:"bank_name"`
	OCRText       string  `json:"ocr_text"`
	Status        string  `json:"status"`
	TransactionID *int64  `json:"transaction_id"`
	ImageURL      string  `json:"image_url"` // signed path of the image, relative to the API root
}

type slipUploadResult struct {
	File      string `json:"file"`
	Slip      *Slip  `json:"slip,omitempty"`
	Error     string `json:"error,omitempty"`
	Duplicate bool   `json:"duplicate,omitempty"`
}

const selectSlip = `
	SELECT sl.id, sl.slip_date, sl.date_found, sl.amount_satang, sl.from_name, sl.to_name, sl.ref,
	       sl.bank_id, COALESCE(b.name, ''), sl.ocr_text, sl.status, sl.transaction_id
	FROM slips sl LEFT JOIN banks b ON b.id = sl.bank_id`

func (a *API) scanSlip(s scanner) (Slip, error) {
	var sl Slip
	var satang int64
	err := s.Scan(&sl.ID, &sl.Date, &sl.DateFound, &satang, &sl.FromName, &sl.ToName, &sl.Ref,
		&sl.BankID, &sl.BankName, &sl.OCRText, &sl.Status, &sl.TransactionID)
	sl.Amount = fromSatang(satang)
	sl.ImageURL = a.slipImageURL(sl.ID)
	return sl, err
}

func (a *API) fetchSlip(ctx context.Context, uid, id int64) (Slip, error) {
	return a.scanSlip(a.db.QueryRowContext(ctx, selectSlip+` WHERE sl.id = ? AND sl.user_id = ?`, id, uid))
}

// pendingSlips lists slips waiting for confirmation whose date falls in [start, end).
func (a *API) pendingSlips(ctx context.Context, uid int64, start, end string) ([]Slip, error) {
	rows, err := a.db.QueryContext(ctx, selectSlip+`
		WHERE sl.user_id = ? AND sl.status = 'pending' AND sl.slip_date >= ? AND sl.slip_date < ?
		ORDER BY sl.slip_date DESC, sl.id DESC`, uid, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Slip{}
	for rows.Next() {
		sl, err := a.scanSlip(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sl)
	}
	return out, rows.Err()
}

// uploadSlips accepts one or more images (multipart field "files"), reads each with OCR
// and stores it as a pending slip. Each file gets its own result so one bad image
// doesn't fail the whole batch.
func (a *API) uploadSlips(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		badRequest(w, "อัปโหลดไม่สำเร็จ (ไฟล์รวมต้องไม่เกิน 60MB)")
		return
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		badRequest(w, "ไม่พบไฟล์ (ใช้ field ชื่อ files)")
		return
	}
	results := make([]slipUploadResult, 0, len(files))
	for _, fh := range files {
		res := slipUploadResult{File: fh.Filename}
		f, err := fh.Open()
		if err != nil {
			res.Error = "เปิดไฟล์ไม่ได้"
			results = append(results, res)
			continue
		}
		data, err := io.ReadAll(io.LimitReader(f, maxSlipBytes+1))
		f.Close()
		if err != nil {
			res.Error = "อ่านไฟล์ไม่ได้"
		} else {
			res = a.saveSlip(r.Context(), userID(r), fh.Filename, data)
		}
		results = append(results, res)
	}
	writeJSON(w, http.StatusOK, results)
}

func (a *API) saveSlip(ctx context.Context, uid int64, name string, data []byte) slipUploadResult {
	res := slipUploadResult{File: name}
	if len(data) > maxSlipBytes {
		res.Error = "ไฟล์ใหญ่เกิน 10MB"
		return res
	}
	ext := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[http.DetectContentType(data)]
	if ext == "" {
		res.Error = "รองรับเฉพาะรูป PNG, JPG, WEBP"
		return res
	}

	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	var existingID int64
	err := a.db.QueryRowContext(ctx, `SELECT id FROM slips WHERE user_id = ? AND file_hash = ?`, uid, hash).Scan(&existingID)
	if err == nil {
		res.Duplicate = true
		res.Error = "สลิปนี้เคยอัปโหลดแล้ว"
		if sl, err := a.fetchSlip(ctx, uid, existingID); err == nil {
			res.Slip = &sl
		}
		return res
	} else if !errors.Is(err, sql.ErrNoRows) {
		logger.Printf("slip hash lookup: %v", err)
		res.Error = "เกิดข้อผิดพลาดในระบบ"
		return res
	}

	// Per-user file name: two users may upload the same image (e.g. both sides of one transfer).
	fileName := strconv.FormatInt(uid, 10) + "-" + hash[:24] + ext
	path := filepath.Join(a.slipsDir, fileName)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		logger.Printf("write slip: %v", err)
		res.Error = "บันทึกรูปไม่สำเร็จ"
		return res
	}

	text, err := runOCR(ctx, path)
	if err != nil {
		logger.Printf("ocr %s: %v", name, err)
		// Keep the slip anyway: the user can still confirm it and type the details.
	}
	parsed := parseSlip(text)

	// A slip with the same reference number is the same transfer (e.g. a re-saved screenshot).
	if parsed.Ref != "" {
		if err := a.db.QueryRowContext(ctx,
			`SELECT id FROM slips WHERE user_id = ? AND ref = ?`, uid, parsed.Ref).Scan(&existingID); err == nil {
			os.Remove(path)
			res.Duplicate = true
			res.Error = "สลิปเลขที่รายการนี้เคยอัปโหลดแล้ว"
			if sl, err := a.fetchSlip(ctx, uid, existingID); err == nil {
				res.Slip = &sl
			}
			return res
		}
	}

	date, dateFound := parsed.Date, parsed.Date != ""
	if !dateFound {
		date = time.Now().Format("2006-01-02")
	}
	var bankID *int64
	if parsed.Bank != "" {
		var id int64
		if err := a.db.QueryRowContext(ctx, `SELECT id FROM banks WHERE name = ?`, parsed.Bank).Scan(&id); err == nil {
			bankID = &id
		}
	}

	ins, err := a.db.ExecContext(ctx, `
		INSERT INTO slips (user_id, image_file, file_hash, slip_date, date_found, amount_satang, from_name, to_name, ref, bank_id, ocr_text)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		uid, fileName, hash, date, dateFound, toSatang(parsed.Amount), parsed.FromName, parsed.ToName, parsed.Ref, bankID, text)
	if err != nil {
		os.Remove(path)
		logger.Printf("insert slip: %v", err)
		res.Error = "บันทึกสลิปไม่สำเร็จ"
		return res
	}
	id, _ := ins.LastInsertId()
	sl, err := a.fetchSlip(ctx, uid, id)
	if err != nil {
		res.Error = "บันทึกแล้วแต่อ่านข้อมูลกลับไม่ได้"
		return res
	}
	res.Slip = &sl
	return res
}

func (a *API) getSlip(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	sl, err := a.fetchSlip(r.Context(), userID(r), id)
	if errors.Is(err, sql.ErrNoRows) {
		notFound(w)
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sl)
}

func (a *API) slipImage(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if !a.validImageSig(r, id) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "ลิงก์รูปสลิปหมดอายุ กรุณาเปิดหน้าใหม่"})
		return
	}
	var file string
	err := a.db.QueryRowContext(r.Context(), `SELECT image_file FROM slips WHERE id = ?`, id).Scan(&file)
	if errors.Is(err, sql.ErrNoRows) {
		notFound(w)
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeFile(w, r, filepath.Join(a.slipsDir, filepath.Base(file)))
}

// deleteSlip removes a pending slip and its image. Confirmed slips are removed
// together with their transaction instead.
func (a *API) deleteSlip(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	uid := userID(r)
	var file, status string
	err := a.db.QueryRowContext(r.Context(),
		`SELECT image_file, status FROM slips WHERE id = ? AND user_id = ?`, id, uid).Scan(&file, &status)
	if errors.Is(err, sql.ErrNoRows) {
		notFound(w)
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if status != "pending" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "สลิปนี้คอนเฟิร์มแล้ว ให้ลบที่รายการแทน"})
		return
	}
	if _, err := a.db.ExecContext(r.Context(), `DELETE FROM slips WHERE id = ? AND user_id = ?`, id, uid); err != nil {
		serverError(w, err)
		return
	}
	a.removeSlipFile(file)
	w.WriteHeader(http.StatusNoContent)
}

// reparsePendingSlips reads the stored OCR text of slips still waiting for confirmation with the
// current parser, so parser fixes reach slips uploaded before them. It only fills fields that are
// missing, never overwrites what was read before.
func reparsePendingSlips(ctx context.Context, db *sql.DB) (int, error) {
	type slipRow struct {
		id                   int64
		text, date, from, to string
		ref                  string
		dateFound            bool
		amount               int64
		bankID               *int64
	}
	rows, err := db.QueryContext(ctx, `
		SELECT id, ocr_text, slip_date, from_name, to_name, ref, date_found, amount_satang, bank_id
		FROM slips WHERE status = 'pending' AND ocr_text <> ''`)
	if err != nil {
		return 0, err
	}
	var list []slipRow
	for rows.Next() {
		var s slipRow
		if err := rows.Scan(&s.id, &s.text, &s.date, &s.from, &s.to, &s.ref, &s.dateFound, &s.amount, &s.bankID); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, s)
	}
	rows.Close()

	updated := 0
	for _, s := range list {
		p := parseSlip(s.text)
		changed := false
		if !s.dateFound && p.Date != "" {
			s.date, s.dateFound, changed = p.Date, true, true
		}
		if s.amount == 0 && p.Amount > 0 {
			s.amount, changed = toSatang(p.Amount), true
		}
		for _, f := range []struct {
			cur   *string
			found string
		}{{&s.from, p.FromName}, {&s.to, p.ToName}, {&s.ref, p.Ref}} {
			if *f.cur == "" && f.found != "" {
				*f.cur, changed = f.found, true
			}
		}
		if s.bankID == nil && p.Bank != "" {
			var id int64
			if db.QueryRowContext(ctx, `SELECT id FROM banks WHERE name = ?`, p.Bank).Scan(&id) == nil {
				s.bankID, changed = &id, true
			}
		}
		if !changed {
			continue
		}
		if _, err := db.ExecContext(ctx, `
			UPDATE slips SET slip_date = ?, date_found = ?, amount_satang = ?, from_name = ?, to_name = ?, ref = ?, bank_id = ?
			WHERE id = ?`, s.date, s.dateFound, s.amount, s.from, s.to, s.ref, s.bankID, s.id); err != nil {
			return updated, err
		}
		updated++
	}
	return updated, nil
}

func (a *API) removeSlipFile(file string) {
	if file == "" {
		return
	}
	if err := os.Remove(filepath.Join(a.slipsDir, filepath.Base(file))); err != nil && !os.IsNotExist(err) {
		logger.Printf("remove slip image: %v", err)
	}
}
