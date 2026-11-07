// Package config reads the server settings from the environment.
package config

import (
	"os"
	"path/filepath"
)

type Config struct {
	DBPath         string // SQLite file; its directory also holds slips/
	Addr           string // listen address, ":8080"
	WebDir         string // exported web app (index.html); served only if it exists
	BackupDir      string // daily DB copies; "" turns backups off
	GoogleClientID string // Google sign-in is off when empty
	SMTP           SMTP
}

// SMTP settings for "forgot password" e-mails; sending is off without User and Pass.
type SMTP struct {
	Host, Port, User, Pass, From string
}

func FromEnv() Config {
	user := os.Getenv("SMTP_USER")
	return Config{
		DBPath:         getenv("DB_PATH", "./data/income_expenses.db"),
		Addr:           ":" + getenv("PORT", "8080"),
		WebDir:         getenv("WEB_DIR", "./web"),
		BackupDir:      os.Getenv("BACKUP_DIR"),
		GoogleClientID: os.Getenv("GOOGLE_CLIENT_ID"),
		SMTP: SMTP{
			Host: getenv("SMTP_HOST", "smtp.gmail.com"),
			Port: getenv("SMTP_PORT", "587"),
			User: user,
			Pass: os.Getenv("SMTP_PASS"),
			From: getenv("SMTP_FROM", user),
		},
	}
}

// DataDir is the directory of the database file.
func (c Config) DataDir() string { return filepath.Dir(c.DBPath) }

// SlipsDir holds uploaded slip and trip images next to the database.
func (c Config) SlipsDir() string { return filepath.Join(c.DataDir(), "slips") }

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
