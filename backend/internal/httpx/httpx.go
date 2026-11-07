// Package httpx has the small JSON/HTTP helpers and middleware shared by the handlers.
package httpx

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"income-expenses/internal/logx"
)

func WriteJSON(w http.ResponseWriter, status int, v any) {
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

func LogRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		logx.Logger.Printf("%s %s (%s)", r.Method, r.URL.RequestURI(), time.Since(start).Round(time.Millisecond))
	})
}
