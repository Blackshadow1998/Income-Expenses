package trip

import (
	"net/http"
	"os"

	"income-expenses/internal/httpx"
	"income-expenses/internal/logx"
	"income-expenses/internal/ocr"
)

// tripOCR reads an uploaded picture (multipart "image"; form value kind = "receipt" or "slip")
// for the bill/payment form; nothing is stored (the picture itself is attached separately).
func (a *Service) tripOCR(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxTripSlipBytes+1<<20)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		httpx.BadRequest(w, "ส่งรูปแบบ multipart/form-data (ไม่เกิน 10MB)")
		return
	}
	data, ext, err := readTripImage(r, "image")
	if err != nil {
		httpx.BadRequest(w, err.Error())
		return
	}
	if data == nil {
		httpx.BadRequest(w, "กรุณาเลือกรูป")
		return
	}
	f, err := os.CreateTemp("", "trip-ocr-*"+ext)
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	defer os.Remove(f.Name())
	_, err = f.Write(data)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		httpx.ServerError(w, err)
		return
	}
	text, err := ocr.Run(r.Context(), f.Name())
	if err != nil {
		logx.Logger.Printf("trip ocr: %v", err)
		httpx.WriteJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": "อ่านรูปไม่สำเร็จ กรอกเองได้เลย"})
		return
	}
	if r.FormValue("kind") == "slip" {
		s := ocr.ParseSlipText(text)
		httpx.WriteJSON(w, http.StatusOK, ocr.Receipt{Date: s.Date, Amount: s.Amount, Items: []ocr.ReceiptItem{}})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, ocr.ParseReceiptText(text))
}
