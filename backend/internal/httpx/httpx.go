// Package httpx has the small JSON/HTTP helpers and middleware shared by the handlers.
package httpx

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"income-expenses/internal/i18n"
	"income-expenses/internal/logx"
)

// WriteJSON answers v as JSON. Under Language, the "error" and "message" texts of a map answer
// are sent in the request's language (the handlers write them in Thai); nothing else changes.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	v = localize(langOf(w), v)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func BadRequest(w http.ResponseWriter, msg string) {
	WriteJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
}

func NotFound(w http.ResponseWriter) {
	WriteJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
}

func ServerError(w http.ResponseWriter, err error) {
	logx.Logger.Printf("error: %v", err)
	WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
}

// PathID reads the positive {id} path value, answering 400 when it isn't one.
func PathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		BadRequest(w, "invalid id")
		return 0, false
	}
	return id, true
}

// QueryID reads an optional positive integer query parameter; 0 means "not given".
func QueryID(r *http.Request, name string) int64 {
	id, err := strconv.ParseInt(r.URL.Query().Get(name), 10, 64)
	if err != nil || id < 0 {
		return 0
	}
	return id
}

func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// langWriter carries the request's language to WriteJSON, which only gets the writer.
type langWriter struct {
	http.ResponseWriter
	lang i18n.Lang
}

// Unwrap lets http.ResponseController reach the real writer.
func (lw *langWriter) Unwrap() http.ResponseWriter { return lw.ResponseWriter }

// Language reads Accept-Language (Thai when missing or unsupported) for WriteJSON and the
// request context (i18n.FromContext).
func Language(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lang := i18n.Parse(r.Header.Get("Accept-Language"))
		next.ServeHTTP(&langWriter{w, lang}, r.WithContext(i18n.WithLang(r.Context(), lang)))
	})
}

func langOf(w http.ResponseWriter) i18n.Lang {
	if lw, ok := w.(*langWriter); ok {
		return lw.lang
	}
	return i18n.Default
}

// Translate is msg in the language of the request w answers, for texts that are not the top-level
// "error"/"message" of a map answer (e.g. per-item errors in a list).
func Translate(w http.ResponseWriter, msg string) string {
	return i18n.T(langOf(w), msg)
}

// localize returns a copy of a map answer with its "error" and "message" texts translated; other
// answers (and Thai requests) are returned as they are.
func localize(lang i18n.Lang, v any) any {
	if lang == i18n.Default {
		return v
	}
	switch m := v.(type) {
	case map[string]string:
		out := make(map[string]string, len(m))
		for k, s := range m {
			if k == "error" || k == "message" {
				s = i18n.T(lang, s)
			}
			out[k] = s
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(m))
		for k, x := range m {
			if s, ok := x.(string); ok && (k == "error" || k == "message") {
				x = i18n.T(lang, s)
			}
			out[k] = x
		}
		return out
	}
	return v
}

func LogRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		logx.Logger.Printf("%s %s (%s)", r.Method, r.URL.RequestURI(), time.Since(start).Round(time.Millisecond))
	})
}
