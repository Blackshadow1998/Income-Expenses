package main

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const backupPrefix = "income_expenses-"

// runBackups keeps one copy of the database per day in dir and deletes all but the newest `keep`.
// It checks hourly, so a PC that was asleep at midnight still gets that day's copy.
func runBackups(ctx context.Context, db *sql.DB, dir string, keep int) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		logger.Printf("backup dir: %v", err)
		return
	}
	for {
		if path, err := dailyBackup(ctx, db, dir, time.Now(), keep); err != nil {
			logger.Printf("backup: %v", err)
		} else if path != "" {
			logger.Printf("backup written: %s", path)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Hour):
		}
	}
}

// dailyBackup writes today's copy if it doesn't exist yet and prunes old copies. It returns the new
// file's path, or "" when today's copy was already there.
func dailyBackup(ctx context.Context, db *sql.DB, dir string, now time.Time, keep int) (string, error) {
	path := filepath.Join(dir, backupPrefix+now.Format("2006-01-02")+".db")
	if _, err := os.Stat(path); err == nil {
		return "", nil
	}
	// VACUUM INTO makes a consistent copy while the app keeps running; write to a temp name first
	// so a half-written file never looks like a finished backup.
	tmp := path + ".tmp"
	os.Remove(tmp)
	if _, err := db.ExecContext(ctx, `VACUUM INTO ?`, tmp); err != nil {
		os.Remove(tmp)
		return "", err
	}
	if err := os.Rename(tmp, path); err != nil {
		return "", err
	}
	return path, pruneBackups(dir, keep)
}

func pruneBackups(dir string, keep int) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var names []string
	for _, e := range entries {
		if n := e.Name(); !e.IsDir() && strings.HasPrefix(n, backupPrefix) && strings.HasSuffix(n, ".db") {
			names = append(names, n)
		}
	}
	sort.Strings(names) // dates in the names sort oldest first
	for len(names) > keep {
		if err := os.Remove(filepath.Join(dir, names[0])); err != nil {
			return err
		}
		names = names[1:]
	}
	return nil
}
