package main

import (
	"context"
	"crypto/rand"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

var logger = log.New(os.Stdout, "[api] ", log.LstdFlags)

func main() {
	dbPath := getenv("DB_PATH", "./data/income_expenses.db")
	addr := ":" + getenv("PORT", "8080")

	if err := os.MkdirAll(dirOf(dbPath), 0o755); err != nil {
		logger.Fatalf("create data dir: %v", err)
	}
	db, err := openDB(dbPath)
	if err != nil {
		logger.Fatalf("open db: %v", err)
	}
	defer db.Close()

	slipsDir := dirOf(dbPath) + "/slips"
	if err := os.MkdirAll(slipsDir, 0o755); err != nil {
		logger.Fatalf("create slips dir: %v", err)
	}
	// Fresh key per start: slip image links are short-lived and the app re-fetches them anyway.
	imageKey := make([]byte, 32)
	if _, err := rand.Read(imageKey); err != nil {
		logger.Fatalf("image key: %v", err)
	}
	api := &API{db: db, slipsDir: slipsDir, imageKey: imageKey}
	if dir := getenv("WEB_DIR", "./web"); fileExists(dir + "/index.html") {
		api.webDir = dir
		logger.Printf("serving web app from %s", dir)
	}
	srv := &http.Server{
		Addr:              addr,
		Handler:           logRequests(api.routes()),
		ReadHeaderTimeout: 5 * time.Second,
	}
	// On `docker compose stop` (SIGTERM) shut down cleanly so db.Close() runs and
	// SQLite folds its WAL file back into the main .db file.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	logger.Printf("listening on %s (db: %s)", addr, dbPath)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Printf("server: %v", err)
	}
	logger.Printf("shutting down")
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		logger.Printf("%s %s (%s)", r.Method, r.URL.RequestURI(), time.Since(start).Round(time.Millisecond))
	})
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func dirOf(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' || path[i] == '\\' {
			return path[:i]
		}
	}
	return "."
}
