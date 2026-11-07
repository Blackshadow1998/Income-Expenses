package main

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDailyBackupWritesOncePerDayAndPrunes(t *testing.T) {
	dir := t.TempDir()
	db, err := openDB(filepath.Join(dir, "live.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	backups := filepath.Join(dir, "backups")
	os.MkdirAll(backups, 0o755)
	for _, day := range []string{"2026-10-01", "2026-10-02", "2026-10-03"} {
		os.WriteFile(filepath.Join(backups, backupPrefix+day+".db"), []byte("old"), 0o644)
	}

	now := time.Date(2026, 11, 7, 9, 0, 0, 0, time.Local)
	path, err := dailyBackup(context.Background(), db, backups, now, 3)
	if err != nil || path == "" {
		t.Fatalf("first backup: %q %v", path, err)
	}
	// The copy is a working database with the schema in it.
	copyDB, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := copyDB.QueryRow(`SELECT COUNT(*) FROM categories`).Scan(&n); err != nil || n != 6 {
		t.Fatalf("backup content: %d categories, %v", n, err)
	}
	copyDB.Close()

	if again, err := dailyBackup(context.Background(), db, backups, now.Add(time.Hour), 3); err != nil || again != "" {
		t.Fatalf("second backup the same day should be skipped: %q %v", again, err)
	}
	entries, _ := os.ReadDir(backups)
	if len(entries) != 3 {
		t.Fatalf("kept %d files, want 3", len(entries))
	}
	if _, err := os.Stat(filepath.Join(backups, backupPrefix+"2026-10-01.db")); !os.IsNotExist(err) {
		t.Fatal("oldest backup should have been pruned")
	}
}

func TestMirrorDir(t *testing.T) {
	src, dst := t.TempDir(), filepath.Join(t.TempDir(), "slips")
	os.WriteFile(filepath.Join(src, "a.jpg"), []byte("aaa"), 0o644)
	os.WriteFile(filepath.Join(src, "b.jpg"), []byte("bb"), 0o644)
	if n, err := mirrorDir(src, dst); err != nil || n != 2 {
		t.Fatalf("first mirror: %d %v", n, err)
	}
	if n, _ := mirrorDir(src, dst); n != 0 {
		t.Fatalf("nothing changed, but mirror did %d", n)
	}
	os.Remove(filepath.Join(src, "a.jpg"))
	os.WriteFile(filepath.Join(src, "c.jpg"), []byte("c"), 0o644)
	if n, err := mirrorDir(src, dst); err != nil || n != 2 {
		t.Fatalf("add + delete: %d %v", n, err)
	}
	entries, _ := os.ReadDir(dst)
	if len(entries) != 2 || entries[0].Name() != "b.jpg" || entries[1].Name() != "c.jpg" {
		t.Fatalf("dst = %v", entries)
	}
}
