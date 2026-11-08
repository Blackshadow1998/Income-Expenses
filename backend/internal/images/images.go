// Package images is the folder of uploaded pictures (bank slips, trip payment slips and bill
// photos) and the signed, short-lived links that serve them: <Image>/<img> tags can't send the
// Authorization header.
package images

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"income-expenses/internal/logx"
)

type Store struct {
	Dir string
	key []byte // signs links; a fresh key per start is fine, the app re-fetches links anyway
}

func New(dir string, key []byte) *Store { return &Store{Dir: dir, key: key} }

// Path is where an image file lives; only the base name of file is used.
func (s *Store) Path(file string) string { return filepath.Join(s.Dir, filepath.Base(file)) }

// Remove deletes an image file; "" and missing files are ignored.
func (s *Store) Remove(file string) {
	if file == "" {
		return
	}
	if err := os.Remove(s.Path(file)); err != nil && !os.IsNotExist(err) {
		logx.Logger.Printf("remove image: %v", err)
	}
}

// Link signs pathFmt (with one %d for id). Each kind has its own signature space, so a link for
// one kind of picture can't open another kind with the same id. The expiry is rounded to the hour
// so the URL (and browser cache) stays stable.
func (s *Store) Link(pathFmt, kind string, id int64) string {
	exp := time.Now().Truncate(time.Hour).Add(2 * time.Hour).Unix()
	return fmt.Sprintf(pathFmt+"?exp=%d&sig=%s", id, exp, s.sign(kind, id, exp))
}

// Valid reports whether the request carries an unexpired signature from Link for kind and id.
func (s *Store) Valid(r *http.Request, kind string, id int64) bool {
	exp, err := strconv.ParseInt(r.URL.Query().Get("exp"), 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}
	return hmac.Equal([]byte(r.URL.Query().Get("sig")), []byte(s.sign(kind, id, exp)))
}

func (s *Store) sign(kind string, id, exp int64) string {
	m := hmac.New(sha256.New, s.key)
	fmt.Fprintf(m, "%s.%d.%d", kind, id, exp)
	return hex.EncodeToString(m.Sum(nil))
}
