// Command api runs the income/expenses HTTP API (and serves the web app).
//
//	api                          serve
//	api reset-password <user>    print a temporary password for a user
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"income-expenses/internal/backup"
	"income-expenses/internal/config"
	"income-expenses/internal/database"
	"income-expenses/internal/httpx"
	"income-expenses/internal/logx"
	"income-expenses/internal/mail"
	"income-expenses/internal/server"
)

var logger = logx.Logger

func main() {
	cfg := config.FromEnv()
	for _, dir := range []string{cfg.DataDir(), cfg.SlipsDir()} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			logger.Fatalf("create %s: %v", dir, err)
		}
	}
	db, err := database.Open(cfg.DBPath)
	if err != nil {
		logger.Fatalf("open db: %v", err)
	}
	defer db.Close()

	if n, err := server.ReparsePendingSlips(context.Background(), db); err != nil {
		logger.Printf("re-read pending slips: %v", err)
	} else if n > 0 {
		logger.Printf("re-read %d pending slip(s) with the current parser", n)
	}

	// Admin command: /app/api reset-password <username>
	if len(os.Args) == 3 && os.Args[1] == "reset-password" {
		temp, err := server.ResetPassword(context.Background(), db, os.Args[2])
		if err != nil {
			db.Close()
			logger.Fatalf("reset-password: %v", err)
		}
		fmt.Printf("รหัสผ่านชั่วคราวของ %s: %s\nเข้าสู่ระบบด้วยรหัสนี้ แล้วเปลี่ยนรหัสผ่านที่หน้า ตั้งค่า\n", os.Args[2], temp)
		return
	}

	webDir := ""
	if info, err := os.Stat(filepath.Join(cfg.WebDir, "index.html")); err == nil && !info.IsDir() {
		webDir = cfg.WebDir
		logger.Printf("serving web app from %s", webDir)
	}
	api, err := server.New(server.Options{
		DB:             db,
		SlipsDir:       cfg.SlipsDir(),
		WebDir:         webDir,
		GoogleClientID: cfg.GoogleClientID,
		SendMail:       mail.New(mail.Config(cfg.SMTP)),
	})
	if err != nil {
		logger.Fatalf("api: %v", err)
	}
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpx.LogRequests(api.Handler()),
		ReadHeaderTimeout: 5 * time.Second,
	}

	// On `docker compose stop` (SIGTERM) shut down cleanly so db.Close() runs and
	// SQLite folds its WAL file back into the main .db file.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if cfg.BackupDir != "" {
		go backup.Run(ctx, db, cfg.BackupDir, cfg.SlipsDir(), 30)
	}
	go server.RunRecurring(ctx, db)
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	logger.Printf("listening on %s (db: %s)", cfg.Addr, cfg.DBPath)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Printf("server: %v", err)
	}
	logger.Printf("shutting down")
}
