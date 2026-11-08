// Package mail sends plain-text e-mail through SMTP.
package mail

import (
	"fmt"
	"mime"
	"net/smtp"
	"strings"
	"time"
)

// Config holds SMTP settings (e.g. Gmail with an app password).
type Config struct {
	Host, Port, User, Pass, From string
}

// New returns a function that sends a plain-text e-mail from fromName <From> (the app's name in the
// e-mail's language), or nil when User or Pass is empty.
func New(c Config) func(to, fromName, subject, body string) error {
	if c.User == "" || c.Pass == "" {
		return nil
	}
	host, port, user, pass, from := c.Host, c.Port, c.User, c.Pass, c.From
	auth := smtp.PlainAuth("", user, pass, host)
	return func(to, fromName, subject, body string) error {
		msg := strings.Join([]string{
			"From: " + mime.BEncoding.Encode("utf-8", fromName) + " <" + from + ">",
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
