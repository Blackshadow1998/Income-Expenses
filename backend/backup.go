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

// runBackups keeps one copy of the database per day in dir and deletes all but the newest `keep`,
// and mirrors the slip images into dir/slips. It checks hourly, so a PC that was asleep at midnight
// still gets that day's copy.
func runBackups(ctx context.Context, db *sql.DB, dir, slipsDir string, keep int) {
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
		if n, err := mirrorDir(slipsDir, filepath.Join(dir, "slips")); err != nil {
			logger.Printf("backup slips: %v", err)
		} else if n > 0 {
			logger.Printf("backup slips: %d file(s) updated", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Hour):
		}
	}
}

// dailyBackup writes today's copy if it doesn't exist yet and prunes old daily copies. The first copy
// of each month is also kept in dir/monthly, which is never pruned. It returns the new daily file's
// path, or "" when today's copy was already there.
func dailyBackup(ctx context.Context, db *sql.DB, dir string, now time.Time, keep int) (string, error) {
	path := filepath.Join(dir, backupPrefix+now.Format("2006-01-02")+".db")
	created := ""
	if _, err := os.Stat(path); err != nil {
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
		if err := pruneBackups(dir, keep); err != nil {
			return path, err
		}
		created = path
	}
	monthly := filepath.Join(dir, "monthly", backupPrefix+now.Format("2006-01")+".db")
	if _, err := os.Stat(monthly); err != nil {
		if err := os.MkdirAll(filepath.Dir(monthly), 0o755); err != nil {
			return created, err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return created, err
		}
		if err := os.WriteFile(monthly, data, 0o644); err != nil {
			return created, err
		}
		logger.Printf("monthly backup written: %s", monthly)
	}
	return created, nil
}

// mirrorDir makes dst hold the same files as src (flat directory): copies new or resized files and
// removes ones that no longer exist in src. Returns how many files it copied or removed.
func mirrorDir(src, dst string) (int, error) {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return 0, err
	}
	srcEntries, err := os.ReadDir(src)
	if err != nil {
		return 0, err
	}
	changed := 0
	want := map[string]bool{}
	for _, e := range srcEntries {
		if e.IsDir() {
			continue
		}
		want[e.Name()] = true
		si, err := e.Info()
		if err != nil {
			return changed, err
		}
		if di, err := os.Stat(filepath.Join(dst, e.Name())); err == nil && di.Size() == si.Size() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(src, e.Name()))
		if err != nil {
			return changed, err
		}
		if err := os.WriteFile(filepath.Join(dst, e.Name()), data, 0o644); err != nil {
			return changed, err
		}
		changed++
	}
	dstEntries, err := os.ReadDir(dst)
	if err != nil {
		return changed, err
	}
	for _, e := range dstEntries {
		if !e.IsDir() && !want[e.Name()] {
			if err := os.Remove(filepath.Join(dst, e.Name())); err != nil {
				return changed, err
			}
			changed++
		}
	}
	return changed, nil
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
