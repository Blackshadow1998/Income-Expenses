package httpx

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// answer runs h behind Language with the given Accept-Language and decodes the JSON answer.
func answer(t *testing.T, h http.HandlerFunc, acceptLanguage string, wrap bool) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest("GET", "/", nil)
	if acceptLanguage != "" {
		req.Header.Set("Accept-Language", acceptLanguage)
	}
	rec := httptest.NewRecorder()
	var handler http.Handler = h
	if wrap {
		handler = Language(h)
	}
	handler.ServeHTTP(rec, req)
	out := map[string]any{}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return rec.Code, out
}

func TestErrorsInRequestLanguage(t *testing.T) {
	bad := func(w http.ResponseWriter, r *http.Request) {
		BadRequest(w, "จำนวนเงินต้องมากกว่า 0")
	}
	cases := []struct {
		header string
		want   string
	}{
		{"en", "The amount must be greater than 0"},
		{"en-US,en;q=0.9", "The amount must be greater than 0"},
		{"th", "จำนวนเงินต้องมากกว่า 0"},
		{"", "จำนวนเงินต้องมากกว่า 0"},
		{"fr", "จำนวนเงินต้องมากกว่า 0"},
	}
	for _, c := range cases {
		status, out := answer(t, bad, c.header, true)
		if status != http.StatusBadRequest || out["error"] != c.want || len(out) != 1 {
			t.Errorf("Accept-Language %q: %d %v, want 400 {error: %q}", c.header, status, out, c.want)
		}
	}
}

func TestOtherFieldsUntouched(t *testing.T) {
	// The shape authError and the PIN answer use: code and numbers stay as they are.
	h := func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "PIN ไม่ถูกต้อง (เหลืออีก 2 ครั้ง)", "code": "wrong_pin", "tries_left": 2, "note": "กรุณาใส่ PIN",
		})
	}
	status, out := answer(t, h, "en", true)
	if status != http.StatusUnauthorized || out["error"] != "Wrong PIN (2 tries left)" || out["code"] != "wrong_pin" ||
		out["tries_left"] != float64(2) || out["note"] != "กรุณาใส่ PIN" {
		t.Errorf("got %d %v", status, out)
	}

	msg := func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]string{"message": "กรุณาเลือกรูป", "name": "กรุณาเลือกรูป"})
	}
	if _, out := answer(t, msg, "en", true); out["message"] != "Please choose an image" || out["name"] != "กรุณาเลือกรูป" {
		t.Errorf("message answer: %v", out)
	}
}

func TestUnchangedAnswers(t *testing.T) {
	// English messages, server errors and not-found stay as they were.
	for name, h := range map[string]http.HandlerFunc{
		"english":   func(w http.ResponseWriter, r *http.Request) { BadRequest(w, "invalid JSON body") },
		"not found": func(w http.ResponseWriter, r *http.Request) { NotFound(w) },
		"server":    func(w http.ResponseWriter, r *http.Request) { ServerError(w, errors.New("boom")) },
	} {
		withEn, en := answer(t, h, "en", true)
		without, th := answer(t, h, "", false)
		if withEn != without || en["error"] != th["error"] {
			t.Errorf("%s: en %d %v, plain %d %v", name, withEn, en, without, th)
		}
	}

	// Without the middleware (e.g. tests that build their own mux) answers are Thai as before.
	if _, out := answer(t, func(w http.ResponseWriter, r *http.Request) {
		BadRequest(w, "จำนวนเงินต้องมากกว่า 0")
	}, "en", false); out["error"] != "จำนวนเงินต้องมากกว่า 0" {
		t.Errorf("no middleware: %v", out)
	}
}

func TestTranslateAndWriter(t *testing.T) {
	var got string
	var unwrapped bool
	h := Language(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = Translate(w, "ไฟล์ใหญ่เกิน 10MB")
		_, unwrapped = w.(*langWriter)
		w.WriteHeader(http.StatusNoContent)
		_ = http.NewResponseController(w).Flush() // reaches the recorder through Unwrap
	}))
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Accept-Language", "en")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got != "The file is larger than 10MB" || !unwrapped || rec.Code != http.StatusNoContent || !rec.Flushed {
		t.Errorf("Translate = %q, wrapped = %v, code = %d, flushed = %v", got, unwrapped, rec.Code, rec.Flushed)
	}
}
