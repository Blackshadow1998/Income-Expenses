package main

import (
	"fmt"
	"mime"
	"net/smtp"
	"os"
	"strings"
	"time"
)

// newMailer returns a function that sends a plain-text e-mail through SMTP (e.g. Gmail with an app
// password), or nil when SMTP_USER / SMTP_PASS are not set. Settings come from the environment:
// SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, SMTP_FROM.
func newMailer() func(to, subject, body string) error {
	user, pass := os.Getenv("SMTP_USER"), os.Getenv("SMTP_PASS")
	if user == "" || pass == "" {
		return nil
	}
	host, port := getenv("SMTP_HOST", "smtp.gmail.com"), getenv("SMTP_PORT", "587")
	from := getenv("SMTP_FROM", user)
	auth := smtp.PlainAuth("", user, pass, host)
	return func(to, subject, body string) error {
		msg := strings.Join([]string{
			"From: " + mime.BEncoding.Encode("utf-8", "รายรับรายจ่าย") + " <" + from + ">",
			"To: " + to,
			"Subject: " + mime.BEncoding.Encode("utf-8", subject),
			"Date: " + time.Now().Format(time.RFC1123Z),
			"MIME-Version: 1.0",
			"Content-Type: text/plain; charset=utf-8",
			"Content-Transfer-Encoding: 8bit",
			"",
			body,
		}, "\r\n")
		// SendMail upgrades to TLS (STARTTLS) before authenticating.
		if err := smtp.SendMail(host+":"+port, auth, from, []string{to}, []byte(msg)); err != nil {
			return fmt.Errorf("send mail to %s: %w", to, err)
		}
		return nil
	}
}
